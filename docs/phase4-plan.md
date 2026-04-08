# Phase 4：设备感知 — 实施计划

> 在 ottie-agent 仓库工作，完成后回到 ottie 主仓库做桌面端集成。

## 目标

让 Ottie 桌面端能感知用户屏幕上发生的事情：
- 检测 GUI 弹窗（权限请求、确认框、错误提示）→ 推送到手机
- 监听 CLI 变动（Y/n、Allow?、密码提示）→ 推送到手机
- 记录用户确认性操作 → 构建长期记忆

## 依赖的开源项目

### Screenpipe（屏幕感知引擎）
- GitHub: https://github.com/mediar-ai/screenpipe
- 许可证: MIT
- 本地运行，REST API 在 localhost:3030
- 提供：OCR 文本识别、Accessibility Tree、音频转写、UI 元素搜索
- 安装：`npx screenpipe@latest record` 或下载桌面端

### OpenClaw（Agent 框架，参考但不强依赖）
- GitHub: https://github.com/openclaw/openclaw
- 许可证: MIT
- Ottie 的 Agent 架构参考了 OpenClaw 的设计（SOUL.md、skills、sessions_send）
- 但 Ottie 使用自建的 OttieAgentAdapter 接口，不直接依赖 OpenClaw
- Phase 4 中参考 OpenClaw 的 Skill 格式和多 Agent 通信模式

## 关键 API（Screenpipe）

| 端点 | 用途 | 参数 |
|------|------|------|
| `GET /health` | 检查 Screenpipe 是否运行 | — |
| `GET /search` | 全文搜索屏幕内容 | q, content_type(ocr/accessibility), app_name, limit, start_time, end_time |
| `GET /elements` | 搜索 UI 元素（按钮、输入框） | q, role, app_name, source(accessibility/ocr) |
| `GET /activity-summary` | 活动概览 | start_time, end_time, app_name |

## 实施步骤

### Step 4.1 — packages/screen/（屏幕感知封装）

**职责**：封装 Screenpipe REST API，提供 Ottie 专用接口。

```typescript
class OttieScreen {
  constructor(config: { baseUrl?: string }) // 默认 http://localhost:3030
  
  // 健康检查
  isAvailable(): Promise<boolean>
  
  // 启动/停止轮询
  start(config: ScreenConfig): void
  stop(): void
  
  // 事件回调（轮询 Screenpipe API 后触发）
  onEvent(callback: (event: OttieScreenEvent) => void): Unsubscribe
  
  // 手动查询
  query(timeRange: { start: number; end: number }): Promise<OttieScreenEvent[]>
  searchElements(query: string, role?: string): Promise<UIElement[]>
}
```

**实现方式**：
1. 轮询 `/search?content_type=accessibility` 每 2 秒
2. 与上次结果比对，检测新出现的内容
3. 匹配预定义的 pattern（权限框、确认框、CLI 提示）
4. 触发 OttieScreenEvent

**文件**：
- `packages/screen/src/OttieScreen.ts` — 主类
- `packages/screen/src/patterns.ts` — GUI/CLI 检测 pattern
- `packages/screen/src/index.ts` — 导出

### Step 4.2 — packages/skills/ — GUI/CLI 检测 Skills

**skill-gui-detect**：
- 监听 OttieScreen 事件
- 识别：权限框（"Allow"/"Deny"）、确认框（"OK"/"Cancel"）、错误框
- 产出：OttieScreenEvent { type: 'gui-popup', actionRequired: true }
- 推送给个人 Agent → 转发到手机

**skill-cli-watch**：
- 监听 OttieScreen 的 OCR/accessibility 事件
- 识别：`[Y/n]`、`Allow?`、`Password:`、`Continue? (y/N)` 等模式
- 产出：OttieScreenEvent { type: 'cli-prompt', actionRequired: true }
- 推送给个人 Agent → 转发到手机

**文件**：
- `packages/skills/src/gui-detect.ts`
- `packages/skills/src/cli-watch.ts`

### Step 4.3 — 记忆上报

- OttieScreen 事件 → OttieMemory.observe(event, deviceId)
- 已有 OttieMemory.observe() 方法
- 定期通过 Agent 的 onNotification 回调上报给 IM 层
- IM 层转发到手机（通过 Matrix 消息）

### Step 4.4 — 桌面端集成（回到 ottie 主仓库）

- OpenClawAdapter 初始化时启动 OttieScreen
- onNotification 回调连接到 OttieScreen.onEvent
- 桌面端 MainLayout 显示通知卡片
- Tauri 安装包预装 Screenpipe（或提示用户安装）

## 验收点

- [ ] Screenpipe 在本地运行，OttieScreen 能连接
- [ ] 打开一个权限弹窗 → skill-gui-detect 检测到 → 通知卡片显示
- [ ] 终端里出现 Y/n 提示 → skill-cli-watch 检测到 → 通知卡片显示
- [ ] 检测到的事件写入 MEMORY.md
- [ ] 端到端：屏幕变化 → Agent 检测 → 推送 → IM 显示

## 文件清单

| 操作 | 仓库 | 文件 |
|------|------|------|
| 新建 | ottie-agent | packages/screen/src/OttieScreen.ts |
| 新建 | ottie-agent | packages/screen/src/patterns.ts |
| 新建 | ottie-agent | packages/screen/src/index.ts |
| 新建 | ottie-agent | packages/skills/src/gui-detect.ts |
| 新建 | ottie-agent | packages/skills/src/cli-watch.ts |
| 修改 | ottie-agent | packages/adapter/src/OpenClawAdapter.ts（接入 screen） |
| 修改 | ottie | apps/desktop/src/MainLayout.tsx（显示通知卡片） |
| 修改 | ottie-agent | references/screenpipe/README.md（更新 API 文档） |

## 注意事项

1. **不复制 Screenpipe 源码** — 通过 HTTP API 调用
2. **Screenpipe 是可选的** — 没有运行时 graceful 降级，不阻塞 IM 功能
3. **隐私优先** — 所有数据本地存储，不上传云端
4. **行为过滤** — 只记录 Enter/点击 触发的确认性动作，不记录浏览行为
