/**
 * skill-dispatch — 设备调度
 *
 * 个人 Agent 向设备 Agent 下发指令。
 * 例如：用户在手机上说"把电脑上的方案发给他"→ dispatch 到电脑的设备 Agent。
 *
 * 在真正的 OpenClaw 环境中，通过 sessions_send 实现。
 * 当前实现提供调度逻辑框架，实际通信由 adapter 层处理。
 */

import type { OttieDevice, DeviceCommand } from '@ottie-im/contracts'

export interface DispatchResult {
  success: boolean
  targetDevice: OttieDevice | null
  command: DeviceCommand | null
  reason?: string
}

/**
 * 根据用户意图选择最合适的目标设备
 */
export function selectDevice(
  intent: string,
  devices: OttieDevice[]
): OttieDevice | null {
  const onlineDevices = devices.filter(d => d.status === 'online')
  if (onlineDevices.length === 0) return null

  const lower = intent.toLowerCase()

  // 明确指定设备名
  for (const device of onlineDevices) {
    if (lower.includes(device.name.toLowerCase())) return device
  }

  // 根据能力匹配
  if (/文件|文档|方案|代码|打开/.test(lower)) {
    return onlineDevices.find(d => d.capabilities.includes('read') || d.capabilities.includes('exec')) ?? onlineDevices[0]
  }

  if (/屏幕|截图|看一下/.test(lower)) {
    return onlineDevices.find(d => d.capabilities.includes('screen')) ?? onlineDevices[0]
  }

  if (/浏览器|网页|搜索/.test(lower)) {
    return onlineDevices.find(d => d.capabilities.includes('browser')) ?? onlineDevices[0]
  }

  // 默认选第一个桌面设备
  return onlineDevices.find(d => d.type === 'desktop') ?? onlineDevices[0]
}

/**
 * 解析用户意图生成设备指令
 */
export function parseCommand(intent: string, targetDevice: OttieDevice): DeviceCommand {
  const lower = intent.toLowerCase()

  let command = 'exec'
  if (/读|打开|找|查看|文件/.test(lower)) command = 'read'
  if (/写|保存|创建/.test(lower)) command = 'write'
  if (/浏览器|网页/.test(lower)) command = 'browser'
  if (/截图|屏幕/.test(lower)) command = 'screen'

  return {
    targetDeviceId: targetDevice.id,
    command,
    args: { intent },
    requireApproval: true,
  }
}

/**
 * 完整调度流程：选设备 → 解析指令 → 返回结果
 */
export function dispatch(intent: string, devices: OttieDevice[]): DispatchResult {
  const target = selectDevice(intent, devices)
  if (!target) {
    return { success: false, targetDevice: null, command: null, reason: '没有在线的设备' }
  }

  const command = parseCommand(intent, target)
  return { success: true, targetDevice: target, command }
}
