/**
 * OpenClawAdapter — OttieAgentAdapter 的默认实现
 *
 * 当前是纯 TypeScript 实现，用 skill-rewrite + skill-approve 组合。
 * 后续可以替换成真正的 OpenClaw 框架。
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
  OttieDevice,
  MemoryIndex,
  MemoryEntry,
  Unsubscribe,
} from '@ottie-im/contracts'

import { rewrite } from '@ottie-im/skills'
import { createApprovalManager } from '@ottie-im/skills'
import { OttieMemory } from '@ottie-im/memory'

export interface OpenClawAdapterConfig {
  name?: string
  persona?: string
  memoryPath?: string
}

export class OpenClawAdapter implements OttieAgentAdapter {
  id: string
  name: string

  private persona: string
  private approvalManager: ReturnType<typeof createApprovalManager>
  private memory: OttieMemory
  private status: 'running' | 'stopped' | 'error' = 'stopped'

  // Callbacks
  private draftCallbacks: Set<(draft: ApprovalRequest) => void> = new Set()
  private notificationCallbacks: Set<(event: OttieScreenEvent) => void> = new Set()

  constructor(config: OpenClawAdapterConfig = {}) {
    this.id = `openclaw_${Date.now()}`
    this.name = config.name ?? 'Ottie'
    this.persona = config.persona ?? '友好、得体、简洁'
    this.approvalManager = createApprovalManager()
    this.memory = new OttieMemory(config.memoryPath ?? './MEMORY.md')
  }

  // ============================================================
  // 基本信息
  // ============================================================

  getAgentCard(): AgentCard {
    return {
      name: this.name,
      capabilities: ['中文', '英文', '消息改写', '审批'],
      persona: this.persona,
    }
  }

  // ============================================================
  // IM → Agent: 收到消息
  // ============================================================

  async onMessage(msg: OttieMessage): Promise<void> {
    // 当 IM 层传来用户输入时，执行改写 → 审批流程
    if (msg.content.type !== 'text') return

    const intent = msg.content.body

    // Step 1: 改写
    const result = rewrite({
      intent,
      persona: this.persona,
    })

    // Step 2: 创建审批请求
    const request = this.approvalManager.createRequest(
      result.rewritten,
      intent,
      msg.roomId,
    )

    // Step 3: 通知 IM 层有新的审批请求
    for (const cb of this.draftCallbacks) {
      cb(request)
    }
  }

  // ============================================================
  // Agent → IM: 拟好消息推给用户审批
  // ============================================================

  onDraft(callback: (draft: ApprovalRequest) => void): Unsubscribe {
    this.draftCallbacks.add(callback)
    return () => this.draftCallbacks.delete(callback)
  }

  // ============================================================
  // IM → Agent: 用户审批结果
  // ============================================================

  async onApproval(requestId: string, decision: ApprovalDecision): Promise<OttieMessage | null> {
    const result = this.approvalManager.processDecision(requestId, decision)

    if (result.action === 'send' && result.content && result.targetRoom) {
      return {
        id: `msg_${Date.now()}`,
        roomId: result.targetRoom,
        senderId: '', // IM 层填充
        timestamp: Date.now(),
        type: 'text',
        content: result.content,
      }
    }

    return null
  }

  // ============================================================
  // Agent → IM: 通知推送
  // ============================================================

  onNotification(callback: (event: OttieScreenEvent) => void): Unsubscribe {
    this.notificationCallbacks.add(callback)
    return () => this.notificationCallbacks.delete(callback)
  }

  // ============================================================
  // 记忆
  // ============================================================

  async getMemory(): Promise<MemoryIndex> {
    return this.memory.load()
  }

  async queryMemory(query: string): Promise<MemoryEntry[]> {
    return this.memory.query(query)
  }

  // ============================================================
  // 生命周期
  // ============================================================

  async start(): Promise<void> {
    await this.memory.load()
    this.status = 'running'
  }

  async stop(): Promise<void> {
    this.status = 'stopped'
  }

  getStatus(): 'running' | 'stopped' | 'error' {
    return this.status
  }
}
