# Ottie Agent — 项目状态

> 最后更新：2026-04-08

## 当前进度

| 模块 | 状态 | 说明 |
|------|------|------|
| packages/adapter/ — OpenClawAdapter | ✅ 完成 | 实现 OttieAgentAdapter 接口 |
| packages/adapter/ — MockAdapter | ✅ 完成 | 可替换性验证用 |
| packages/skills/ — skill-rewrite | ✅ 完成 | 规则引擎：去前缀 + 口语润色 + 标点 |
| packages/skills/ — skill-approve | ✅ 完成 | 审批管理：创建/批准/编辑/拒绝/超时 |
| packages/skills/ — SKILL.md 定义 | ✅ 完成 | skill-rewrite + skill-approve 规范文档 |
| packages/memory/ — OttieMemory | ✅ 完成 | MEMORY.md 读写 + autoDream 整理 |
| packages/screen/ — Screenpipe 封装 | ⬜ Phase 4 | 空壳 |
| packages/skills/ — 其余 7 个 Skills | ⬜ Phase 4-5 | persona/delegate/dispatch/duty/ota/gui-detect/cli-watch |

## 测试结果

- 18/18 测试通过（2026-04-08 验证）
- OpenClawAdapter 和 MockAdapter 都实现 OttieAgentAdapter 接口
- 适配器可替换性验证通过

## 核心链路（已跑通）

```
用户输入 "帮我问他周五去不去吃饭"
  → OpenClawAdapter.onMessage()
  → skill-rewrite: 去掉"帮我问他"前缀 → "周五去不去吃饭？"
  → skill-approve: 创建 ApprovalRequest
  → onDraft callback → 桌面端 UI 显示审批卡片
  → 用户批准 → onApproval() → 返回 OttieMessage
  → 桌面端调 OttieMatrix.sendMessage() → 真实发送到 Tuwunel ✅
```

## 当前改写能力

规则引擎（非 LLM），支持：
- 中文指令前缀去除：帮我/替我/跟他/跟她/告诉他/问他/和他说/跟他说
- 英文指令前缀去除：tell him/ask her/let him know
- 口语化润色：那个→删、搞定了→完成了 等
- 自动标点：疑问句加？，陈述句加。
- 英文首字母大写

后续接入 LLM（Claude/Gemma）做更自然的改写。

## 下一步

### Phase 4 — 设备感知
- [ ] packages/screen/：接入 Screenpipe SDK
- [ ] skill-gui-detect：识别权限框、确认框、错误框
- [ ] skill-cli-watch：监听 CLI stdout（Y/n、Allow? 等）
- [ ] skill-dispatch：设备调度（向设备 Agent 下发指令）
- [ ] 记忆上报：设备观察 → sessions_send → 个人 Agent

### Phase 5 — 补充 Skills
- [ ] skill-persona：对外人格控制
- [ ] skill-delegate：信任委托（规则引擎，逐步放权）
- [ ] skill-duty：值班模式（离线时自动回复）
- [ ] skill-ota：OTA 更新检测

### 改写升级
- [ ] 接入 Claude API 做 LLM 改写
- [ ] 接入 Ollama + Gemma 4 做本地免费改写

## 如何继续开发

```bash
cd ~/Developer/ottie/ottie-agent
claude
> 读 STATUS.md 和 CLAUDE.md，继续开发
```

## 依赖

- contracts 类型来自主仓库：`"@ottie-im/contracts": "file:../../../ottie/packages/contracts"`
- 无外部 npm 运行时依赖（纯 TypeScript）
- 测试框架：vitest

## 代码统计

- 源文件：10 个 .ts 文件
- 代码量：~500 行
- 测试：18/18 通过
