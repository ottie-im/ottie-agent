/**
 * TaskTracker — 内存任务追踪
 *
 * 借鉴 MC 的任务状态机，适配 Ottie 的 IM 场景。
 * 每次 rewrite、intent-detection、device-command 都是一个 task。
 * 多步审批场景（审批→执行→再审批→回传）通过 task 状态机驱动。
 *
 * 状态机：
 *   pending → approved → executing → result_review → completed
 *                                                   → rejected
 *            → rejected (用户拒绝)
 */

import { eventBus } from './event-bus'

export type TaskStatus =
  | 'pending'          // 等待第一次审批
  | 'approved'         // 用户批准，准备执行
  | 'executing'        // 设备 Agent 执行中
  | 'result_review'    // 执行完成，等待第二次审批（结果回传前）
  | 'completed'        // 全部完成
  | 'rejected'         // 用户拒绝
  | 'failed'           // 执行失败

export type TaskType =
  | 'rewrite'          // 消息改写
  | 'intent'           // 意图识别
  | 'device_command'   // 设备指令
  | 'reply'            // 生成回复

export interface OttieTask {
  id: string
  type: TaskType
  status: TaskStatus
  createdAt: number
  updatedAt: number

  // 内容
  input: string              // 原始输入
  output?: string            // agent 输出
  result?: string            // 执行结果（设备指令场景）

  // 上下文
  roomId: string
  senderId?: string          // 请求方
  targetDeviceId?: string    // 目标设备

  // 成本
  tokenUsage?: {
    model: string
    inputTokens: number
    outputTokens: number
    cost: number
  }

  // 审批
  approvalCount: number      // 已经过几次审批
  maxApprovals: number       // 最多需要几次审批（设备操作=2，普通改写=1）
}

export class TaskTracker {
  private tasks = new Map<string, OttieTask>()

  create(params: {
    type: TaskType
    input: string
    roomId: string
    senderId?: string
    targetDeviceId?: string
    maxApprovals?: number
  }): OttieTask {
    const task: OttieTask = {
      id: `task_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      type: params.type,
      status: 'pending',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      input: params.input,
      roomId: params.roomId,
      senderId: params.senderId,
      targetDeviceId: params.targetDeviceId,
      approvalCount: 0,
      maxApprovals: params.maxApprovals ?? (params.type === 'device_command' ? 2 : 1),
    }
    this.tasks.set(task.id, task)
    eventBus.broadcast('task.created', task)
    return task
  }

  update(taskId: string, updates: Partial<OttieTask>): OttieTask | null {
    const task = this.tasks.get(taskId)
    if (!task) return null
    Object.assign(task, updates, { updatedAt: Date.now() })
    eventBus.broadcast('task.updated', task)
    return task
  }

  approve(taskId: string): OttieTask | null {
    const task = this.tasks.get(taskId)
    if (!task) return null

    task.approvalCount++
    task.updatedAt = Date.now()

    if (task.approvalCount >= task.maxApprovals) {
      // 所有审批通过
      if (task.type === 'device_command' && task.status === 'result_review') {
        task.status = 'completed'
        eventBus.broadcast('task.completed', task)
      } else if (task.type === 'device_command' && task.status === 'pending') {
        task.status = 'approved'
        // 下一步：执行
      } else {
        task.status = 'completed'
        eventBus.broadcast('task.completed', task)
      }
    } else {
      // 还需要更多审批
      if (task.status === 'pending') {
        task.status = 'approved'
      } else if (task.status === 'result_review') {
        task.status = 'completed'
        eventBus.broadcast('task.completed', task)
      }
    }

    eventBus.broadcast('task.updated', task)
    return task
  }

  reject(taskId: string): OttieTask | null {
    const task = this.tasks.get(taskId)
    if (!task) return null
    task.status = 'rejected'
    task.updatedAt = Date.now()
    eventBus.broadcast('task.updated', task)
    return task
  }

  startExecution(taskId: string): OttieTask | null {
    const task = this.tasks.get(taskId)
    if (!task || task.status !== 'approved') return null
    task.status = 'executing'
    task.updatedAt = Date.now()
    eventBus.broadcast('task.updated', task)
    return task
  }

  completeExecution(taskId: string, result: string): OttieTask | null {
    const task = this.tasks.get(taskId)
    if (!task || task.status !== 'executing') return null
    task.result = result
    task.updatedAt = Date.now()

    // 如果是设备指令，需要第二次审批（结果回传前）
    if (task.type === 'device_command' && task.approvalCount < task.maxApprovals) {
      task.status = 'result_review'
    } else {
      task.status = 'completed'
      eventBus.broadcast('task.completed', task)
    }

    eventBus.broadcast('task.updated', task)
    return task
  }

  failExecution(taskId: string, error: string): OttieTask | null {
    const task = this.tasks.get(taskId)
    if (!task) return null
    task.status = 'failed'
    task.result = error
    task.updatedAt = Date.now()
    eventBus.broadcast('task.failed', task)
    return task
  }

  recordTokenUsage(taskId: string, usage: OttieTask['tokenUsage']): void {
    const task = this.tasks.get(taskId)
    if (!task) return
    task.tokenUsage = usage
    if (usage) {
      eventBus.broadcast('llm.token_usage', { taskId, ...usage })
    }
  }

  get(taskId: string): OttieTask | null {
    return this.tasks.get(taskId) ?? null
  }

  getByRoom(roomId: string): OttieTask[] {
    return Array.from(this.tasks.values())
      .filter(t => t.roomId === roomId)
      .sort((a, b) => b.createdAt - a.createdAt)
  }

  getPending(): OttieTask[] {
    return Array.from(this.tasks.values())
      .filter(t => t.status === 'pending' || t.status === 'result_review')
  }

  getStats(): { total: number; completed: number; failed: number; pending: number } {
    const all = Array.from(this.tasks.values())
    return {
      total: all.length,
      completed: all.filter(t => t.status === 'completed').length,
      failed: all.filter(t => t.status === 'failed').length,
      pending: all.filter(t => t.status === 'pending' || t.status === 'result_review').length,
    }
  }

  /** 清理已完成超过 1 小时的任务 */
  cleanup(): number {
    const cutoff = Date.now() - 60 * 60 * 1000
    let cleaned = 0
    for (const [id, task] of this.tasks) {
      if ((task.status === 'completed' || task.status === 'rejected' || task.status === 'failed') && task.updatedAt < cutoff) {
        this.tasks.delete(id)
        cleaned++
      }
    }
    return cleaned
  }
}
