# Ottie Agent

[简体中文](./README.zh-CN.md)

Ottie Agent is the default intelligence layer behind Ottie.

If `ottie` is the communication interface, this repository is where the default AI secretary behavior lives: rewrite, approval, intent detection, response suggestions, memory, and the foundations of screen-aware device intelligence.

Ottie is designed for a future where communication is increasingly shaped by agents. This repository is the reference implementation of that idea.

## What This Repository Contains

This repository holds the default agent-side implementation and supporting modules:

- `packages/adapter`: the default `OttieAgentAdapter` implementation
- `packages/skills`: rewrite, approval, persona, delegate, duty, dispatch, OTA, and detection skills
- `packages/llm`: unified LLM calling layer
- `packages/screen`: Screenpipe-based screen-awareness foundation
- `packages/memory`: `MEMORY.md` storage and memory consolidation logic

## Why This Exists

Ottie is not built around "AI features added to chat."

It is built around a different communication model:

- users express intent before wording
- agents help produce the outbound message
- inbound messages can be understood and structured before the user responds
- context, memory, and device state can eventually become part of the communication loop

This repository provides the default intelligence layer for that model.

## Current Stage

This repository is already functional as the default Ottie agent foundation.

Implemented today:

- sending-side rewrite flow
- approval request generation
- receiving-side intent detection
- suggested reply generation
- foundational skills system
- memory and screen-awareness modules at the package level

Still evolving:

- deeper end-to-end product integration in the main app
- more polished device-awareness workflows
- broader protocol and ecosystem integrations

For detailed progress, see [STATUS.md](./STATUS.md).

## How It Fits Into Ottie

Ottie currently uses this repository as its default agent implementation.

Recommended local workspace:

```bash
workspace/
├── ottie/
├── ottie-agent/
└── server/
```

Today, this repository is developed as part of a multi-repo workspace.  
It expects the sibling `ottie` repository to exist locally, because shared contracts currently live there.

Likewise, the desktop app in `ottie` references the local adapter package from this repository during development.

## Local Development

Clone the repositories side by side first, then install dependencies:

```bash
git clone https://github.com/ottie-im/ottie
git clone https://github.com/ottie-im/ottie-agent
```

Install dependencies:

```bash
cd ottie-agent
npm install
```

Run tests:

```bash
npm test
```

## About Installation

This repository is currently consumed primarily through local workspace development.

If published packages become part of the official workflow later, the installation instructions should be updated at that time. Until then, treat this repository as a source repository, not as a finished install-from-npm product.

## Replacing The Default Agent

Ottie is designed so that the default agent can be replaced.

If you want to use LangGraph, Google ADK, an OpenClaw-style runtime, or your own framework, use this repository as a reference for:

- the adapter boundary
- the rewrite / approval workflow
- inbound intent handling
- response suggestion patterns
- memory and device-awareness foundations

## Related Repositories

- `ottie`: main product repository
- `server`: deployment and Matrix backend repository

## License

MIT
