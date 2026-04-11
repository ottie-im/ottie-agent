/**
 * OttiePaseo — 连接本地 Paseo daemon 的轻量级 bridge
 *
 * 使用原生 WebSocket + fetch 直接通信（不导入 @getpaseo/server，
 * 因为它包含 Node.js native 依赖，无法在 Vite/浏览器环境中打包）。
 *
 * 模式参考 OttieScreen：
 * - constructor 接收配置 + 设默认值
 * - isAvailable() 健康检查
 * - start() / stop() 生命周期
 * - 事件回调 + Unsubscribe
 * - 服务不可用时静默降级
 */

import type { Unsubscribe } from '@ottie-im/contracts'
import type {
  OttiePaseoConfig,
  PaseoDaemonStatus,
  PaseoProvider,
  PaseoAgentInfo,
  PaseoExecResult,
  PaseoStatusSnapshot,
} from './types'

/** Paseo WebSocket protocol version */
const PROTOCOL_VERSION = 1

/** Generate unique request ID */
function reqId(): string {
  return `ottie_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
}

export class OttiePaseo {
  // Config
  private wsUrl: string
  private httpUrl: string
  private clientId: string
  private defaultProvider: PaseoProvider
  private defaultCwd: string
  private reconnectInterval: number

  // State
  private ws: WebSocket | null = null
  private daemonStatus: PaseoDaemonStatus = 'disconnected'
  private agents: Map<string, PaseoAgentInfo> = new Map()
  private statusCallbacks: Set<(s: PaseoStatusSnapshot) => void> = new Set()
  private reconnectTimer: ReturnType<typeof setInterval> | null = null
  private daemonVersion: string | undefined

  // 请求-响应映射（requestId → resolve callback）
  private pendingRequests: Map<string, {
    resolve: (data: any) => void
    reject: (err: Error) => void
    timer: ReturnType<typeof setTimeout>
  }> = new Map()

  // 流式事件监听器
  private eventListeners: Set<(event: any) => void> = new Set()

  constructor(config: OttiePaseoConfig = {}) {
    const httpBase = config.httpUrl ?? config.daemonUrl ?? 'http://localhost:6767'
    this.httpUrl = httpBase.replace(/^ws/, 'http')
    this.wsUrl = (config.daemonUrl ?? httpBase).replace(/^http/, 'ws')
    this.clientId = config.clientId ?? 'ottie'
    this.defaultProvider = config.defaultProvider ?? 'claude'
    this.defaultCwd = config.defaultCwd ?? '/'
    this.reconnectInterval = config.reconnectInterval ?? 10000
  }

  // ============================================================
  // 健康检查
  // ============================================================

  async isAvailable(): Promise<boolean> {
    try {
      const resp = await fetch(`${this.httpUrl}/api/health`, {
        signal: AbortSignal.timeout(3000),
      })
      if (!resp.ok) return false
      const data = await resp.json()
      return data.status === 'ok'
    } catch {
      return false
    }
  }

  // ============================================================
  // WebSocket 连接
  // ============================================================

  async connect(): Promise<boolean> {
    if (this.daemonStatus === 'connected' && this.ws) return true

    this.daemonStatus = 'connecting'
    this.emitStatus()

    return new Promise<boolean>((resolve) => {
      try {
        const ws = new WebSocket(`${this.wsUrl}/ws`)
        let settled = false

        const timeout = setTimeout(() => {
          if (!settled) {
            settled = true
            ws.close()
            this.daemonStatus = 'error'
            this.emitStatus()
            resolve(false)
          }
        }, 10000)

        ws.onopen = () => {
          // 发送 hello 握手
          ws.send(JSON.stringify({
            type: 'hello',
            clientId: this.clientId,
            clientType: 'browser',
            protocolVersion: PROTOCOL_VERSION,
          }))
        }

        ws.onmessage = (event) => {
          try {
            const data = JSON.parse(event.data as string)
            this.handleMessage(data)

            // 首次收到 server_info 表示握手成功
            if (!settled && data.type === 'session' && data.message?.type === 'status'
              && data.message?.payload?.status === 'server_info') {
              settled = true
              clearTimeout(timeout)
              this.ws = ws
              this.daemonStatus = 'connected'
              this.daemonVersion = data.message.payload.version
              this.emitStatus()
              // 拉取 agent 列表
              this.refreshAgents().catch(() => {})
              resolve(true)
            }
          } catch {}
        }

        ws.onclose = () => {
          if (!settled) {
            settled = true
            clearTimeout(timeout)
            this.daemonStatus = 'error'
            this.emitStatus()
            resolve(false)
          } else {
            this.ws = null
            this.daemonStatus = 'disconnected'
            this.agents.clear()
            // reject 所有 pending requests
            for (const [id, req] of this.pendingRequests) {
              clearTimeout(req.timer)
              req.reject(new Error('WebSocket closed'))
            }
            this.pendingRequests.clear()
            this.emitStatus()
          }
        }

        ws.onerror = () => {
          if (!settled) {
            settled = true
            clearTimeout(timeout)
            this.daemonStatus = 'error'
            this.emitStatus()
            resolve(false)
          }
        }
      } catch {
        this.daemonStatus = 'error'
        this.emitStatus()
        resolve(false)
      }
    })
  }

  async disconnect(): Promise<void> {
    if (this.ws) {
      this.ws.close()
      this.ws = null
    }
    this.agents.clear()
    this.daemonStatus = 'disconnected'
    for (const [, req] of this.pendingRequests) {
      clearTimeout(req.timer)
      req.reject(new Error('Disconnected'))
    }
    this.pendingRequests.clear()
    this.emitStatus()
  }

  // ============================================================
  // 生命周期
  // ============================================================

  async start(): Promise<void> {
    const available = await this.isAvailable()
    if (available) {
      await this.connect()
    }
    this.startReconnectPolling()
  }

  stop(): void {
    this.stopReconnectPolling()
    this.disconnect()
  }

  // ============================================================
  // WebSocket 消息处理
  // ============================================================

  private send(message: any): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return
    this.ws.send(JSON.stringify(message))
  }

  /** 发送 session 消息并等待响应 */
  private sendRequest(message: any, timeoutMs = 60000): Promise<any> {
    return new Promise((resolve, reject) => {
      const requestId = message.requestId
      const timer = setTimeout(() => {
        this.pendingRequests.delete(requestId)
        reject(new Error('Request timeout'))
      }, timeoutMs)

      this.pendingRequests.set(requestId, { resolve, reject, timer })
      this.send({ type: 'session', message })
    })
  }

  private handleMessage(data: any): void {
    if (data.type === 'session' && data.message) {
      const msg = data.message

      // 检查是否是 pending request 的响应
      // requestId 可能在 msg.payload.requestId 或 msg.requestId
      const respRequestId = msg.payload?.requestId ?? msg.requestId
      if (respRequestId) {
        const pending = this.pendingRequests.get(respRequestId)
        if (pending) {
          clearTimeout(pending.timer)
          this.pendingRequests.delete(respRequestId)
          pending.resolve(msg)
          return
        }
      }

      // agent_stream — Paseo 的主要事件通道
      // 格式: msg.payload.agentId, msg.payload.event.type
      if (msg.type === 'agent_stream') {
        const agentId = msg.payload?.agentId
        const streamEvent = msg.payload?.event
        const event = {
          type: 'agent_stream' as const,
          agentId,
          streamType: streamEvent?.type, // timeline, turn_started, turn_completed, attention_required
          event: streamEvent,
          payload: msg.payload,
        }

        // 更新本地 agent 状态
        this.handleAgentEvent(event)

        // 通知 listeners
        for (const listener of this.eventListeners) {
          try { listener(event) } catch {}
        }
      }

      // agent_update — 部分 Paseo 版本可能使用
      if (msg.type === 'agent_update') {
        const event = {
          type: 'agent_update' as const,
          agentId: msg.agentId ?? msg.payload?.id,
          payload: msg.payload,
        }
        this.handleAgentEvent(event)
        for (const listener of this.eventListeners) {
          try { listener(event) } catch {}
        }
      }

      // status 消息
      if (msg.type === 'status' && msg.payload?.version) {
        this.daemonVersion = msg.payload.version
      }

      // agent_deleted / agent_archived
      if (msg.type === 'agent_deleted' || msg.type === 'agent_archived') {
        const agentId = msg.payload?.agentId ?? msg.agentId
        if (agentId) {
          this.agents.delete(agentId)
          this.emitStatus()
        }
      }
    }
  }

  private handleAgentEvent(event: any): void {
    const agentId = event.agentId
    if (!agentId) return

    if (event.type === 'agent_update' && event.payload) {
      const existing = this.agents.get(agentId)
      if (existing) {
        existing.status = event.payload.status ?? existing.status
        existing.title = event.payload.title ?? existing.title
      } else {
        this.agents.set(agentId, {
          id: agentId,
          provider: (event.payload.provider ?? event.payload.type ?? 'claude') as PaseoProvider,
          status: event.payload.status ?? 'idle',
          title: event.payload.title ?? null,
          cwd: event.payload.cwd ?? '',
          createdAt: event.payload.createdAt
            ? new Date(event.payload.createdAt).getTime()
            : Date.now(),
        })
      }
      this.emitStatus()
    }
  }

  // ============================================================
  // Agent 操作
  // ============================================================

  async createAgent(options?: {
    provider?: PaseoProvider
    cwd?: string
    initialPrompt?: string
    title?: string
  }): Promise<string | null> {
    if (!this.isReady()) return null
    const requestId = reqId()
    const provider = options?.provider ?? this.defaultProvider

    try {
      const resp = await this.sendRequest({
        type: 'create_agent_request',
        requestId,
        config: {
          provider,
          cwd: options?.cwd ?? this.defaultCwd,
        },
        ...(options?.initialPrompt ? { initialPrompt: options.initialPrompt } : {}),
      })

      // agent_created 响应: msg.payload.agent 或 msg.payload 本身
      const agent = resp?.payload?.agent ?? resp?.payload
      const agentId = agent?.id
      if (agentId) {
        this.agents.set(agentId, {
          id: agentId,
          provider: (agent.provider ?? agent.type ?? provider) as PaseoProvider,
          status: agent.status ?? 'initializing',
          title: agent.title ?? options?.title ?? null,
          cwd: agent.cwd ?? options?.cwd ?? this.defaultCwd,
          createdAt: agent.createdAt ? new Date(agent.createdAt).getTime() : Date.now(),
        })
        this.emitStatus()
        return agentId
      }
      return null
    } catch {
      return null
    }
  }

  async sendToAgent(agentId: string, message: string): Promise<void> {
    if (!this.isReady()) return
    const requestId = reqId()
    this.send({
      type: 'session',
      message: {
        type: 'send_agent_message',
        agentId,
        text: message,
        requestId,
      },
    })
  }

  getAgents(): PaseoAgentInfo[] {
    return Array.from(this.agents.values())
  }

  async refreshAgents(): Promise<PaseoAgentInfo[]> {
    if (!this.isReady()) return []
    const requestId = reqId()

    try {
      const resp = await this.sendRequest({
        type: 'fetch_agents_request',
        requestId,
        sort: [{ key: 'updated_at', direction: 'desc' as const }],
        page: { limit: 50 },
      }, 10000)

      this.agents.clear()
      const entries = resp?.payload?.entries ?? resp?.entries ?? []
      for (const entry of entries) {
        const agent = entry.agent ?? entry
        if (agent?.id) {
          this.agents.set(agent.id, {
            id: agent.id,
            provider: (agent.provider ?? agent.type ?? 'claude') as PaseoProvider,
            status: agent.status ?? 'idle',
            title: agent.title ?? null,
            cwd: agent.cwd ?? '',
            createdAt: agent.createdAt ? new Date(agent.createdAt).getTime() : Date.now(),
          })
        }
      }
      this.emitStatus()
      return this.getAgents()
    } catch {
      return this.getAgents()
    }
  }

  async cancelAgent(agentId: string): Promise<void> {
    if (!this.isReady()) return
    this.send({
      type: 'session',
      message: {
        type: 'cancel_agent_request',
        agentId,
        requestId: reqId(),
      },
    })
  }

  async archiveAgent(agentId: string): Promise<void> {
    if (!this.isReady()) return
    this.send({
      type: 'session',
      message: {
        type: 'archive_agent_request',
        agentId,
        requestId: reqId(),
      },
    })
  }

  // ============================================================
  // 高级：设备命令执行
  // ============================================================

  async executeCommand(intent: string, options?: {
    provider?: PaseoProvider
    cwd?: string
    timeoutMs?: number
  }): Promise<PaseoExecResult> {
    const provider = options?.provider ?? this.defaultProvider
    const timeoutMs = options?.timeoutMs ?? 120000

    if (!this.isReady()) {
      return { success: false, output: '设备 Agent 未连接', agentId: '', provider }
    }

    // 创建新 agent，intent 作为 initialPrompt
    const agentId = await this.createAgent({
      provider,
      cwd: options?.cwd ?? this.defaultCwd,
      initialPrompt: intent,
    })

    if (!agentId) {
      return { success: false, output: '无法创建 Agent', agentId: '', provider }
    }

    // 等待 agent 完成（idle/error/closed）
    return new Promise<PaseoExecResult>((resolve) => {
      let lastOutput = ''

      const timeout = setTimeout(() => {
        this.eventListeners.delete(listener)
        this.cancelAgent(agentId).catch(() => {})
        resolve({ success: false, output: '执行超时', agentId, provider })
      }, timeoutMs)

      const listener = (event: any) => {
        if (event.agentId !== agentId) return

        if (event.type === 'agent_stream') {
          const streamEvt = event.event
          // 收集 assistant_message 输出和 shell 命令输出
          if (streamEvt?.type === 'timeline') {
            const item = streamEvt.item
            if (item?.type === 'assistant_message' && item.text) {
              lastOutput += item.text
            }
            if (item?.type === 'tool_call' && item.detail?.output) {
              lastOutput += item.detail.output
            }
          }
          // 完成标志：attention_required + reason: finished
          if (streamEvt?.type === 'attention_required' && streamEvt?.reason === 'finished') {
            clearTimeout(timeout)
            this.eventListeners.delete(listener)
            resolve({
              success: true,
              output: lastOutput.trim() || '执行完成',
              agentId,
              provider,
            })
          }
          // 错误标志
          if (streamEvt?.type === 'attention_required' && streamEvt?.reason === 'error') {
            clearTimeout(timeout)
            this.eventListeners.delete(listener)
            resolve({
              success: false,
              output: lastOutput.trim() || '执行出错',
              agentId,
              provider,
            })
          }
        }

        // 兼容 agent_update 格式
        if (event.type === 'agent_update') {
          const status = event.payload?.status
          if (status === 'idle' || status === 'error' || status === 'closed') {
            clearTimeout(timeout)
            this.eventListeners.delete(listener)
            resolve({
              success: status === 'idle',
              output: lastOutput.trim() || event.payload?.lastError || '执行完成',
              agentId,
              provider,
            })
          }
        }
      }

      this.eventListeners.add(listener)
    })
  }

  // ============================================================
  // 状态
  // ============================================================

  onStatusChange(callback: (s: PaseoStatusSnapshot) => void): Unsubscribe {
    this.statusCallbacks.add(callback)
    return () => this.statusCallbacks.delete(callback)
  }

  getStatus(): PaseoStatusSnapshot {
    return {
      daemonStatus: this.daemonStatus,
      agents: this.getAgents(),
      daemonVersion: this.daemonVersion,
    }
  }

  getDaemonStatus(): PaseoDaemonStatus {
    return this.daemonStatus
  }

  isReady(): boolean {
    return this.daemonStatus === 'connected' && this.ws !== null
  }

  // ============================================================
  // 内部
  // ============================================================

  private emitStatus(): void {
    const snapshot = this.getStatus()
    for (const cb of this.statusCallbacks) {
      try { cb(snapshot) } catch {}
    }
  }

  private startReconnectPolling(): void {
    if (this.reconnectTimer) return
    this.reconnectTimer = setInterval(async () => {
      if (this.isReady()) return
      const available = await this.isAvailable()
      if (available && !this.isReady()) {
        await this.connect()
      }
    }, this.reconnectInterval)
  }

  private stopReconnectPolling(): void {
    if (this.reconnectTimer) {
      clearInterval(this.reconnectTimer)
      this.reconnectTimer = null
    }
  }
}
