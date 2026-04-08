/**
 * skill-gui-detect — GUI 弹窗检测
 *
 * 监听 OttieScreen 事件，识别权限框、确认框、错误框。
 * 产出需要用户操作的通知事件。
 */

import type { OttieScreenEvent } from '@ottie-im/contracts'

export interface GUIDetectResult {
  detected: boolean
  category: 'permission' | 'confirm' | 'error' | 'update' | 'unknown'
  summary: string
  actionRequired: boolean
  originalEvent: OttieScreenEvent
}

/**
 * 分析 GUI 弹窗事件，归类并生成摘要
 */
export function analyzeGUIPopup(event: OttieScreenEvent): GUIDetectResult {
  if (event.type !== 'gui-popup') {
    return { detected: false, category: 'unknown', summary: '', actionRequired: false, originalEvent: event }
  }

  const text = event.content.toLowerCase()

  // 权限请求
  if (/allow|deny|access|权限|允许/.test(text)) {
    return {
      detected: true,
      category: 'permission',
      summary: `${event.sourceApp ?? '应用'} 请求权限`,
      actionRequired: true,
      originalEvent: event,
    }
  }

  // 确认框
  if (/are you sure|confirm|确定|确认|do you want/.test(text)) {
    return {
      detected: true,
      category: 'confirm',
      summary: `${event.sourceApp ?? '应用'} 需要确认操作`,
      actionRequired: true,
      originalEvent: event,
    }
  }

  // 错误框
  if (/error|错误|失败|wrong|unexpected/.test(text)) {
    return {
      detected: true,
      category: 'error',
      summary: `${event.sourceApp ?? '应用'} 报告错误`,
      actionRequired: false,
      originalEvent: event,
    }
  }

  // 更新提示
  if (/update|更新|new version|新版本/.test(text)) {
    return {
      detected: true,
      category: 'update',
      summary: `${event.sourceApp ?? '应用'} 有更新可用`,
      actionRequired: false,
      originalEvent: event,
    }
  }

  return {
    detected: true,
    category: 'unknown',
    summary: `${event.sourceApp ?? '应用'} 弹出了窗口`,
    actionRequired: event.actionRequired,
    originalEvent: event,
  }
}
