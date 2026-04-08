/**
 * OttieMemory — MEMORY.md 读写 + autoDream 整理
 *
 * 记忆存储在 MEMORY.md 文件中，格式与 Claude Code 的记忆系统兼容。
 * 每条记忆是一个 MemoryEntry，包含来源、内容、标签等。
 */

import type { MemoryEntry, MemoryIndex, OttieScreenEvent } from '@ottie-im/contracts'
import { readFile, writeFile, mkdir } from 'fs/promises'
import { dirname } from 'path'

export class OttieMemory {
  private memoryPath: string
  private entries: MemoryEntry[] = []
  private lastDream = 0
  private version = 1

  constructor(memoryPath: string) {
    this.memoryPath = memoryPath
  }

  // ============================================================
  // 加载 / 保存
  // ============================================================

  async load(): Promise<MemoryIndex> {
    try {
      const raw = await readFile(this.memoryPath, 'utf-8')
      const parsed = this.parseMemoryMd(raw)
      this.entries = parsed.entries
      this.lastDream = parsed.lastDream
      this.version = parsed.version
    } catch {
      // File doesn't exist yet, start fresh
      this.entries = []
      this.lastDream = 0
      this.version = 1
    }
    return { entries: [...this.entries], lastDream: this.lastDream, version: this.version }
  }

  async save(): Promise<void> {
    const content = this.toMemoryMd()
    await mkdir(dirname(this.memoryPath), { recursive: true })
    await writeFile(this.memoryPath, content, 'utf-8')
  }

  // ============================================================
  // 记忆操作
  // ============================================================

  async update(newEntries: MemoryEntry[]): Promise<void> {
    for (const entry of newEntries) {
      const existing = this.entries.findIndex(e => e.id === entry.id)
      if (existing >= 0) {
        this.entries[existing] = entry
      } else {
        this.entries.push(entry)
      }
    }
    this.version++
    await this.save()
  }

  async query(q: string): Promise<MemoryEntry[]> {
    const lower = q.toLowerCase()
    return this.entries.filter(e =>
      e.content.toLowerCase().includes(lower) ||
      e.tags?.some(t => t.toLowerCase().includes(lower))
    )
  }

  async observe(event: OttieScreenEvent, deviceId: string): Promise<void> {
    const entry: MemoryEntry = {
      id: `mem_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      timestamp: event.timestamp,
      source: 'device',
      deviceId,
      content: event.content.slice(0, 150),
      raw: event.content,
      tags: [event.type],
      confidence: event.confidence,
    }
    this.entries.push(entry)
    await this.save()
  }

  // ============================================================
  // autoDream — 记忆整理
  // ============================================================

  async dream(): Promise<void> {
    // 1. 去重：相同内容的记忆只保留最新的
    const seen = new Map<string, number>()
    for (let i = this.entries.length - 1; i >= 0; i--) {
      const key = this.entries[i].content.toLowerCase().trim()
      if (seen.has(key)) {
        // Mark older one as superseded
        this.entries[i].supersededBy = this.entries[seen.get(key)!].id
      } else {
        seen.set(key, i)
      }
    }

    // 2. 移除已被替代的记忆
    this.entries = this.entries.filter(e => !e.supersededBy)

    // 3. 合并同设备的连续观察
    const deviceGroups = new Map<string, MemoryEntry[]>()
    for (const entry of this.entries) {
      if (entry.source === 'device' && entry.deviceId) {
        const group = deviceGroups.get(entry.deviceId) ?? []
        group.push(entry)
        deviceGroups.set(entry.deviceId, group)
      }
    }

    // 4. 低置信度记忆降级
    this.entries = this.entries.filter(e => e.confidence > 0.2)

    // 5. 限制总条目数（保留最新 200 条）
    if (this.entries.length > 200) {
      this.entries = this.entries
        .sort((a, b) => b.timestamp - a.timestamp)
        .slice(0, 200)
    }

    this.lastDream = Date.now()
    this.version++
    await this.save()
  }

  // ============================================================
  // MEMORY.md 格式转换
  // ============================================================

  private parseMemoryMd(raw: string): MemoryIndex {
    const entries: MemoryEntry[] = []
    const lines = raw.split('\n')
    let lastDream = 0
    let version = 1

    // Parse header
    for (const line of lines) {
      if (line.startsWith('<!-- lastDream:')) {
        lastDream = parseInt(line.match(/lastDream:\s*(\d+)/)?.[1] ?? '0')
      }
      if (line.startsWith('<!-- version:')) {
        version = parseInt(line.match(/version:\s*(\d+)/)?.[1] ?? '1')
      }
    }

    // Parse entries: each entry is a list item
    // Format: - [source] content (tags: tag1, tag2) {id} @timestamp
    const entryPattern = /^- \[(\w+)\] (.+?)(?:\s+\(tags: (.+?)\))?\s+\{(\w+)\}\s+@(\d+)/
    for (const line of lines) {
      const match = line.match(entryPattern)
      if (match) {
        entries.push({
          id: match[4],
          timestamp: parseInt(match[5]),
          source: match[1] as 'device' | 'personal' | 'conversation',
          content: match[2],
          tags: match[3]?.split(',').map(t => t.trim()),
          confidence: 0.8,
        })
      }
    }

    return { entries, lastDream, version }
  }

  private toMemoryMd(): string {
    const lines: string[] = [
      '# MEMORY.md — Ottie Agent Memory',
      '',
      `<!-- lastDream: ${this.lastDream} -->`,
      `<!-- version: ${this.version} -->`,
      '',
    ]

    // Group by source
    const groups = new Map<string, MemoryEntry[]>()
    for (const entry of this.entries) {
      const group = groups.get(entry.source) ?? []
      group.push(entry)
      groups.set(entry.source, group)
    }

    for (const [source, entries] of groups) {
      lines.push(`## ${source}`)
      lines.push('')
      for (const e of entries.sort((a, b) => b.timestamp - a.timestamp)) {
        const tags = e.tags?.length ? ` (tags: ${e.tags.join(', ')})` : ''
        lines.push(`- [${e.source}] ${e.content}${tags} {${e.id}} @${e.timestamp}`)
      }
      lines.push('')
    }

    return lines.join('\n')
  }

  getEntries(): MemoryEntry[] {
    return [...this.entries]
  }
}
