/**
 * skill-ota — OTA 更新检测
 *
 * 检测新模型版本、新 Skill 版本，推送提醒给用户。
 * 用户确认后一键更新。
 */

export interface OTAUpdate {
  id: string
  type: 'model' | 'skill' | 'agent' | 'app'
  name: string
  currentVersion: string
  newVersion: string
  description: string
  size?: string       // e.g. "2.3GB"
  releaseDate: string
  autoInstall: boolean
}

export interface OTAConfig {
  checkInterval: number  // ms, 默认 24 小时
  autoCheck: boolean
  notifyOnly: boolean    // true = 只通知不自动安装
  sources: OTASource[]
}

export interface OTASource {
  name: string
  url: string           // API endpoint to check updates
  type: 'model' | 'skill' | 'agent' | 'app'
}

const DEFAULT_CONFIG: OTAConfig = {
  checkInterval: 24 * 60 * 60 * 1000, // 24 hours
  autoCheck: true,
  notifyOnly: true,
  sources: [
    { name: 'Ollama Models', url: 'http://localhost:11434/api/tags', type: 'model' },
  ],
}

export class OTAManager {
  private config: OTAConfig
  private pendingUpdates: OTAUpdate[] = []
  private timer: ReturnType<typeof setInterval> | null = null

  constructor(config?: Partial<OTAConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config }
  }

  /**
   * 启动定期检查
   */
  start(): void {
    if (!this.config.autoCheck) return
    this.check() // 立即检查一次
    this.timer = setInterval(() => this.check(), this.config.checkInterval)
  }

  stop(): void {
    if (this.timer) { clearInterval(this.timer); this.timer = null }
  }

  /**
   * 手动检查更新
   */
  async check(): Promise<OTAUpdate[]> {
    const updates: OTAUpdate[] = []

    for (const source of this.config.sources) {
      try {
        if (source.type === 'model') {
          const modelUpdates = await this.checkModelUpdates(source)
          updates.push(...modelUpdates)
        }
        // 其他类型的更新检查后续扩展
      } catch {
        // 静默忽略检查失败
      }
    }

    this.pendingUpdates = updates
    return updates
  }

  /**
   * 检查 Ollama 本地模型更新
   */
  private async checkModelUpdates(source: OTASource): Promise<OTAUpdate[]> {
    try {
      const resp = await fetch(source.url, { signal: AbortSignal.timeout(5000) })
      if (!resp.ok) return []

      const data = await resp.json()
      const models = data.models ?? []

      // 如果有模型安装了，返回可用更新信息
      // 实际的版本比对需要跟远程 registry 对比，这里先返回已安装列表
      return models.map((m: any) => ({
        id: `model_${m.name}`,
        type: 'model' as const,
        name: m.name,
        currentVersion: m.digest?.slice(0, 12) ?? 'unknown',
        newVersion: 'latest',
        description: `本地模型 ${m.name}`,
        size: m.size ? `${(m.size / 1024 / 1024 / 1024).toFixed(1)}GB` : undefined,
        releaseDate: m.modified_at ?? new Date().toISOString(),
        autoInstall: false,
      }))
    } catch {
      return []
    }
  }

  getPendingUpdates(): OTAUpdate[] {
    return [...this.pendingUpdates]
  }

  getConfig(): OTAConfig {
    return { ...this.config }
  }
}
