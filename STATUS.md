# Ottie Agent — 项目状态

> 最后更新：2026-04-08 21:10

## 当前进度

| 模块 | 状态 | 说明 |
|------|------|------|
| packages/llm/ — LLM 抽象层 | ✅ 完成 | 多模型支持：OpenAI/Claude/Ollama/中转 |
| packages/adapter/ — OpenClawAdapter | ✅ 完成 | 实现 OttieAgentAdapter 接口 |
| packages/adapter/ — MockAdapter | ✅ 完成 | 可替换性验证用 |
| packages/skills/ — skill-rewrite | ✅ 完成 | 规则引擎（已验证）+ LLM 改写（已验证） |
| packages/skills/ — skill-approve | ✅ 完成 | 审批管理 |
| packages/memory/ — OttieMemory | ✅ 完成 | MEMORY.md 读写 + autoDream |
| packages/screen/ — Screenpipe | ⬜ Phase 4 | 空壳 |
| 其余 7 个 Skills | ⬜ Phase 4-5 | persona/delegate/dispatch/duty/ota/gui-detect/cli-watch |

## 已验证通过

| 功能 | 验证方式 | 结果 |
|------|---------|------|
| OpenClawAdapter 接口 | vitest 8 项 | ✅ |
| MockAdapter 接口 | vitest 8 项 | ✅ |
| 适配器可替换性 | Mock 替换 OpenClaw 零修改 | ✅ |
| 规则改写 | "帮我问他" → 去前缀 | ✅ |
| LLM 改写 | "延期两周语气委婉" → Claude 商务措辞 | ✅ |
| 审批流程 | 批准/编辑/拒绝 | ✅ |
| 接收方意图识别 | 规则引擎 + LLM | ✅（代码层面） |

## LLM 抽象层（packages/llm/）

统一使用 OpenAI SDK 的 `baseURL + apiKey` 模式，支持：
- **AIHubMix 中转**：`baseUrl: 'https://aihubmix.com/v1'` — 可用 Claude/GPT 等
- **OpenAI 直连**：`baseUrl: 'https://api.openai.com/v1'`
- **Ollama 本地**：`baseUrl: 'http://localhost:11434/v1'`, `apiKey: 'ollama'`
- **自定义**：任何 OpenAI 兼容端点

三个核心能力：
1. `rewrite(intent)` — 发送方改写
2. `detectIntent(message)` — 接收方意图识别
3. `composeReply(message, choice)` — 接收方回复生成

不配置 LLM = 自动降级到规则引擎（免费，离线可用）。

## 测试

- 18/18 通过（2026-04-08 验证）
- 测试文件：packages/adapter/src/__tests__/adapter.test.ts

## 下一步

### 近期
- [ ] 验证接收方决策卡片在桌面端 UI 的真实触发
- [ ] 验证 LLM detectIntent 的实际效果

### Phase 4 — 设备感知
- [ ] packages/screen/：接入 Screenpipe SDK
- [ ] skill-gui-detect：GUI 弹窗识别
- [ ] skill-cli-watch：CLI 变动监听
- [ ] skill-dispatch：设备调度
- [ ] 记忆上报

### Phase 5 — 补充 Skills + 改写升级
- [ ] skill-persona：对外人格控制
- [ ] skill-delegate：信任委托
- [ ] skill-duty：值班模式
- [ ] skill-ota：OTA 更新
- [ ] Ollama + Gemma 本地改写

## 如何继续开发

```bash
cd ~/Developer/ottie/ottie-agent
claude
> 读 STATUS.md 和 CLAUDE.md，继续开发
```

## 依赖

- contracts：`file:../../../ottie/packages/contracts`（本地路径）
- openai：^4.80.0（LLM 包）
- 无其他外部运行时依赖

## 代码统计

- 源文件：14 个 .ts
- 代码量：~1,200 行
- 测试：18/18 通过
