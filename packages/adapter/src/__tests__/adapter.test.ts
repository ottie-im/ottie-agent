import { describe, it, expect, beforeEach } from 'vitest'
import { OpenClawAdapter } from '../OpenClawAdapter'
import { MockAdapter } from '../MockAdapter'
import type { OttieAgentAdapter, OttieMessage, ApprovalRequest } from '@ottie-im/contracts'

// Helper: 创建一条用户输入消息
function makeUserMessage(body: string, roomId = '!room:localhost'): OttieMessage {
  return {
    id: `msg_${Date.now()}`,
    roomId,
    senderId: '@user:localhost',
    timestamp: Date.now(),
    type: 'text',
    content: { type: 'text', body },
  }
}

// 通用测试：任何 OttieAgentAdapter 实现都必须通过
function testAdapterContract(name: string, createAdapter: () => OttieAgentAdapter) {
  describe(`${name} — OttieAgentAdapter 接口`, () => {
    let adapter: OttieAgentAdapter

    beforeEach(async () => {
      adapter = createAdapter()
      await adapter.start()
    })

    it('should have basic info', () => {
      expect(adapter.id).toBeTruthy()
      expect(adapter.name).toBeTruthy()
      expect(adapter.getAgentCard().name).toBeTruthy()
    })

    it('should be in running state after start', () => {
      expect(adapter.getStatus()).toBe('running')
    })

    it('should stop properly', async () => {
      await adapter.stop()
      expect(adapter.getStatus()).toBe('stopped')
    })

    it('should produce a draft on message', async () => {
      const drafts: ApprovalRequest[] = []
      adapter.onDraft(d => drafts.push(d))

      await adapter.onMessage(makeUserMessage('问他周五去不去吃饭'))

      expect(drafts).toHaveLength(1)
      expect(drafts[0].originalIntent).toBe('问他周五去不去吃饭')
      expect(drafts[0].draft).toBeTruthy()
      expect(drafts[0].targetRoom).toBe('!room:localhost')
    })

    it('should return message on approve', async () => {
      const drafts: ApprovalRequest[] = []
      adapter.onDraft(d => drafts.push(d))

      await adapter.onMessage(makeUserMessage('hello'))

      const msg = await adapter.onApproval(drafts[0].id, { action: 'approve' })
      expect(msg).not.toBeNull()
      expect(msg!.content.type).toBe('text')
    })

    it('should return edited message on edit', async () => {
      const drafts: ApprovalRequest[] = []
      adapter.onDraft(d => drafts.push(d))

      await adapter.onMessage(makeUserMessage('hello'))

      const msg = await adapter.onApproval(drafts[0].id, {
        action: 'edit',
        newContent: '自定义内容',
      })
      expect(msg).not.toBeNull()
      expect(msg!.content).toEqual({ type: 'text', body: '自定义内容' })
    })

    it('should return null on reject', async () => {
      const drafts: ApprovalRequest[] = []
      adapter.onDraft(d => drafts.push(d))

      await adapter.onMessage(makeUserMessage('hello'))

      const msg = await adapter.onApproval(drafts[0].id, { action: 'reject' })
      expect(msg).toBeNull()
    })

    it('should unsubscribe from drafts', async () => {
      const drafts: ApprovalRequest[] = []
      const unsub = adapter.onDraft(d => drafts.push(d))
      unsub()

      await adapter.onMessage(makeUserMessage('hello'))
      expect(drafts).toHaveLength(0)
    })
  })
}

// 测试两种实现都满足接口
testAdapterContract('OpenClawAdapter', () => new OpenClawAdapter({ memoryPath: '/tmp/ottie-test-memory.md' }))
testAdapterContract('MockAdapter', () => new MockAdapter())

// OpenClaw 特有的改写测试
describe('OpenClawAdapter — 改写能力', () => {
  let adapter: OpenClawAdapter

  beforeEach(async () => {
    adapter = new OpenClawAdapter({ memoryPath: '/tmp/ottie-test-memory.md' })
    await adapter.start()
  })

  it('should rewrite command-style intent', async () => {
    const drafts: ApprovalRequest[] = []
    adapter.onDraft(d => drafts.push(d))

    await adapter.onMessage(makeUserMessage('帮我问他周五去不去吃饭'))

    // 改写后应该去掉"帮我问他"
    expect(drafts[0].draft).not.toContain('帮我')
    expect(drafts[0].draft).toContain('周五')
  })

  it('should not change already polished messages', async () => {
    const drafts: ApprovalRequest[] = []
    adapter.onDraft(d => drafts.push(d))

    await adapter.onMessage(makeUserMessage('周五晚上有空一起吃个饭吗？'))

    // 已经很好了，应该基本不变
    expect(drafts[0].draft).toContain('周五')
  })
})
