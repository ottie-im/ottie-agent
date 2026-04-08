# Ottie Agent — 项目状态

> 最后更新：2026-04-08

## 当前进度

| 模块 | 状态 |
|------|------|
| packages/adapter/ — OpenClawAdapter | ✅ 完成 |
| packages/adapter/ — MockAdapter | ✅ 完成 |
| packages/skills/ — skill-rewrite | ✅ 完成（规则引擎，后续接 LLM） |
| packages/skills/ — skill-approve | ✅ 完成 |
| packages/memory/ — OttieMemory | ✅ 完成（MEMORY.md 读写 + autoDream） |
| packages/screen/ — Screenpipe 封装 | ⬜ Phase 4 |
| 其余 7 个 Skills | ⬜ Phase 3-5 |

## 已通过的测试

- 18/18 测试通过
- OpenClawAdapter 和 MockAdapter 都实现了 OttieAgentAdapter 接口
- 改写 → 审批 → 发送/拒绝 全流程验证通过
- 适配器可替换性验证通过（MockAdapter 零修改替换 OpenClawAdapter）

## 核心链路

```
用户输入 "帮我问他周五去不去吃饭"
  → OpenClawAdapter.onMessage()
  → skill-rewrite: "周五去不去吃饭？"
  → skill-approve: 创建 ApprovalRequest
  → onDraft callback → IM 层显示审批卡片
  → 用户批准 → onApproval() → 返回 OttieMessage
  → IM 层调 OttieMatrix.sendMessage() 发出
```

## 下一步

### Phase 3（跟主仓库同步）
- [ ] 被主仓库 apps/desktop 或 apps/mobile 作为依赖引入
- [ ] 跑通完整端到端：UI → Agent → Matrix → 对方收到

### Phase 4 — 设备感知
- [ ] packages/screen/：接入 Screenpipe
- [ ] skill-gui-detect + skill-cli-watch
- [ ] 记忆上报给个人 Agent

### Phase 5 — 补充 Skills
- [ ] skill-persona（对外人格）
- [ ] skill-delegate（信任委托）
- [ ] skill-dispatch（设备调度）
- [ ] skill-duty（值班）
- [ ] skill-ota（OTA 更新）

## 如何继续开发

```bash
cd ~/Developer/ottie/ottie-agent
claude
> 读 STATUS.md 和 CLAUDE.md，继续开发
```

## 依赖说明

contracts 类型来自主仓库，通过本地路径引用：
```
"@ottie-im/contracts": "file:../../../ottie/packages/contracts"
```
