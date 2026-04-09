# Ottie Agent

[English](./README.md)

Ottie Agent 是 Ottie 背后的默认智能层。

如果说 `ottie` 是通信界面，那么这个仓库就是默认 AI 秘书行为真正发生的地方：改写、审批、意图识别、建议回复、记忆，以及面向未来的屏幕感知设备智能基础。

Ottie 本身是在为“通信越来越由 Agent 参与塑造”的未来而构建，而这个仓库就是这个想法的参考实现。

## 这个仓库包含什么

这个仓库存放默认 Agent 实现及其支撑模块：

- `packages/adapter`：默认 `OttieAgentAdapter` 实现
- `packages/skills`：rewrite、approve、persona、delegate、duty、dispatch、OTA、检测类 skills
- `packages/llm`：统一的 LLM 调用层
- `packages/screen`：基于 Screenpipe 的屏幕感知基础模块
- `packages/memory`：`MEMORY.md` 存储与记忆整理逻辑

## 为什么这个仓库存在

Ottie 不是在做“给聊天软件加一点 AI 功能”。

它是在构建一种不同的通信模型：

- 用户先表达意图，再形成措辞
- Agent 协助生成对外消息
- 收到的消息可以在用户回应前先被理解和结构化
- 上下文、记忆和设备状态最终都可能进入通信闭环

这个仓库就是这套默认智能层的实现载体。

## 当前阶段

这个仓库已经具备作为 Ottie 默认 Agent 基础的可用实现。

今天已经实现的部分包括：

- 发送侧改写流程
- 审批请求生成
- 接收侧意图识别
- 建议回复生成
- 基础 skills 系统
- 以 package 形式存在的 memory / screen 模块

仍在继续推进的部分包括：

- 与主应用更深层的端到端集成
- 更完整的设备感知工作流产品化
- 更广泛的协议与生态接入

详细进度见 [STATUS.md](./STATUS.md)。

## 它如何融入 Ottie

Ottie 当前把这个仓库作为默认 Agent 实现来使用。

推荐的本地工作区结构如下：

```bash
workspace/
├── ottie/
├── ottie-agent/
└── server/
```

这个仓库目前是按照多仓工作区方式开发的。  
它默认本地存在相邻的 `ottie` 仓库，因为共享 contracts 当前仍在主仓中。

同样地，`ottie` 里的桌面端在开发时也会直接引用这个仓库中的本地 adapter 包。

## 本地开发

先把仓库并排 clone 下来，再安装依赖：

```bash
git clone https://github.com/ottie-im/ottie
git clone https://github.com/ottie-im/ottie-agent
```

安装依赖：

```bash
cd ottie-agent
npm install
```

运行测试：

```bash
npm test
```

## 关于安装方式

这个仓库当前主要通过本地工作区方式被主应用消费。

如果未来正式进入发布 npm 包的工作流，再更新对外安装说明即可。在此之前，建议把它视为源码仓库，而不是一个已经完成对外分发的 install-from-npm 产品。

## 替换默认 Agent

Ottie 从设计上就允许替换默认 Agent。

如果你想使用 LangGraph、Google ADK、OpenClaw 风格 runtime，或者你自己的框架，可以把这个仓库作为参考，重点看：

- adapter 边界
- rewrite / approval 工作流
- inbound intent 处理方式
- 建议回复模式
- memory 与 device-awareness 的基础形态

## 相关仓库

- `ottie`：主产品仓库
- `server`：部署与 Matrix 后端仓库

## License

MIT
