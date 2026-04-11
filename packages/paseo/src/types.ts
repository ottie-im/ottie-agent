/**
 * Paseo bridge 本地类型
 * contracts 只读，所有 Paseo 特有类型定义在此
 */

export type PaseoDaemonStatus = 'connected' | 'disconnected' | 'connecting' | 'error'

export type PaseoProvider = 'claude' | 'codex' | 'copilot' | 'opencode' | 'pi'

export interface PaseoAgentInfo {
  id: string
  provider: PaseoProvider
  status: string // initializing | idle | running | error | closed
  title: string | null
  cwd: string
  createdAt: number
}

export interface OttiePaseoConfig {
  /** WebSocket URL, default ws://localhost:6767 */
  daemonUrl?: string
  /** HTTP URL for health check, default http://localhost:6767 */
  httpUrl?: string
  /** Client identifier, default 'ottie' */
  clientId?: string
  /** Default agent provider, default 'claude' */
  defaultProvider?: PaseoProvider
  /** Default working directory for new agents */
  defaultCwd?: string
  /** Reconnect polling interval in ms, default 10000 */
  reconnectInterval?: number
}

export interface PaseoExecResult {
  success: boolean
  output: string
  agentId: string
  provider: PaseoProvider
}

export interface PaseoStatusSnapshot {
  daemonStatus: PaseoDaemonStatus
  agents: PaseoAgentInfo[]
  daemonVersion?: string
}
