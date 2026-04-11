/**
 * OpenClawAdapter — OttieAgentAdapter 的 OpenClaw 实现
 *
 * 通过 REST API 与真正的 OpenClaw gateway 通信。
 * 个人 Agent 负责改写/审批/调度，设备 Agent 负责执行。
 * Agent 间通过 sessions_send 通信。
 *
 * 验证标准：把这个适配器换成 mock，Ottie IM 代码零修改仍能跑。
 */

import type {
  OttieAgentAdapter,
  OttieMessage,
  AgentCard,
  ApprovalRequest,
  ApprovalDecision,
  OttieScreenEvent,
  MemoryIndex,
  MemoryEntry,
  OttieDevice,
  DeviceCommand,
  Unsubscribe,
  DetectedIntent,
  DecisionRequest,
  SuggestedAction,
} from '@ottie-im/contracts'

import { createApprovalManager } from '@ottie-im/skills'

// ---- Gateway Client (CLI or Tauri IPC) ----

/**
 * Send a message to an OpenClaw agent via the CLI.
 * In Tauri, this runs through the Rust backend's exec.
 * In Node/test, this spawns the openclaw process directly.
 */
function getTauriInvoke(): ((cmd: string, args?: any) => Promise<any>) | null {
  if (typeof window !== 'undefined' && (window as any).__TAURI_INTERNALS__) {
    return (window as any).__TAURI_INTERNALS__.invoke
  }
  return null
}

async function gatewayAgent(
  agentId: string,
  message: string,
): Promise<string> {
  // Tauri environment: use IPC directly (no dynamic import needed)
  const invoke = getTauriInvoke()
  if (invoke) {
    return invoke('openclaw_agent', { agentId, message })
  }

  // Node environment: spawn CLI directly (isolated profile)
  const { execSync } = await import('child_process')
  const escaped = message.replace(/"/g, '\\"')
  const result = execSync(
    `openclaw --profile ottie agent --agent ${agentId} --message "${escaped}" --json`,
    { encoding: 'utf-8', timeout: 60000 }
  )
  try {
    const parsed = JSON.parse(result)
    return parsed.result?.payloads?.[0]?.text ?? ''
  } catch {
    return result.trim()
  }
}

async function gatewayHealth(_gatewayUrl: string): Promise<boolean> {
  // Tauri environment: use IPC directly
  const invoke = getTauriInvoke()
  if (invoke) {
    try {
      const status: string = await invoke('gateway_status')
      const parsed = JSON.parse(status)
      return parsed.gateway === true
    } catch {
      return false
    }
  }

  // Node environment: direct HTTP check
  try {
    const resp = await fetch(`${_gatewayUrl}/health`, { signal: AbortSignal.timeout(2000) })
    return resp.ok
  } catch {
    return false
  }
}

// ---- Config ----

export interface OpenClawAdapterConfig {
  name?: string
  persona?: string
  gatewayUrl?: string       // default: http://localhost:18790 (ottie profile)
  agentId?: string          // default: "personal"
  deviceAgentId?: string    // default: "device"
}

// ---- Rule-based fallbacks (when gateway is unavailable) ----

const COMMAND_PATTERNS = [
  { pattern: /^(帮我|替我|跟他|跟她|告诉他|告诉她|问他|问她|和他说|和她说|跟他说|跟她说)(.+)/, extract: 2 },
  { pattern: /^(tell him|tell her|ask him|ask her|let him know|let her know)\s+(.+)/i, extract: 2 },
]

function ruleRewrite(intent: string): string {
  let text = intent.trim()
  for (const { pattern, extract } of COMMAND_PATTERNS) {
    const match = text.match(pattern)
    if (match && match[extract]) { text = match[extract].trim(); break }
  }
  if (text && !/[。？！.?!]$/.test(text)) {
    text += /吗|呢|么|嘛|不$|没$|\?/.test(text) ? '？' : '。'
  }
  if (/^[a-z]/.test(text)) text = text.charAt(0).toUpperCase() + text.slice(1)
  return text
}

function ruleDetectIntent(message: string): DetectedIntent {
  const m = message.toLowerCase()
  if (/吃饭|聚餐|约|一起去|周[一二三四五六日末]/.test(m))
    return { type: 'invitation', summary: '邀请你一起活动', suggestedActions: [
      { label: '好的', response: '好的呀！' }, { label: '没空', response: '不好意思，没空呢。' }] }
  if (/吗|呢|么|？|\?|怎么|什么|哪|多少|几/.test(m))
    return { type: 'question', summary: '向你提问', suggestedActions: [
      { label: '好的', response: '好的。' }, { label: '不行', response: '不太方便。' }] }
  if (/帮|麻烦|请|能不能|可以/.test(m))
    return { type: 'request', summary: '请你帮忙', suggestedActions: [
      { label: '没问题', response: '没问题！' }, { label: '不方便', response: '不太方便，抱歉。' }] }
  if (/你好|嗨|hi|hello|hey/.test(m))
    return { type: 'greeting', summary: '跟你打招呼', suggestedActions: [
      { label: '你好', response: '你好！' }] }
  return { type: 'general', summary: message.slice(0, 30), suggestedActions: [
    { label: '收到', response: '收到。' }, { label: '好的', response: '好的。' }] }
}

// ---- Adapter ----

export class OpenClawAdapter implements OttieAgentAdapter {
  id: string
  name: string

  private gatewayUrl: string
  private agentId: string
  private deviceAgentId: string
  private persona: string
  private approvalManager: ReturnType<typeof createApprovalManager>
  private gatewayConnected = false
  private status: 'running' | 'stopped' | 'error' = 'stopped'

  private draftCallbacks: Set<(draft: ApprovalRequest) => void> = new Set()
  private decisionCallbacks: Set<(decision: DecisionRequest) => void> = new Set()
  private notificationCallbacks: Set<(event: OttieScreenEvent) => void> = new Set()

  // Device state
  private devices: OttieDevice[] = [
    { id: 'local', name: '当前设备', type: 'desktop', agentId: 'device', status: 'online',
      capabilities: ['read', 'exec', 'browser', 'screen'], lastSeen: Date.now() },
  ]
  lastCommandOutput = ''

  constructor(config: OpenClawAdapterConfig = {}) {
    this.id = `openclaw_${Date.now()}`
    this.name = config.name ?? 'Ottie'
    this.persona = config.persona ?? '友好、得体、简洁'
    this.gatewayUrl = config.gatewayUrl ?? 'http://localhost:18790'
    this.agentId = config.agentId ?? 'personal'
    this.deviceAgentId = config.deviceAgentId ?? 'device'
    this.approvalManager = createApprovalManager()
  }

  getAgentCard(): AgentCard {
    return {
      name: this.name,
      capabilities: ['中文', '英文', '消息改写', '审批', '意图识别', '设备控制'],
      persona: this.persona,
    }
  }

  // ============================================================
  // Gateway 通信
  // ============================================================

  private async sendToPersonalAgent(message: string): Promise<string> {
    if (!this.gatewayConnected) return ''
    return gatewayAgent(this.agentId, message)
  }

  private async sendToDeviceAgent(message: string): Promise<string> {
    if (!this.gatewayConnected) return ''
    return gatewayAgent(this.deviceAgentId, message)
  }

  // ============================================================
  // 发送方：用户输入 → OpenClaw 改写 → 审批
  // ============================================================

  async onMessage(msg: OttieMessage): Promise<void> {
    if (msg.content.type !== 'text') return
    const intent = msg.content.body

    // Check if this is a device command
    if (this.isDeviceIntent(intent)) {
      await this.handleDeviceCommand(intent)
      return
    }

    let rewritten: string

    if (this.gatewayConnected) {
      try {
        // Send to personal agent via OpenClaw gateway
        const response = await this.sendToPersonalAgent(
          `用户想发送以下消息，请改写成得体的版本。只输出改写后的消息，不要解释：\n\n${intent}`
        )
        // Parse response — agent may return JSON or plain text
        try {
          const parsed = JSON.parse(response)
          rewritten = parsed.draft ?? parsed.content ?? response
        } catch {
          rewritten = response.trim() || ruleRewrite(intent)
        }
        if (typeof localStorage !== 'undefined' && localStorage?.setItem) {
          localStorage.setItem('ottie_last_rewrite', JSON.stringify({ via: 'gateway', input: intent, output: rewritten }))
        }
      } catch (err: any) {
        // Gateway error — fallback to rules
        rewritten = ruleRewrite(intent)
        if (typeof localStorage !== 'undefined' && localStorage?.setItem) {
          localStorage.setItem('ottie_last_rewrite', JSON.stringify({ via: 'fallback', error: err?.message ?? String(err), input: intent, output: rewritten }))
        }
      }
    } else {
      rewritten = ruleRewrite(intent)
      if (typeof localStorage !== 'undefined' && localStorage?.setItem) {
        localStorage.setItem('ottie_last_rewrite', JSON.stringify({ via: 'not_connected', input: intent, output: rewritten }))
      }
    }

    const request = this.approvalManager.createRequest(rewritten, intent, msg.roomId)
    for (const cb of this.draftCallbacks) cb(request)
  }

  // ============================================================
  // 接收方：收到对方消息 → 意图识别 → 决策
  // ============================================================

  async onIncomingMessage(msg: OttieMessage, senderName: string): Promise<void> {
    if (msg.content.type !== 'text') return
    const body = msg.content.body

    let intent: DetectedIntent

    if (this.gatewayConnected) {
      try {
        const response = await this.sendToPersonalAgent(
          `分析收到的消息，判断意图并给出建议回复选项。输出严格 JSON。\n发送者：${senderName}\n消息：${body}`
        )
        const jsonMatch = response.match(/\{[\s\S]*\}/)
        if (jsonMatch) {
          intent = JSON.parse(jsonMatch[0])
        } else {
          intent = ruleDetectIntent(body)
        }
      } catch {
        intent = ruleDetectIntent(body)
      }
    } else {
      intent = ruleDetectIntent(body)
    }

    const decision: DecisionRequest = {
      messageId: msg.id,
      roomId: msg.roomId,
      senderName,
      originalMessage: body,
      intent,
    }
    for (const cb of this.decisionCallbacks) cb(decision)
  }

  // ============================================================
  // 接收方：用户选择决策动作 → 生成回复
  // ============================================================

  async onDecisionAction(originalMessage: string, chosenAction: SuggestedAction): Promise<string> {
    if (this.gatewayConnected) {
      try {
        const response = await this.sendToPersonalAgent(
          `根据用户的选择生成一条得体的回复。只输出回复内容。\n收到的消息：${originalMessage}\n我的选择：${chosenAction.response}`
        )
        return response.trim() || chosenAction.response
      } catch {
        return chosenAction.response
      }
    }
    return chosenAction.response
  }

  // ============================================================
  // 设备管理 — 通过 OpenClaw device agent 真正执行
  // ============================================================

  private isDeviceIntent(text: string): boolean {
    return /电脑上|设备|截图|浏览器.*搜|搜.*浏览器|帮我.*打开|帮我.*搜|帮我.*查|帮我.*找文件|帮我.*执行|帮我.*运行/.test(text)
  }

  private async handleDeviceCommand(intent: string): Promise<void> {
    let output: string

    if (this.gatewayConnected) {
      try {
        // Send directly to device agent — it has real exec/browser/read tools
        output = await this.sendToDeviceAgent(intent)
        if (!output) output = '设备 Agent 未返回结果'
      } catch (err: any) {
        output = `设备指令执行失败: ${err.message ?? '未知错误'}`
      }
    } else {
      output = '设备 Agent 不可用（OpenClaw gateway 未连接）'
    }

    this.lastCommandOutput = output

    // Notify UI as a screen event
    const event: OttieScreenEvent = {
      type: 'user-action',
      timestamp: Date.now(),
      content: `🖥️ ${output}`,
      confidence: 1.0,
      actionRequired: false,
      sourceApp: '当前设备',
    }
    for (const cb of this.notificationCallbacks) {
      try { cb(event) } catch {}
    }
  }

  async getDevices(): Promise<OttieDevice[]> {
    return this.devices
  }

  async sendCommand(cmd: DeviceCommand): Promise<void> {
    const intent = (cmd.args as any)?.intent ?? cmd.command
    await this.handleDeviceCommand(intent)
  }

  dispatchToDevice(intent: string): { success: boolean; output?: string; command?: DeviceCommand; device?: OttieDevice } {
    const device = this.devices[0]
    if (!device || device.status !== 'online') {
      return { success: false, output: '没有在线的设备' }
    }
    const command: DeviceCommand = {
      targetDeviceId: device.id,
      command: /浏览器|网页|搜索/.test(intent) ? 'browser' : /文件|读|打开/.test(intent) ? 'read' : 'exec',
      args: { intent },
      requireApproval: false,
    }
    return { success: true, command, device }
  }

  // ============================================================
  // 回调注册
  // ============================================================

  onDraft(callback: (draft: ApprovalRequest) => void): Unsubscribe {
    this.draftCallbacks.add(callback)
    return () => this.draftCallbacks.delete(callback)
  }

  onDecision(callback: (decision: DecisionRequest) => void): Unsubscribe {
    this.decisionCallbacks.add(callback)
    return () => this.decisionCallbacks.delete(callback)
  }

  onApproval(requestId: string, decision: ApprovalDecision): Promise<OttieMessage | null> {
    const result = this.approvalManager.processDecision(requestId, decision)
    if (result.action === 'send' && result.content && result.targetRoom) {
      return Promise.resolve({
        id: `msg_${Date.now()}`,
        roomId: result.targetRoom,
        senderId: '',
        timestamp: Date.now(),
        type: 'text',
        content: result.content,
      })
    }
    return Promise.resolve(null)
  }

  onNotification(callback: (event: OttieScreenEvent) => void): Unsubscribe {
    this.notificationCallbacks.add(callback)
    return () => this.notificationCallbacks.delete(callback)
  }

  // ============================================================
  // 记忆 — 通过 gateway 查询
  // ============================================================

  async getMemory(): Promise<MemoryIndex> {
    return { entries: [], lastDream: 0, version: 1 }
  }

  async queryMemory(query: string): Promise<MemoryEntry[]> {
    return []
  }

  // ============================================================
  // 生命周期
  // ============================================================

  async start(): Promise<void> {
    // If Tauri IPC is available, gateway connectivity is guaranteed
    // (Tauri backend manages the gateway lifecycle)
    const invoke = getTauriInvoke()
    if (invoke) {
      this.gatewayConnected = true
    } else {
      // Non-Tauri environment: check gateway health via HTTP
      try {
        this.gatewayConnected = await gatewayHealth(this.gatewayUrl)
      } catch {
        this.gatewayConnected = false
      }
    }

    this.status = 'running'

    // If not connected, keep retrying in background
    if (!this.gatewayConnected) {
      const checkInterval = setInterval(async () => {
        try {
          this.gatewayConnected = await gatewayHealth(this.gatewayUrl)
        } catch {
          this.gatewayConnected = false
        }
        if (this.gatewayConnected) clearInterval(checkInterval)
      }, 5000)
    }
  }

  async stop(): Promise<void> {
    this.gatewayConnected = false
    this.status = 'stopped'
  }

  getStatus(): 'running' | 'stopped' | 'error' { return this.status }
}
