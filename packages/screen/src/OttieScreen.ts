/**
 * OttieScreen — 封装 Screenpipe REST API
 *
 * 通过轮询 Screenpipe 的 /search 和 /elements 端点，
 * 检测 GUI 弹窗和 CLI 提示，产出 OttieScreenEvent。
 *
 * Screenpipe 需要单独运行（npx screenpipe@latest record）。
 * 如果 Screenpipe 没有运行，OttieScreen 会 graceful 降级，不阻塞其他功能。
 */

import type { OttieScreenEvent, ScreenConfig, Unsubscribe } from '@ottie-im/contracts'
import { matchPattern } from './patterns'

export interface OttieScreenConfig {
  baseUrl?: string      // 默认 http://localhost:3030
  pollInterval?: number // 轮询间隔 ms，默认 2000
}

interface ScreenpipeSearchResult {
  type: string
  content: {
    text: string
    timestamp: string
    app_name: string
    window_name: string
    frame_id: number
  }
}

export class OttieScreen {
  private baseUrl: string
  private pollInterval: number
  private timer: ReturnType<typeof setInterval> | null = null
  private callbacks: Set<(event: OttieScreenEvent) => void> = new Set()
  private lastSeenTexts: Set<string> = new Set() // 去重用
  private available = false

  constructor(config: OttieScreenConfig = {}) {
    this.baseUrl = config.baseUrl ?? 'http://localhost:3030'
    this.pollInterval = config.pollInterval ?? 2000
  }

  // ============================================================
  // 健康检查
  // ============================================================

  async isAvailable(): Promise<boolean> {
    try {
      const resp = await fetch(`${this.baseUrl}/health`, { signal: AbortSignal.timeout(3000) })
      this.available = resp.ok
      return this.available
    } catch {
      this.available = false
      return false
    }
  }

  // ============================================================
  // 启动/停止轮询
  // ============================================================

  async start(): Promise<void> {
    const ok = await this.isAvailable()
    if (!ok) {
      return
    }

    this.timer = setInterval(() => this.poll(), this.pollInterval)
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
    this.available = false
  }

  // ============================================================
  // 事件回调
  // ============================================================

  onEvent(callback: (event: OttieScreenEvent) => void): Unsubscribe {
    this.callbacks.add(callback)
    return () => this.callbacks.delete(callback)
  }

  private emit(event: OttieScreenEvent) {
    for (const cb of this.callbacks) {
      try { cb(event) } catch {}
    }
  }

  // ============================================================
  // 轮询逻辑
  // ============================================================

  private async poll(): Promise<void> {
    try {
      // 查最近 5 秒的屏幕内容
      const now = new Date()
      const fiveSecsAgo = new Date(now.getTime() - 5000)
      const params = new URLSearchParams({
        content_type: 'ocr',
        limit: '20',
        start_time: fiveSecsAgo.toISOString(),
        end_time: now.toISOString(),
      })

      const resp = await fetch(`${this.baseUrl}/search?${params}`, {
        signal: AbortSignal.timeout(5000),
      })
      if (!resp.ok) return

      const data = await resp.json()
      const results: ScreenpipeSearchResult[] = data.data ?? []

      for (const result of results) {
        const text = result.content?.text
        const appName = result.content?.app_name
        if (!text) continue

        // 去重：同一段文本只触发一次
        const dedupeKey = `${appName}:${text.slice(0, 100)}`
        if (this.lastSeenTexts.has(dedupeKey)) continue

        // 匹配 pattern
        const pattern = matchPattern(text, appName)
        if (pattern) {
          this.lastSeenTexts.add(dedupeKey)

          this.emit({
            type: pattern.type,
            timestamp: new Date(result.content.timestamp).getTime(),
            content: text,
            confidence: pattern.confidence,
            actionRequired: pattern.actionRequired,
            sourceApp: appName,
          })
        }
      }

      // 定期清理去重缓存（保留最近 200 条）
      if (this.lastSeenTexts.size > 200) {
        const arr = Array.from(this.lastSeenTexts)
        this.lastSeenTexts = new Set(arr.slice(-100))
      }
    } catch {
      // Screenpipe 可能暂时不可用，静默忽略
    }
  }

  // ============================================================
  // 手动查询
  // ============================================================

  async query(timeRange: { start: number; end: number }): Promise<OttieScreenEvent[]> {
    if (!this.available) return []

    try {
      const params = new URLSearchParams({
        content_type: 'ocr',
        limit: '50',
        start_time: new Date(timeRange.start).toISOString(),
        end_time: new Date(timeRange.end).toISOString(),
      })

      const resp = await fetch(`${this.baseUrl}/search?${params}`, {
        signal: AbortSignal.timeout(10000),
      })
      if (!resp.ok) return []

      const data = await resp.json()
      const results: ScreenpipeSearchResult[] = data.data ?? []

      return results
        .filter(r => r.content?.text)
        .map(r => {
          const pattern = matchPattern(r.content.text, r.content.app_name)
          return {
            type: (pattern?.type ?? 'screen-change') as OttieScreenEvent['type'],
            timestamp: new Date(r.content.timestamp).getTime(),
            content: r.content.text,
            confidence: pattern?.confidence ?? 0.5,
            actionRequired: pattern?.actionRequired ?? false,
            sourceApp: r.content.app_name,
          }
        })
    } catch {
      return []
    }
  }

  // ============================================================
  // UI 元素搜索（用于精确检测按钮）
  // ============================================================

  async searchElements(query: string, role?: string): Promise<{ text: string; role: string; appName: string }[]> {
    if (!this.available) return []

    try {
      const params = new URLSearchParams({ q: query })
      if (role) params.set('role', role)

      const resp = await fetch(`${this.baseUrl}/elements?${params}`, {
        signal: AbortSignal.timeout(5000),
      })
      if (!resp.ok) return []

      const data = await resp.json()
      return (data.data ?? []).map((el: any) => ({
        text: el.text ?? '',
        role: el.role ?? '',
        appName: el.app_name ?? '',
      }))
    } catch {
      return []
    }
  }

  isRunning(): boolean {
    return this.timer !== null
  }
}
