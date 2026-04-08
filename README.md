# Ottie Agent — OpenClaw

Ottie 的默认 AI 秘书实现，基于 OpenClaw。

Ottie 的 Agent 是可替换的。如果你想用 LangGraph、Google ADK 或自己的框架，
只需要实现 `OttieAgentAdapter` 接口（来自 `@ottie-im/contracts`），
参考这个仓库的实现方式。

## 安装

```bash
npm install @ottie-im/ottie-agent
```

## 给 OpenClaw 用户

这个仓库里的 Skills 也可以单独安装到你的 OpenClaw 里，不需要 Ottie：

```bash
# 把 skill-rewrite 复制到你的 OpenClaw skills 目录
cp -r packages/skills/skill-rewrite ~/.openclaw/skills/
```
