/**
 * OttiePaseo — 设备 agent 管理层
 *
 * 通过 Tauri commands 直接管理 agent 进程（claude / codex CLI），
 * 不依赖外部 daemon 或 Node.js 运行时。
 *
 * Tauri 环境：invoke('create_agent') → Rust spawn CLI → stdout 流式 emit
 * 非 Tauri 环境：graceful 降级，isReady() 返回 false
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

// ---- Tauri IPC helpers ----

function getTauriInvoke(): ((cmd: string, args?: any) => Promise<any>) | null {
  if (typeof window !== 'undefined' && (window as any).__TAURI_INTERNALS__) {
    return (window as any).__TAURI_INTERNALS__.invoke
  }
  return null
}

async function tauriListen(event: string, handler: (payload: any) => void): Promise<(() => void) | null> {
  try {
    // 动态 import — 仅在 Tauri 环境下可用
    const mod = await (Function('return import("@tauri-apps/api/event")')() as Promise<any>)
    const unlisten = await mod.listen(event, (e: any) => handler(e.payload))
    return unlisten
  } catch {
    return null
  }
}

// ---- Main class ----

export class OttiePaseo {
  private defaultProvider: PaseoProvider
  private defaultCwd: string

  private daemonStatus: PaseoDaemonStatus = 'disconnected'
  private agents: Map<string, PaseoAgentInfo> = new Map()
  private statusCallbacks: Set<(s: PaseoStatusSnapshot) => void> = new Set()
  private eventListeners: Set<(event: any) => void> = new Set()

  private unlistenStream: (() => void) | null = null
  private unlistenUpdate: (() => void) | null = null

  private availableProviders: string[] = []

  constructor(config: OttiePaseoConfig = {}) {
    this.defaultProvider = config.defaultProvider ?? 'claude'
    this.defaultCwd = config.defaultCwd ?? '/'
  }

  // ============================================================
  // 健康检查 — 检测 Tauri 环境 + 可用 provider
  // ============================================================

  async isAvailable(): Promise<boolean> {
    const invoke = getTauriInvoke()
    if (!invoke) return false
    try {
      const providers: any[] = await invoke('detect_providers')
      this.availableProviders = providers.filter((p: any) => p.available).map((p: any) => p.id)
      return this.availableProviders.length > 0
    } catch {
      return false
    }
  }

  // ============================================================
  // 连接 = 注册 Tauri event listeners
  // ============================================================

  async connect(): Promise<boolean> {
    const invoke = getTauriInvoke()
    if (!invoke) {
      this.daemonStatus = 'error'
      this.emitStatus()
      return false
    }

    this.daemonStatus = 'connecting'
    this.emitStatus()

    // 注册 agent-stream 事件
    this.unlistenStream = await tauriListen('agent-stream', (payload: any) => {
      for (const listener of this.eventListeners) {
        try {
          listener({
            type: 'agent_stream',
            agentId: payload.agentId,
            event: payload.event,
          })
        } catch {}
      }
    })

    // 注册 agent-update 事件
    this.unlistenUpdate = await tauriListen('agent-update', (payload: any) => {
      const agentId = payload.agentId
      const status = payload.status

      // 更新本地 agent 状态
      if (agentId) {
        const existing = this.agents.get(agentId)
        if (existing) {
          existing.status = status
          if (payload.output) existing.title = payload.output.slice(0, 100)
        }
        this.emitStatus()
      }

      // 通知 listeners
      for (const listener of this.eventListeners) {
        try {
          listener({
            type: 'agent_update',
            agentId,
            status,
            output: payload.output ?? '',
            provider: payload.provider,
          })
        } catch {}
      }
    })

    // 拉取当前 agent 列表
    await this.refreshAgents()

    this.daemonStatus = 'connected'
    this.emitStatus()
    return true
  }

  async disconnect(): Promise<void> {
    this.unlistenStream?.()
    this.unlistenStream = null
    this.unlistenUpdate?.()
    this.unlistenUpdate = null
    this.agents.clear()
    this.daemonStatus = 'disconnected'
    this.emitStatus()
  }

  // ============================================================
  // 生命周期
  // ============================================================

  async start(): Promise<void> {
    const available = await this.isAvailable()
    if (available) {
      await this.connect()
    } else {
      // Tauri IPC 可能还没就绪，延迟重试
      setTimeout(async () => {
        if (this.daemonStatus !== 'connected') {
          const retry = await this.isAvailable()
          if (retry) await this.connect()
        }
      }, 3000)
    }
  }

  stop(): void {
    this.disconnect()
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
    const invoke = getTauriInvoke()
    if (!invoke || !this.isReady()) return null

    const provider = options?.provider ?? this.defaultProvider
    try {
      const agentId: string = await invoke('create_agent', {
        provider,
        cwd: options?.cwd ?? this.defaultCwd,
        prompt: options?.initialPrompt ?? '',
      })

      this.agents.set(agentId, {
        id: agentId,
        provider,
        status: 'running',
        title: options?.title ?? null,
        cwd: options?.cwd ?? this.defaultCwd,
        createdAt: Date.now(),
      })
      this.emitStatus()
      return agentId
    } catch {
      return null
    }
  }

  getAgents(): PaseoAgentInfo[] {
    return Array.from(this.agents.values())
  }

  async refreshAgents(): Promise<PaseoAgentInfo[]> {
    const invoke = getTauriInvoke()
    if (!invoke) return []

    try {
      const entries: any[] = await invoke('list_agents')
      this.agents.clear()
      for (const e of entries) {
        this.agents.set(e.id, {
          id: e.id,
          provider: e.provider as PaseoProvider,
          status: e.status,
          title: e.output?.slice(0, 100) ?? null,
          cwd: e.cwd,
          createdAt: (e.created_at ?? 0) * 1000,
        })
      }
      this.emitStatus()
      return this.getAgents()
    } catch {
      return this.getAgents()
    }
  }

  async cancelAgent(agentId: string): Promise<void> {
    const invoke = getTauriInvoke()
    if (!invoke) return
    try { await invoke('cancel_agent', { agentId }) } catch {}
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

    const agentId = await this.createAgent({
      provider,
      cwd: options?.cwd ?? this.defaultCwd,
      initialPrompt: intent,
    })

    if (!agentId) {
      return { success: false, output: '无法创建 Agent', agentId: '', provider }
    }

    // 等待 agent-update 事件
    return new Promise<PaseoExecResult>((resolve) => {
      const timeout = setTimeout(() => {
        this.eventListeners.delete(listener)
        this.cancelAgent(agentId).catch(() => {})
        resolve({ success: false, output: '执行超时', agentId, provider })
      }, timeoutMs)

      const listener = (event: any) => {
        if (event.type !== 'agent_update') return
        if (event.agentId !== agentId) return

        const status = event.status
        if (status === 'idle' || status === 'error' || status === 'cancelled') {
          clearTimeout(timeout)
          this.eventListeners.delete(listener)
          resolve({
            success: status === 'idle',
            output: event.output || '执行完成',
            agentId,
            provider,
          })
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
      availableProviders: this.availableProviders,
    }
  }

  getDaemonStatus(): PaseoDaemonStatus {
    return this.daemonStatus
  }

  isReady(): boolean {
    return this.daemonStatus === 'connected'
  }

  getAvailableProviders(): string[] {
    return this.availableProviders
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
}
