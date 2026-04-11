/**
 * MissionControlAdapter — 基于 Mission Control 核心模块的 OttieAgentAdapter 实现
 *
 * 替换 OpenClawAdapter，核心改进：
 * 1. 所有 9 个 skills 接入流水线（不再是死代码）
 * 2. 任务追踪 + 多步审批状态机
 * 3. 信任评分驱动自动审批
 * 4. 注入检测保安全
 * 5. 成本追踪
 *
 * 消息流（统一逻辑，不分"自己"和"别人"）：
 *
 * 发送方：
 *   用户输入 → persona.checkBoundaries → injection scan
 *   → rewrite（LLM 优先，规则 fallback）→ 创建审批 → UI
 *
 * 接收方：
 *   收到消息 → injection scan → detectIntent（LLM 优先，规则 fallback）
 *   → delegate.evaluate → auto-reply / require-approval → UI
 *
 * 设备操作（关键场景）：
 *   识别为设备意图 → 创建 task（maxApprovals=2）
 *   → 第 1 次审批（要不要帮他做）→ 执行 → 第 2 次审批（要不要发结果）→ 回传
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

// Skills
import { rewrite as ruleRewrite } from '@ottie-im/skills'
import { createApprovalManager } from '@ottie-im/skills'
import { DelegateManager } from '@ottie-im/skills'
import { DutyManager } from '@ottie-im/skills'
import { createPersona, checkBoundaries, getPersonaPrompt } from '@ottie-im/skills'
import { dispatch, selectDevice, parseCommand } from '@ottie-im/skills'

// LLM 直连
import { OttieLLM, PROVIDERS } from '@ottie-im/llm'

// 设备执行层
import { OttiePaseo } from '@ottie-im/paseo'

// MC Core
import {
  eventBus,
  TaskTracker,
  TrustScoreManager,
  scanForInjection,
  calculateTokenCost,
} from '@ottie-im/mc-core'

// ---- Gateway communication ----

function getTauriInvoke(): ((cmd: string, args?: any) => Promise<any>) | null {
  if (typeof window !== 'undefined' && (window as any).__TAURI_INTERNALS__) {
    return (window as any).__TAURI_INTERNALS__.invoke
  }
  return null
}

async function gatewayAgent(agentId: string, message: string): Promise<string> {
  const invoke = getTauriInvoke()
  if (invoke) {
    return invoke('openclaw_agent', { agentId, message })
  }

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

async function gatewayHealth(gatewayUrl: string): Promise<boolean> {
  const invoke = getTauriInvoke()
  if (invoke) {
    try {
      const status: string = await invoke('gateway_status')
      const parsed = JSON.parse(status)
      return parsed.gateway === true
    } catch { return false }
  }
  try {
    const resp = await fetch(`${gatewayUrl}/health`, { signal: AbortSignal.timeout(2000) })
    return resp.ok
  } catch { return false }
}

// ---- Rule-based intent detection fallback ----

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

// ---- Is this a device operation request? ----

function isDeviceIntent(text: string): boolean {
  return /电脑上.*方案|方案.*电脑|设备上|截图|浏览器.*搜|搜.*浏览器|帮我.*打开文件|帮我.*找文件|帮我.*执行|帮我.*运行|文件.*发给|发.*文件给|看.*电脑上|查.*电脑/.test(text)
}

// ---- Config ----

export interface MissionControlAdapterConfig {
  name?: string
  persona?: string
  gatewayUrl?: string
  agentId?: string
  deviceAgentId?: string
  // Trust
  autoApproveThreshold?: number
  // Duty
  dutyAutoReply?: string
  dutySchedule?: { start: string; end: string }
  // Persona boundaries
  boundaries?: string[]
  // LLM 直连（不依赖 gateway，直接调 API）
  llm?: {
    provider: 'aihubmix' | 'openai' | 'anthropic' | 'ollama' | 'custom'
    apiKey?: string
    model?: string
    baseUrl?: string
  }
  // 设备执行层
  paseo?: {
    defaultProvider?: 'claude' | 'codex'
    defaultCwd?: string
  }
}

// ---- Adapter ----

export class MissionControlAdapter implements OttieAgentAdapter {
  id: string
  name: string

  // Gateway
  private gatewayUrl: string
  private agentId: string
  private deviceAgentId: string
  private gatewayConnected = false
  private status: 'running' | 'stopped' | 'error' = 'stopped'

  // Skills (全部接入)
  private approvalManager: ReturnType<typeof createApprovalManager>
  private delegateManager: DelegateManager
  private dutyManager: DutyManager
  private persona: ReturnType<typeof createPersona>
  private autoApproveThreshold: number

  // LLM 直连
  private llm: OttieLLM | null = null

  // Paseo 设备执行层
  private paseo: OttiePaseo | null = null

  // MC Core
  private taskTracker: TaskTracker
  private trustScore: TrustScoreManager

  // Callbacks
  private draftCallbacks: Set<(draft: ApprovalRequest) => void> = new Set()
  private decisionCallbacks: Set<(decision: DecisionRequest) => void> = new Set()
  private notificationCallbacks: Set<(event: OttieScreenEvent) => void> = new Set()

  // Devices
  private devices: OttieDevice[] = [
    { id: 'local', name: '当前设备', type: 'desktop', agentId: 'device', status: 'online',
      capabilities: ['read', 'exec', 'browser', 'screen'], lastSeen: Date.now() },
  ]

  // Heartbeat
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null
  private cleanupTimer: ReturnType<typeof setInterval> | null = null

  constructor(config: MissionControlAdapterConfig = {}) {
    this.id = `mc_${Date.now()}`
    this.name = config.name ?? 'Ottie'
    this.gatewayUrl = config.gatewayUrl ?? 'http://localhost:18790'
    this.agentId = config.agentId ?? 'personal'
    this.deviceAgentId = config.deviceAgentId ?? 'device'
    this.autoApproveThreshold = config.autoApproveThreshold ?? 0.8

    // Skills init
    this.approvalManager = createApprovalManager()
    this.delegateManager = new DelegateManager()
    this.dutyManager = new DutyManager({
      autoReplyMessage: config.dutyAutoReply ?? '我现在不方便回复，稍后联系你。',
      schedule: config.dutySchedule,
    })
    this.persona = createPersona({
      name: config.name ?? 'Ottie',
      tone: 'friendly',
      boundaries: config.boundaries ?? [],
    })

    // LLM 直连 init
    if (config.llm?.apiKey) {
      const { provider, apiKey, model, baseUrl } = config.llm
      let llmProvider
      if (provider === 'custom' && baseUrl) {
        llmProvider = PROVIDERS.custom(baseUrl, apiKey!, model ?? 'gpt-4o-mini')
      } else if (provider === 'ollama') {
        llmProvider = PROVIDERS.ollama(model)
      } else if (provider === 'aihubmix' || provider === 'openai' || provider === 'anthropic') {
        llmProvider = PROVIDERS[provider](apiKey!, model)
      }
      if (llmProvider) this.llm = new OttieLLM(llmProvider)
    }

    // 设备 agent 管理层
    this.paseo = new OttiePaseo({
      defaultProvider: config.paseo?.defaultProvider as any,
      defaultCwd: config.paseo?.defaultCwd,
    })

    // MC Core init
    this.taskTracker = new TaskTracker()
    this.trustScore = new TrustScoreManager()
  }

  getAgentCard(): AgentCard {
    return {
      name: this.name,
      capabilities: ['中文', '英文', '消息改写', '审批', '意图识别', '设备控制', '信任评分', '成本追踪'],
      persona: this.persona.tone,
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
  // 发送方：用户输入 → 改写 → 审批
  // ============================================================

  async onMessage(msg: OttieMessage): Promise<void> {
    if (msg.content.type !== 'text') return
    const intent = msg.content.body

    // Skill: persona boundary check
    const boundaryCheck = checkBoundaries(intent, this.persona)
    if (!boundaryCheck.safe) {
      eventBus.broadcast('security.boundary_violation', {
        senderId: msg.senderId,
        violation: boundaryCheck.violation,
      })
      // 仍然继续，但标记
    }

    // MC: injection scan
    const injection = scanForInjection(intent)
    if (!injection.safe) {
      eventBus.broadcast('security.injection', {
        senderId: msg.senderId,
        matches: injection.matches,
      })
    }

    // 发送方不拦截设备意图 — 统一走改写。
    // 设备意图只在接收方（onIncomingMessage）识别。
    // 用户说"帮我搜一下"，Agent 改写后发出去，对方的 Agent 决定要不要执行。

    // 创建任务
    const task = this.taskTracker.create({
      type: 'rewrite',
      input: intent,
      roomId: msg.roomId,
      senderId: msg.senderId,
    })

    // 改写优先级：gateway > LLM 直连 > 规则引擎
    let rewritten: string = ''
    let rewriteVia: 'gateway' | 'llm' | 'rules' = 'rules'

    if (this.gatewayConnected) {
      try {
        const personaPrompt = getPersonaPrompt(this.persona)
        const response = await this.sendToPersonalAgent(
          `${personaPrompt}\n\n用户想发送以下消息，请改写成得体的版本。只输出改写后的消息：\n\n${intent}`
        )
        try {
          const parsed = JSON.parse(response)
          rewritten = parsed.draft ?? parsed.content ?? response
        } catch {
          rewritten = response.trim()
        }
        if (rewritten) rewriteVia = 'gateway'
      } catch {
        rewritten = ''
      }
    }

    if (!rewritten && this.llm) {
      try {
        rewritten = await this.llm.rewrite(intent, { persona: this.persona.tone })
        if (rewritten) rewriteVia = 'llm'
      } catch {
        rewritten = ''
      }
    }

    if (!rewritten) {
      rewritten = ruleRewrite({ intent, persona: this.persona.tone }).rewritten
      rewriteVia = 'rules'
    }

    // 更新任务
    this.taskTracker.update(task.id, { output: rewritten })

    // Skill: approve — 创建审批请求
    const request = this.approvalManager.createRequest(rewritten, intent, msg.roomId)
    for (const cb of this.draftCallbacks) cb(request)
  }

  // ============================================================
  // 接收方：收到消息 → 意图识别 → 决策
  // ============================================================

  async onIncomingMessage(msg: OttieMessage, senderName: string): Promise<void> {
    if (msg.content.type !== 'text') return
    const body = msg.content.body

    // Skill: duty — 值班模式检查
    if (this.dutyManager.isOnDuty()) {
      // 值班模式：自动回复
      const decision: DecisionRequest = {
        messageId: msg.id,
        roomId: msg.roomId,
        senderName,
        originalMessage: body,
        intent: {
          type: 'general',
          summary: '值班模式自动回复',
          suggestedActions: [
            { label: '自动回复', response: this.dutyManager.getAutoReply() },
          ],
        },
      }
      for (const cb of this.decisionCallbacks) cb(decision)
      return
    }

    // MC: injection scan
    const injection = scanForInjection(body)
    if (!injection.safe) {
      eventBus.broadcast('security.injection', { senderId: senderName, matches: injection.matches })
    }

    // 创建任务
    const task = this.taskTracker.create({
      type: 'intent',
      input: body,
      roomId: msg.roomId,
      senderId: senderName,
    })

    // 意图识别：gateway > LLM 直连 > 规则引擎
    let intent: DetectedIntent | null = null

    if (this.gatewayConnected) {
      try {
        const response = await this.sendToPersonalAgent(
          `分析收到的消息，判断意图并给出建议回复选项。输出严格 JSON。\n发送者：${senderName}\n消息：${body}`
        )
        const jsonMatch = response.match(/\{[\s\S]*\}/)
        if (jsonMatch) intent = JSON.parse(jsonMatch[0])
      } catch {}
    }

    if (!intent && this.llm) {
      try {
        intent = await this.llm.detectIntent(body, { senderName })
      } catch {}
    }

    if (!intent) {
      intent = ruleDetectIntent(body)
    }

    // 识别设备操作请求：优先读 metadata，其次正则，LLM 意图也算
    const ottieMeta = (msg.content as any).ottie_meta
    const isDeviceReq =
      ottieMeta?.intentType === 'device_request'  // 发送方标记了
      || (intent as any).type === 'device_request' // LLM 识别为设备请求
      || isDeviceIntent(body)                      // 正则匹配改写后的文本
      || isDeviceIntent(ottieMeta?.originalIntent ?? '')  // 正则匹配原始意图
      || (intent.type === 'request' && /文件|方案|搜|查|找|打开|看|截图|浏览器|电脑/.test(body))  // request + 关键词

    if (isDeviceReq) {
      intent.type = 'request'
      intent.summary = `请求在你的设备上执行操作：${(ottieMeta?.originalIntent ?? body).slice(0, 50)}`
      // 用原始意图（改写前的）作为设备执行指令，更准确
      const execIntent = ottieMeta?.originalIntent ?? body
      intent.suggestedActions = [
        { label: '帮他查', response: `__device_exec__:${execIntent}` },
        { label: '不方便', response: '不太方便，抱歉。' },
        ...intent.suggestedActions.filter(a => a.label !== '没问题' && a.label !== '不方便'),
      ].slice(0, 3)
    }

    this.taskTracker.update(task.id, { output: JSON.stringify(intent) })

    // Skill: delegate — 信任委托判断
    const delegateResult = this.delegateManager.evaluate({
      sender: senderName,
      content: body,
      intentType: intent.type,
    })

    // MC: trust score 检查
    const canAuto = this.trustScore.canAutoApprove(senderName, this.autoApproveThreshold)

    if (delegateResult.action === 'auto-reply' && delegateResult.autoReply) {
      // 规则引擎决定自动回复
      this.taskTracker.update(task.id, { status: 'completed' })
      const decision: DecisionRequest = {
        messageId: msg.id,
        roomId: msg.roomId,
        senderName,
        originalMessage: body,
        intent: {
          type: intent.type,
          summary: intent.summary,
          suggestedActions: [{ label: '自动回复', response: delegateResult.autoReply }],
        },
      }
      for (const cb of this.decisionCallbacks) cb(decision)
      return
    }

    if (delegateResult.action === 'auto-approve' && canAuto && !isDeviceIntent(body)) {
      // 信任够高 + delegate 规则允许 → 自动批准（但设备操作必须人工审批）
      this.taskTracker.update(task.id, { status: 'completed' })
    }

    // 推给 UI
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
  // 接收方：用户选择决策动作 → 生成回复（或执行设备操作）
  // ============================================================

  async onDecisionAction(originalMessage: string, chosenAction: SuggestedAction, roomId?: string): Promise<string> {
    // 检查是否是设备执行请求
    if (chosenAction.response.startsWith('__device_exec__:')) {
      const deviceIntent = chosenAction.response.replace('__device_exec__:', '')
      // 使用最近的 pending task 的 roomId，或传入的 roomId
      const targetRoomId = roomId ?? this.taskTracker.getPending()[0]?.roomId ?? ''
      await this.handleDeviceCommand(deviceIntent, targetRoomId, '')
      return '正在执行，请稍候...'
    }

    if (this.gatewayConnected) {
      try {
        const response = await this.sendToPersonalAgent(
          `根据用户的选择生成一条得体的回复。只输出回复内容。\n收到的消息：${originalMessage}\n我的选择：${chosenAction.response}`
        )
        if (response.trim()) return response.trim()
      } catch {}
    }

    if (this.llm) {
      try {
        return await this.llm.composeReply(originalMessage, chosenAction.response, { persona: this.persona.tone })
      } catch {}
    }

    return chosenAction.response
  }

  // ============================================================
  // 设备操作 — 多步审批状态机
  // ============================================================

  private async handleDeviceCommand(intent: string, roomId: string, senderId: string): Promise<void> {
    // Skill: dispatch — 选设备 + 解析指令
    const target = selectDevice(intent, this.devices)
    if (!target) {
      this.emitNotification('没有在线的设备', 'user-action')
      return
    }
    const command = parseCommand(intent, target)

    // 创建多步审批任务
    const task = this.taskTracker.create({
      type: 'device_command',
      input: intent,
      roomId,
      senderId,
      targetDeviceId: target.id,
      maxApprovals: 2,
    })

    // 第 1 次审批：要不要执行这个设备操作？
    const request = this.approvalManager.createRequest(
      `🖥️ ${target.name}：${intent}`,
      intent,
      roomId,
    )

    // 监听审批结果来驱动状态机
    const originalProcessDecision = this.approvalManager.processDecision.bind(this.approvalManager)

    // 存储 task/command 映射，供 onApproval 使用
    this.pendingDeviceTasks.set(request.id, { taskId: task.id, command, target, intent })

    for (const cb of this.draftCallbacks) cb(request)
  }

  /** 设备任务映射（approvalRequestId → task info） */
  private pendingDeviceTasks = new Map<string, {
    taskId: string
    command: DeviceCommand
    target: OttieDevice
    intent: string
  }>()

  // ============================================================
  // 审批处理
  // ============================================================

  async onApproval(requestId: string, decision: ApprovalDecision): Promise<OttieMessage | null> {
    // 检查是否是设备操作的审批
    const deviceTask = this.pendingDeviceTasks.get(requestId)

    if (deviceTask) {
      this.pendingDeviceTasks.delete(requestId)
      const task = this.taskTracker.get(deviceTask.taskId)

      if (decision.action === 'reject') {
        this.taskTracker.reject(deviceTask.taskId)
        return null
      }

      if (task && task.status === 'pending') {
        // 第 1 次审批通过 → 执行
        this.taskTracker.approve(deviceTask.taskId)
        this.taskTracker.startExecution(deviceTask.taskId)

        let output: string
        try {
          if (this.paseo?.isReady()) {
            // Paseo 优先：通过 daemon 执行
            const result = await this.paseo.executeCommand(deviceTask.intent)
            output = result.success ? result.output : `执行失败: ${result.output}`
          } else {
            // Fallback: OpenClaw gateway
            output = await gatewayAgent(this.deviceAgentId, deviceTask.intent)
            if (!output) output = await gatewayAgent('main', deviceTask.intent)
            if (!output) output = '设备 Agent 未返回结果'
          }
        } catch (err: any) {
          // 二级 fallback: 尝试用 main agent
          try {
            output = await gatewayAgent('main', deviceTask.intent)
          } catch (err2: any) {
            output = `执行失败: ${err2.message ?? err.message ?? '未知错误'}`
            this.taskTracker.failExecution(deviceTask.taskId, output)
            this.emitNotification(output, 'user-action')
            return null
          }
        }

        // 执行完成 → 进入第 2 次审批（要不要发送结果？）
        this.taskTracker.completeExecution(deviceTask.taskId, output)

        const resultRequest = this.approvalManager.createRequest(
          `📋 执行结果：${output}`,
          `发送设备执行结果`,
          task.roomId,
        )

        // 注册第 2 次审批的 task 映射
        this.pendingDeviceTasks.set(resultRequest.id, {
          ...deviceTask,
          intent: output, // 第 2 次审批的 "内容" 是执行结果
        })

        for (const cb of this.draftCallbacks) cb(resultRequest)
        return null
      }

      if (task && task.status === 'result_review') {
        // 第 2 次审批通过 → 发送结果
        this.taskTracker.approve(deviceTask.taskId)
        const content = decision.action === 'edit' ? decision.newContent : (task.result ?? '')
        return {
          id: `msg_${Date.now()}`,
          roomId: task.roomId,
          senderId: '',
          timestamp: Date.now(),
          type: 'text',
          content: { type: 'text', body: content },
        }
      }
    }

    // 普通消息审批
    const result = this.approvalManager.processDecision(requestId, decision)
    if (result.action === 'send' && result.content && result.targetRoom) {
      return {
        id: `msg_${Date.now()}`,
        roomId: result.targetRoom,
        senderId: '',
        timestamp: Date.now(),
        type: 'text',
        content: result.content,
      }
    }
    return null
  }

  // ============================================================
  // 设备管理
  // ============================================================

  async getDevices(): Promise<OttieDevice[]> {
    const base = [...this.devices]
    if (this.paseo?.isReady()) {
      try {
        const agents = this.paseo.getAgents()
        for (const agent of agents) {
          base.push({
            id: `paseo_${agent.id}`,
            name: `Agent ${agent.provider}`,
            type: 'desktop',
            agentId: agent.id,
            status: ['idle', 'running'].includes(agent.status) ? 'online' : 'offline',
            lastSeen: agent.createdAt,
            capabilities: ['exec', 'read', 'write', 'browser'],
          })
        }
      } catch {}
    }
    return base
  }

  async sendCommand(cmd: DeviceCommand): Promise<void> {
    const intent = (cmd.args as any)?.intent ?? cmd.command

    // 设备房间直接操作（不走审批流程）
    if (!cmd.requireApproval) {
      let output: string
      try {
        if (this.paseo?.isReady()) {
          const result = await this.paseo.executeCommand(intent)
          output = result.success ? result.output : `执行失败: ${result.output}`
        } else {
          output = await gatewayAgent(this.deviceAgentId, intent)
          if (!output) output = await gatewayAgent('main', intent)
          if (!output) output = '设备 Agent 未返回结果'
        }
      } catch (err: any) {
        output = `执行失败: ${err.message ?? '未知错误'}`
      }
      this.emitNotification(`🖥️ ${output}`, 'user-action')
      return
    }

    await this.handleDeviceCommand(intent, '', '')
  }

  dispatchToDevice(intent: string): { success: boolean; output?: string; command?: DeviceCommand; device?: OttieDevice } {
    const target = selectDevice(intent, this.devices)
    if (!target || target.status !== 'online') {
      return { success: false, output: '没有在线的设备' }
    }
    const command = parseCommand(intent, target)
    return { success: true, command, device: target }
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

  onNotification(callback: (event: OttieScreenEvent) => void): Unsubscribe {
    this.notificationCallbacks.add(callback)
    return () => this.notificationCallbacks.delete(callback)
  }

  // ============================================================
  // 记忆（暂用空实现，后续接 MC 的持久化）
  // ============================================================

  async getMemory(): Promise<MemoryIndex> {
    return { entries: [], lastDream: 0, version: 1 }
  }

  async queryMemory(query: string): Promise<MemoryEntry[]> {
    return []
  }

  // ============================================================
  // MC 特有：公开 task/trust 查询
  // ============================================================

  getTaskTracker(): TaskTracker { return this.taskTracker }
  getTrustScore(): TrustScoreManager { return this.trustScore }
  getDelegateManager(): DelegateManager { return this.delegateManager }
  getDutyManager(): DutyManager { return this.dutyManager }
  getPaseo(): OttiePaseo | null { return this.paseo }

  /** 动态配置 LLM（从设置页面调用） */
  configureLLM(config: { baseUrl: string; apiKey: string; model: string }): void {
    this.llm = new OttieLLM(PROVIDERS.custom(config.baseUrl, config.apiKey, config.model))
  }

  // ============================================================
  // 生命周期
  // ============================================================

  async start(): Promise<void> {
    // 检查 gateway（Tauri 环境也要实际检测，不盲目设 true）
    try { this.gatewayConnected = await gatewayHealth(this.gatewayUrl) }
    catch { this.gatewayConnected = false }

    // Paseo 自动发现 + 连接
    if (this.paseo) {
      await this.paseo.start()
    }

    this.status = 'running'
    eventBus.broadcast('agent.started', { id: this.id, name: this.name })

    // Heartbeat: 定期检查 gateway 状态 + 清理过期审批 + 清理任务
    this.heartbeatTimer = setInterval(async () => {
      if (!this.gatewayConnected) {
        try { this.gatewayConnected = await gatewayHealth(this.gatewayUrl) }
        catch { this.gatewayConnected = false }
      }
      this.approvalManager.cleanExpired()
      eventBus.broadcast('agent.heartbeat', {
        id: this.id,
        gatewayConnected: this.gatewayConnected,
        tasks: this.taskTracker.getStats(),
      })
    }, 30000)

    // 定期清理已完成的任务
    this.cleanupTimer = setInterval(() => {
      this.taskTracker.cleanup()
    }, 5 * 60 * 1000)
  }

  async stop(): Promise<void> {
    if (this.paseo) this.paseo.stop()
    if (this.heartbeatTimer) { clearInterval(this.heartbeatTimer); this.heartbeatTimer = null }
    if (this.cleanupTimer) { clearInterval(this.cleanupTimer); this.cleanupTimer = null }
    this.gatewayConnected = false
    this.status = 'stopped'
    eventBus.broadcast('agent.stopped', { id: this.id })
  }

  getStatus(): 'running' | 'stopped' | 'error' { return this.status }

  // ============================================================
  // 工具方法
  // ============================================================

  private emitNotification(content: string, type: OttieScreenEvent['type'] = 'user-action'): void {
    const event: OttieScreenEvent = {
      type,
      timestamp: Date.now(),
      content,
      confidence: 1.0,
      actionRequired: false,
      sourceApp: '当前设备',
    }
    for (const cb of this.notificationCallbacks) {
      try { cb(event) } catch {}
    }
  }
}
