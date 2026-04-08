/**
 * MockAdapter — 用于测试的 OttieAgentAdapter 实现
 *
 * 验证标准：把 OpenClawAdapter 换成这个 mock，Ottie IM 代码零修改仍能跑。
 * 这个 mock 直接把消息原样返回，不做改写。
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
} from '@ottie-im/contracts'

export class MockAdapter implements OttieAgentAdapter {
  id = 'mock_adapter'
  name = 'Mock Agent'

  private draftCallbacks: Set<(draft: ApprovalRequest) => void> = new Set()
  private status: 'running' | 'stopped' | 'error' = 'stopped'

  getAgentCard(): AgentCard {
    return {
      name: 'Mock Agent',
      capabilities: ['test'],
    }
  }

  async onMessage(msg: OttieMessage): Promise<void> {
    if (msg.content.type !== 'text') return

    // Mock: 直接用原文创建审批请求
    const request: ApprovalRequest = {
      id: `mock_${Date.now()}`,
      timestamp: Date.now(),
      draft: msg.content.body, // 不改写
      originalIntent: msg.content.body,
      targetRoom: msg.roomId,
      source: 'rewrite',
    }

    for (const cb of this.draftCallbacks) {
      cb(request)
    }
  }

  onDraft(callback: (draft: ApprovalRequest) => void): Unsubscribe {
    this.draftCallbacks.add(callback)
    return () => this.draftCallbacks.delete(callback)
  }

  async onApproval(requestId: string, decision: ApprovalDecision): Promise<OttieMessage | null> {
    if (decision.action === 'reject') return null
    const body = decision.action === 'edit' ? decision.newContent : 'mock message'
    return {
      id: `msg_${Date.now()}`,
      roomId: '',
      senderId: '',
      timestamp: Date.now(),
      type: 'text',
      content: { type: 'text', body },
    }
  }

  onNotification(): Unsubscribe {
    return () => {}
  }

  async start(): Promise<void> { this.status = 'running' }
  async stop(): Promise<void> { this.status = 'stopped' }
  getStatus(): 'running' | 'stopped' | 'error' { return this.status }
}
