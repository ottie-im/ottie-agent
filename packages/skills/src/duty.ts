/**
 * skill-duty — 值班模式
 *
 * 当所有设备离线时（用户睡觉/出门），Agent 自动进入值班模式。
 * 值班时只做轻量自动回复，不做复杂操作。
 */

export interface DutyConfig {
  enabled: boolean
  autoReplyMessage: string
  // 值班时间（可选，不设则全天候）
  schedule?: {
    start: string  // "22:00"
    end: string    // "08:00"
  }
}

const DEFAULT_CONFIG: DutyConfig = {
  enabled: false,
  autoReplyMessage: '我现在不方便回复，稍后联系你。',
}

export class DutyManager {
  private config: DutyConfig

  constructor(config?: Partial<DutyConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config }
  }

  /**
   * 是否当前处于值班模式
   */
  isOnDuty(): boolean {
    if (!this.config.enabled) return false

    if (this.config.schedule) {
      const now = new Date()
      const hour = now.getHours()
      const minute = now.getMinutes()
      const current = hour * 60 + minute

      const [startH, startM] = this.config.schedule.start.split(':').map(Number)
      const [endH, endM] = this.config.schedule.end.split(':').map(Number)
      const start = startH * 60 + startM
      const end = endH * 60 + endM

      // Handle overnight (e.g., 22:00 - 08:00)
      if (start > end) {
        return current >= start || current < end
      }
      return current >= start && current < end
    }

    return true // No schedule = always on duty when enabled
  }

  /**
   * 获取值班自动回复
   */
  getAutoReply(): string {
    return this.config.autoReplyMessage
  }

  enable(): void { this.config.enabled = true }
  disable(): void { this.config.enabled = false }
  getConfig(): DutyConfig { return { ...this.config } }

  setAutoReply(message: string): void {
    this.config.autoReplyMessage = message
  }

  setSchedule(start: string, end: string): void {
    this.config.schedule = { start, end }
  }
}
