/**
 * A2AAdapter — 第三方 Agent 通过 A2A 协议接入 Ottie
 *
 * 实现 OttieAgentAdapter 接口。
 * 内部通过 A2A JSON-RPC 2.0 over HTTP 与远程 Agent 通信。
 *
 * 用户在设置里填入 A2A endpoint URL → Ottie 发现 Agent Card → 切换到此 Agent。
 *
 * A2A 协议参考：https://github.com/google/A2A
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

export interface A2AAdapterConfig {
  /** A2A Agent endpoint URL */
  endpoint: string
  /** Optional API key for the remote Agent */
  apiKey?: string
}

export class A2AAdapter implements OttieAgentAdapter {
  id: string
  name: string

  private endpoint: string
  private apiKey?: string
  private status: 'running' | 'stopped' | 'error' = 'stopped'
  private agentCard: AgentCard | null = null
  private draftCallbacks: Set<(draft: ApprovalRequest) => void> = new Set()
  private decisionCallbacks: Set<(decision: DecisionRequest) => void> = new Set()
  private notificationCallbacks: Set<(event: OttieScreenEvent) => void> = new Set()

  constructor(config: A2AAdapterConfig) {
    this.id = `a2a_${Date.now()}`
    this.name = 'A2A Agent'
    this.endpoint = config.endpoint
    this.apiKey = config.apiKey
  }

  // ============================================================
  // A2A JSON-RPC transport
  // ============================================================

  private async rpc(method: string, params: Record<string, unknown> = {}): Promise<any> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    if (this.apiKey) headers['Authorization'] = `Bearer ${this.apiKey}`

    const resp = await fetch(this.endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: `${Date.now()}`,
        method,
        params,
      }),
    })

    const data = await resp.json()
    if (data.error) throw new Error(data.error.message ?? 'A2A RPC error')
    return data.result
  }

  // ============================================================
  // Lifecycle
  // ============================================================

  async start(): Promise<void> {
    try {
      // Discover Agent Card via A2A
      const card = await this.rpc('agent/info')
      this.agentCard = {
        name: card.name ?? 'A2A Agent',
        capabilities: card.capabilities ?? [],
        persona: card.persona,
      }
      this.name = this.agentCard.name
      this.status = 'running'
    } catch (err) {
      this.status = 'error'
      throw err
    }
  }

  async stop(): Promise<void> {
    this.status = 'stopped'
  }

  getStatus(): 'running' | 'stopped' | 'error' {
    return this.status
  }

  getAgentCard(): AgentCard {
    return this.agentCard ?? { name: this.name, capabilities: ['a2a'] }
  }

  // ============================================================
  // Sending: user input → remote Agent rewrite → approval
  // ============================================================

  async onMessage(msg: OttieMessage): Promise<void> {
    if (msg.content.type !== 'text') return

    try {
      const result = await this.rpc('message/rewrite', {
        intent: msg.content.body,
        roomId: msg.roomId,
      })

      const draft: ApprovalRequest = {
        id: `a2a_draft_${Date.now()}`,
        timestamp: Date.now(),
        draft: result.rewritten ?? msg.content.body,
        originalIntent: msg.content.body,
        targetRoom: msg.roomId,
        source: 'rewrite',
      }

      for (const cb of this.draftCallbacks) cb(draft)
    } catch {
      // Fallback: use original text
      const draft: ApprovalRequest = {
        id: `a2a_draft_${Date.now()}`,
        timestamp: Date.now(),
        draft: msg.content.body,
        originalIntent: msg.content.body,
        targetRoom: msg.roomId,
        source: 'rewrite',
      }
      for (const cb of this.draftCallbacks) cb(draft)
    }
  }

  // ============================================================
  // Receiving: incoming message → remote Agent intent detection
  // ============================================================

  async onIncomingMessage(msg: OttieMessage, senderName: string): Promise<void> {
    if (msg.content.type !== 'text') return

    try {
      const result = await this.rpc('message/detect_intent', {
        message: msg.content.body,
        senderName,
      })

      const decision: DecisionRequest = {
        messageId: msg.id,
        roomId: msg.roomId,
        senderName,
        originalMessage: msg.content.body,
        intent: {
          type: result.type ?? 'general',
          summary: result.summary ?? msg.content.body,
          suggestedActions: result.suggestedActions ?? [
            { label: '收到', response: '收到。' },
          ],
        },
      }

      for (const cb of this.decisionCallbacks) cb(decision)
    } catch {}
  }

  async onDecisionAction(originalMessage: string, chosenAction: SuggestedAction): Promise<string> {
    try {
      const result = await this.rpc('message/compose_reply', {
        originalMessage,
        choice: chosenAction.response,
      })
      return result.reply ?? chosenAction.response
    } catch {
      return chosenAction.response
    }
  }

  // ============================================================
  // Callbacks
  // ============================================================

  onDraft(callback: (draft: ApprovalRequest) => void): Unsubscribe {
    this.draftCallbacks.add(callback)
    return () => this.draftCallbacks.delete(callback)
  }

  onDecision(callback: (decision: DecisionRequest) => void): Unsubscribe {
    this.decisionCallbacks.add(callback)
    return () => this.decisionCallbacks.delete(callback)
  }

  async onApproval(requestId: string, decision: ApprovalDecision): Promise<OttieMessage | null> {
    if (decision.action === 'reject') return null
    const body = decision.action === 'edit' ? decision.newContent : ''
    // The actual message content is managed by the IM layer
    return null
  }

  onNotification(callback: (event: OttieScreenEvent) => void): Unsubscribe {
    this.notificationCallbacks.add(callback)
    return () => this.notificationCallbacks.delete(callback)
  }
}
