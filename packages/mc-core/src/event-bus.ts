/**
 * EventBus — 统一事件分发
 *
 * 纯浏览器实现（不依赖 Node.js events 模块）。
 * 所有 agent 内部事件通过此 bus 广播，替代零散的 callback Set。
 */

export interface OttieEvent {
  type: string
  data: any
  timestamp: number
}

export type OttieEventType =
  // Agent 生命周期
  | 'agent.started'
  | 'agent.stopped'
  | 'agent.heartbeat'
  | 'agent.error'
  // 任务流
  | 'task.created'
  | 'task.updated'
  | 'task.completed'
  | 'task.failed'
  // 审批流
  | 'approval.created'
  | 'approval.decided'
  // 意图识别
  | 'intent.detected'
  | 'decision.created'
  // 设备
  | 'device.command'
  | 'device.result'
  | 'device.online'
  | 'device.offline'
  // 安全
  | 'security.injection'
  | 'security.boundary_violation'
  // LLM
  | 'llm.call'
  | 'llm.token_usage'

type Listener = (...args: any[]) => void

class OttieEventBus {
  private static instance: OttieEventBus | null = null
  private listeners = new Map<string, Set<Listener>>()

  private constructor() {}

  static getInstance(): OttieEventBus {
    if (!OttieEventBus.instance) {
      OttieEventBus.instance = new OttieEventBus()
    }
    return OttieEventBus.instance
  }

  private on(event: string, fn: Listener): void {
    if (!this.listeners.has(event)) this.listeners.set(event, new Set())
    this.listeners.get(event)!.add(fn)
  }

  private off(event: string, fn: Listener): void {
    this.listeners.get(event)?.delete(fn)
  }

  private emit(event: string, ...args: any[]): void {
    const fns = this.listeners.get(event)
    if (fns) for (const fn of fns) { try { fn(...args) } catch {} }
  }

  broadcast(type: OttieEventType, data: any): OttieEvent {
    const event: OttieEvent = { type, data, timestamp: Date.now() }
    this.emit('ottie-event', event)
    this.emit(type, data)
    return event
  }

  onEvent(callback: (event: OttieEvent) => void): () => void {
    this.on('ottie-event', callback)
    return () => this.off('ottie-event', callback)
  }

  onType(type: OttieEventType, callback: (data: any) => void): () => void {
    this.on(type, callback)
    return () => this.off(type, callback)
  }
}

export const eventBus = OttieEventBus.getInstance()
