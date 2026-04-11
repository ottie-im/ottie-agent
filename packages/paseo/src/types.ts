/**
 * Paseo bridge 本地类型
 * contracts 只读，所有设备 agent 特有类型定义在此
 */

export type PaseoDaemonStatus = 'connected' | 'disconnected' | 'connecting' | 'error'

export type PaseoProvider = 'claude' | 'codex'

export interface PaseoAgentInfo {
  id: string
  provider: PaseoProvider
  status: string // running | idle | error | cancelled
  title: string | null
  cwd: string
  createdAt: number
}

export interface OttiePaseoConfig {
  /** Default agent provider, default 'claude' */
  defaultProvider?: PaseoProvider
  /** Default working directory for new agents */
  defaultCwd?: string
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
  availableProviders?: string[]
}
