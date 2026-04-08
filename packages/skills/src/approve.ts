/**
 * skill-approve: 审批流程管理
 *
 * 管理消息从"Agent 拟稿"到"用户确认后发出"的审批流程。
 */

import type { ApprovalRequest, ApprovalDecision, OttieMessage, OttieMessageContent } from '@ottie-im/contracts'

const APPROVAL_TIMEOUT_MS = 5 * 60 * 1000 // 5 分钟

export interface ApprovalManager {
  createRequest(draft: string, originalIntent: string, targetRoom: string): ApprovalRequest
  processDecision(requestId: string, decision: ApprovalDecision): ApprovalResult
  getPending(): ApprovalRequest[]
  cleanExpired(): string[] // returns expired request IDs
}

export interface ApprovalResult {
  action: 'send' | 'discard'
  content?: OttieMessageContent
  targetRoom?: string
}

export function createApprovalManager(): ApprovalManager {
  const pending = new Map<string, ApprovalRequest>()

  return {
    createRequest(draft: string, originalIntent: string, targetRoom: string): ApprovalRequest {
      const request: ApprovalRequest = {
        id: `approval_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        timestamp: Date.now(),
        draft,
        originalIntent,
        targetRoom,
        source: 'rewrite',
      }
      pending.set(request.id, request)
      return request
    },

    processDecision(requestId: string, decision: ApprovalDecision): ApprovalResult {
      const request = pending.get(requestId)
      if (!request) {
        return { action: 'discard' }
      }

      pending.delete(requestId)

      switch (decision.action) {
        case 'approve':
          return {
            action: 'send',
            content: { type: 'text', body: request.draft },
            targetRoom: request.targetRoom,
          }

        case 'edit':
          return {
            action: 'send',
            content: { type: 'text', body: decision.newContent },
            targetRoom: request.targetRoom,
          }

        case 'reject':
          return { action: 'discard' }
      }
    },

    getPending(): ApprovalRequest[] {
      return Array.from(pending.values())
    },

    cleanExpired(): string[] {
      const now = Date.now()
      const expired: string[] = []
      for (const [id, req] of pending) {
        if (now - req.timestamp > APPROVAL_TIMEOUT_MS) {
          pending.delete(id)
          expired.push(id)
        }
      }
      return expired
    },
  }
}
