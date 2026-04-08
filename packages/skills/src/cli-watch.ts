/**
 * skill-cli-watch — CLI 变动监听
 *
 * 监听 OttieScreen 事件中的 CLI 提示（Y/n、Allow?、Password 等）。
 * 产出需要用户决策的通知事件。
 */

import type { OttieScreenEvent } from '@ottie-im/contracts'

export interface CLIWatchResult {
  detected: boolean
  category: 'yes-no' | 'allow-deny' | 'password' | 'overwrite' | 'unknown'
  summary: string
  suggestedAction?: string
  actionRequired: boolean
  originalEvent: OttieScreenEvent
}

/**
 * 分析 CLI 提示事件，归类并给出建议
 */
export function analyzeCLIPrompt(event: OttieScreenEvent): CLIWatchResult {
  if (event.type !== 'cli-prompt') {
    return { detected: false, category: 'unknown', summary: '', actionRequired: false, originalEvent: event }
  }

  const text = event.content

  // Y/n 提示
  if (/\[Y\/n\]|\[y\/N\]|\(yes\/no\)|Continue\?|Proceed\?|是否继续/i.test(text)) {
    return {
      detected: true,
      category: 'yes-no',
      summary: `${event.sourceApp ?? '终端'} 询问是否继续`,
      suggestedAction: 'Y',
      actionRequired: true,
      originalEvent: event,
    }
  }

  // Allow/Deny
  if (/Allow\?|Grant access|Allow exec|permit/i.test(text)) {
    return {
      detected: true,
      category: 'allow-deny',
      summary: `${event.sourceApp ?? '终端'} 请求执行权限`,
      suggestedAction: 'Allow',
      actionRequired: true,
      originalEvent: event,
    }
  }

  // Password
  if (/Password:|密码:|Enter passphrase|sudo.*password/i.test(text)) {
    return {
      detected: true,
      category: 'password',
      summary: `${event.sourceApp ?? '终端'} 请求密码`,
      actionRequired: true,
      originalEvent: event,
    }
  }

  // Overwrite
  if (/Overwrite\?|already exists.*overwrite|Replace\?|是否覆盖/i.test(text)) {
    return {
      detected: true,
      category: 'overwrite',
      summary: `${event.sourceApp ?? '终端'} 询问是否覆盖`,
      suggestedAction: 'N',
      actionRequired: true,
      originalEvent: event,
    }
  }

  return {
    detected: true,
    category: 'unknown',
    summary: `${event.sourceApp ?? '终端'} 有 CLI 提示`,
    actionRequired: event.actionRequired,
    originalEvent: event,
  }
}
