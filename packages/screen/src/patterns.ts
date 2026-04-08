/**
 * GUI/CLI 检测 pattern 定义
 *
 * 用于匹配 Screenpipe 返回的屏幕内容，判断是否是需要用户操作的弹窗或提示。
 */

import type { OttieScreenEvent } from '@ottie-im/contracts'

export interface DetectionPattern {
  name: string
  type: OttieScreenEvent['type']
  // 文本匹配（任一匹配即命中）
  textPatterns: RegExp[]
  // 可选：限定 app 名称
  appFilter?: RegExp
  // 匹配到后生成的事件
  actionRequired: boolean
  confidence: number
}

// ---- GUI 弹窗检测 ----

export const GUI_PATTERNS: DetectionPattern[] = [
  {
    name: 'permission-dialog',
    type: 'gui-popup',
    textPatterns: [
      /would like to access/i,
      /wants to access/i,
      /请求访问/,
      /请求权限/,
      /Allow.*to access/i,
      /是否允许/,
    ],
    actionRequired: true,
    confidence: 0.9,
  },
  {
    name: 'confirm-dialog',
    type: 'gui-popup',
    textPatterns: [
      /Are you sure/i,
      /确定要/,
      /是否确认/,
      /Do you want to/i,
      /Would you like to/i,
    ],
    actionRequired: true,
    confidence: 0.85,
  },
  {
    name: 'error-dialog',
    type: 'gui-popup',
    textPatterns: [
      /An error occurred/i,
      /出错了/,
      /发生错误/,
      /Unexpected error/i,
      /Something went wrong/i,
      /操作失败/,
    ],
    actionRequired: false,
    confidence: 0.8,
  },
  {
    name: 'update-dialog',
    type: 'gui-popup',
    textPatterns: [
      /Update available/i,
      /新版本可用/,
      /A new version/i,
      /有更新/,
      /Restart to update/i,
    ],
    actionRequired: false,
    confidence: 0.75,
  },
]

// ---- CLI 提示检测 ----

export const CLI_PATTERNS: DetectionPattern[] = [
  {
    name: 'yes-no-prompt',
    type: 'cli-prompt',
    textPatterns: [
      /\[Y\/n\]/,
      /\[y\/N\]/,
      /\(yes\/no\)/i,
      /\(Y\/N\)/,
      /Continue\?/i,
      /Proceed\?/i,
      /是否继续/,
    ],
    appFilter: /terminal|iterm|warp|alacritty|kitty|hyper|cmd|powershell/i,
    actionRequired: true,
    confidence: 0.9,
  },
  {
    name: 'allow-deny-prompt',
    type: 'cli-prompt',
    textPatterns: [
      /Allow\?/i,
      /Deny\?/i,
      /Grant access/i,
      /Allow exec/i,
      /permit/i,
    ],
    appFilter: /terminal|iterm|warp|claude/i,
    actionRequired: true,
    confidence: 0.9,
  },
  {
    name: 'password-prompt',
    type: 'cli-prompt',
    textPatterns: [
      /Password:/i,
      /密码:/,
      /Enter passphrase/i,
      /sudo.*password/i,
    ],
    appFilter: /terminal|iterm|warp/i,
    actionRequired: true,
    confidence: 0.85,
  },
  {
    name: 'overwrite-prompt',
    type: 'cli-prompt',
    textPatterns: [
      /Overwrite\?/i,
      /already exists.*overwrite/i,
      /Replace\?/i,
      /是否覆盖/,
    ],
    actionRequired: true,
    confidence: 0.85,
  },
]

export const ALL_PATTERNS = [...GUI_PATTERNS, ...CLI_PATTERNS]

/**
 * 匹配文本内容，返回第一个命中的 pattern
 */
export function matchPattern(text: string, appName?: string): DetectionPattern | null {
  for (const pattern of ALL_PATTERNS) {
    // App filter check
    if (pattern.appFilter && appName && !pattern.appFilter.test(appName)) {
      continue
    }
    // Text pattern check
    for (const regex of pattern.textPatterns) {
      if (regex.test(text)) {
        return pattern
      }
    }
  }
  return null
}
