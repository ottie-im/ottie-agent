/**
 * TrustScore — Agent 信任评分
 *
 * 借鉴 MC 的 security-events + agent-evals，简化为内存版。
 * 信任分决定 DelegateManager 是否自动批准。
 *
 * 初始分 1.0，成功任务加分，失败/注入扣分。
 * 分数越高，越多消息可以 auto-approve。
 */

import { eventBus } from './event-bus'

export interface TrustFactors {
  successfulTasks: number
  failedTasks: number
  injectionAttempts: number
  boundaryViolations: number
  totalInteractions: number
}

const WEIGHTS = {
  'task.success': 0.02,
  'task.failure': -0.01,
  'injection.attempt': -0.15,
  'boundary.violation': -0.20,
}

export class TrustScoreManager {
  /** 每个 sender 的信任分 */
  private scores = new Map<string, number>()
  private factors = new Map<string, TrustFactors>()

  constructor() {
    // 自动监听事件
    eventBus.onType('task.completed', (data) => {
      if (data.senderId) this.recordEvent(data.senderId, 'task.success')
    })
    eventBus.onType('task.failed', (data) => {
      if (data.senderId) this.recordEvent(data.senderId, 'task.failure')
    })
    eventBus.onType('security.injection', (data) => {
      if (data.senderId) this.recordEvent(data.senderId, 'injection.attempt')
    })
    eventBus.onType('security.boundary_violation', (data) => {
      if (data.senderId) this.recordEvent(data.senderId, 'boundary.violation')
    })
  }

  recordEvent(senderId: string, eventType: keyof typeof WEIGHTS): void {
    const current = this.scores.get(senderId) ?? 1.0
    const delta = WEIGHTS[eventType] ?? 0
    const newScore = Math.max(0, Math.min(1, current + delta))
    this.scores.set(senderId, newScore)

    // 更新因子
    const f = this.factors.get(senderId) ?? {
      successfulTasks: 0, failedTasks: 0, injectionAttempts: 0,
      boundaryViolations: 0, totalInteractions: 0,
    }
    f.totalInteractions++
    if (eventType === 'task.success') f.successfulTasks++
    if (eventType === 'task.failure') f.failedTasks++
    if (eventType === 'injection.attempt') f.injectionAttempts++
    if (eventType === 'boundary.violation') f.boundaryViolations++
    this.factors.set(senderId, f)
  }

  getScore(senderId: string): number {
    return this.scores.get(senderId) ?? 1.0
  }

  getFactors(senderId: string): TrustFactors {
    return this.factors.get(senderId) ?? {
      successfulTasks: 0, failedTasks: 0, injectionAttempts: 0,
      boundaryViolations: 0, totalInteractions: 0,
    }
  }

  /** 信任分是否足够自动批准 */
  canAutoApprove(senderId: string, threshold = 0.8): boolean {
    return this.getScore(senderId) >= threshold
  }
}
