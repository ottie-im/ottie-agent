# CLAUDE.md — Ottie Agent (OpenClaw)

这是 Ottie 的默认 Agent 实现，基于 OpenClaw。
它实现了 OttieAgentAdapter 接口（定义在 @ottie-im/contracts 里）。

Ottie IM 层永远不直接调 OpenClaw API，只跟 OttieAgentAdapter 接口对话。
这个仓库的工作就是"翻译"：Ottie 接口语言 ↔ OpenClaw 能理解的。

模块：
- packages/adapter/   ← OttieAgentAdapter 的 OpenClaw 实现
- packages/skills/    ← 9 个 OpenClaw Skill
- packages/screen/    ← Screenpipe 屏幕感知封装
- packages/memory/    ← MEMORY.md 记忆管理

依赖：@ottie-im/contracts（npm install）

验证标准：把这个适配器换成 mock，Ottie IM 代码零修改仍能跑。
