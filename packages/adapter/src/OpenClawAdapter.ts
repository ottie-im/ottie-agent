/**
 * OpenClawAdapter — OttieAgentAdapter 的默认实现
 *
 * 发送方：用户输入 → LLM/规则改写 → 审批 → 发出
 * 接收方：收到消息 → LLM/规则意图识别 → 决策卡片 → 用户选择 → 生成回复
 *
 * LLM 配置后用 LLM，不配置降级到规则引擎。
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
  Unsubscribe,
  DetectedIntent,
  DecisionRequest,
  SuggestedAction,
} from '@ottie-im/contracts'

import { rewrite, analyzeGUIPopup, analyzeCLIPrompt } from '@ottie-im/skills'
import { createApprovalManager } from '@ottie-im/skills'

// Memory is optional — uses fs on Node, skipped in browser
let OttieMemory: any = null
try {
  OttieMemory = require('@ottie-im/memory').OttieMemory
} catch {
  // Browser environment — memory not available
}

// Screen is optional — only available on desktop (not browser)
let OttieScreenClass: any = null
try {
  OttieScreenClass = require('@ottie-im/screen').OttieScreen
} catch {
  // Browser environment or screenpipe not installed
}

export interface OpenClawAdapterConfig {
  name?: string
  persona?: string
  soulPath?: string     // SOUL.md 文件路径（Node 环境用）
  memoryPath?: string
  llm?: { baseUrl: string; apiKey: string; model: string }
  enableScreen?: boolean // 是否启用屏幕感知（默认 false）
}

// ---- LLM helpers ----

let llmClient: any = null
let llmModel = ''

async function llmChat(
  messages: { role: string; content: string }[],
  opts?: { temperature?: number; max_tokens?: number }
): Promise<string> {
  if (!llmClient) return ''
  const resp = await llmClient.chat.completions.create({
    model: llmModel,
    messages,
    temperature: opts?.temperature ?? 0.7,
    max_tokens: opts?.max_tokens ?? 500,
  })
  return resp.choices[0]?.message?.content ?? ''
}

async function llmRewrite(intent: string, persona: string): Promise<string> {
  return llmChat([
    { role: 'system', content: `你是 Ottie，AI IM 秘书。把用户的口语化指令改写成适合发送给对方的得体消息。
规则：保持原始意图，提取指令中真正要发的内容（如"帮我问他..."→去掉前缀），语言跟随用户，简洁自然。只输出改写后的消息。
你的对外人格：${persona}` },
    { role: 'user', content: intent },
  ], { temperature: 0.6, max_tokens: 200 })
}

async function llmDetectIntent(message: string, senderName?: string): Promise<DetectedIntent> {
  const raw = await llmChat([
    { role: 'system', content: `分析收到的消息，判断意图并给出建议回复选项。
输出严格 JSON：{"type":"invitation|question|request|info|greeting|general","summary":"一句话总结","suggestedActions":[{"label":"按钮文字2-4字","response":"点击后的回复"}]}
- suggestedActions 最多 3 个，第一个是正面回应
- 回复自然得体${senderName ? `\n发送者：${senderName}` : ''}` },
    { role: 'user', content: message },
  ], { temperature: 0.3, max_tokens: 300 })

  try {
    const jsonMatch = raw.match(/\{[\s\S]*\}/)
    if (jsonMatch) return JSON.parse(jsonMatch[0])
  } catch {}
  return ruleDetectIntent(message)
}

async function llmComposeReply(originalMessage: string, userChoice: string): Promise<string> {
  return llmChat([
    { role: 'system', content: '根据用户的选择生成一条得体的回复。简洁自然，只输出回复内容。' },
    { role: 'user', content: `收到的消息：${originalMessage}\n我的选择：${userChoice}\n请生成回复：` },
  ], { temperature: 0.6, max_tokens: 150 })
}

// ---- Rule-based fallbacks ----

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

  private persona: string
  private approvalManager: ReturnType<typeof createApprovalManager>
  private memory: any
  private screen: any = null
  private status: 'running' | 'stopped' | 'error' = 'stopped'
  private llmEnabled = false
  private enableScreen: boolean

  private draftCallbacks: Set<(draft: ApprovalRequest) => void> = new Set()
  private decisionCallbacks: Set<(decision: DecisionRequest) => void> = new Set()
  private notificationCallbacks: Set<(event: OttieScreenEvent) => void> = new Set()

  constructor(config: OpenClawAdapterConfig = {}) {
    this.id = `openclaw_${Date.now()}`
    this.name = config.name ?? 'Ottie'
    this.persona = config.persona ?? '友好、得体、简洁'
    this.approvalManager = createApprovalManager()
    this.memory = OttieMemory ? new OttieMemory(config.memoryPath ?? './MEMORY.md') : null
    this.enableScreen = config.enableScreen ?? false
    if (config.llm) this.configureLLM(config.llm)
  }

  // ============================================================
  // LLM 配置
  // ============================================================

  configureLLM(config: { baseUrl: string; apiKey: string; model: string }): void {
    // Dynamic import to avoid bundling openai in non-LLM builds
    import('openai').then(({ default: OpenAI }) => {
      llmClient = new OpenAI({
        baseURL: config.baseUrl,
        apiKey: config.apiKey,
        dangerouslyAllowBrowser: true,
      })
      llmModel = config.model
      this.llmEnabled = true
      console.log(`🦦 Agent LLM: ${config.model} via ${config.baseUrl}`)
    }).catch(() => {
      console.warn('🦦 OpenAI SDK not available, using rule engine')
    })
  }

  getAgentCard(): AgentCard {
    return {
      name: this.name,
      capabilities: ['中文', '英文', '消息改写', '审批', '意图识别'],
      persona: this.persona,
    }
  }

  // ============================================================
  // 发送方：用户输入 → 改写 → 审批
  // ============================================================

  async onMessage(msg: OttieMessage): Promise<void> {
    if (msg.content.type !== 'text') return
    const intent = msg.content.body

    let rewritten: string
    if (this.llmEnabled) {
      try {
        rewritten = await llmRewrite(intent, this.persona)
      } catch {
        rewritten = ruleRewrite(intent)
      }
    } else {
      const result = rewrite({ intent, persona: this.persona })
      rewritten = result.rewritten
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
    if (this.llmEnabled) {
      try {
        intent = await llmDetectIntent(body, senderName)
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
    if (this.llmEnabled) {
      try {
        return await llmComposeReply(originalMessage, chosenAction.response)
      } catch {
        return chosenAction.response
      }
    }
    return chosenAction.response
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
  // 记忆 + 生命周期
  // ============================================================

  async getMemory(): Promise<MemoryIndex> { return this.memory?.load() ?? { entries: [], lastDream: 0, version: 1 } }
  async queryMemory(query: string): Promise<MemoryEntry[]> { return this.memory?.query(query) ?? [] }

  async start(): Promise<void> {
    if (this.memory) await this.memory.load()

    // Start screen sensing if enabled and available
    if (this.enableScreen && OttieScreenClass) {
      this.screen = new OttieScreenClass()
      this.screen.onEvent((event: OttieScreenEvent) => {
        // Analyze the event using skills
        let summary = event.content.slice(0, 100)
        if (event.type === 'gui-popup') {
          const result = analyzeGUIPopup(event)
          summary = result.summary
        } else if (event.type === 'cli-prompt') {
          const result = analyzeCLIPrompt(event)
          summary = result.summary
        }

        // Write to memory
        if (this.memory) {
          this.memory.observe(event, this.id).catch(() => {})
        }

        // Push notification to IM layer
        for (const cb of this.notificationCallbacks) {
          try { cb({ ...event, content: summary }) } catch {}
        }
      })
      await this.screen.start()
    }

    this.status = 'running'
  }

  async stop(): Promise<void> {
    if (this.screen) { this.screen.stop(); this.screen = null }
    this.status = 'stopped'
  }

  getStatus(): 'running' | 'stopped' | 'error' { return this.status }
}
