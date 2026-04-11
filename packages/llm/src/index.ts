/**
 * @ottie-im/llm — 统一 LLM 调用层
 *
 * 支持：
 * 1. OpenAI / GPT 系列
 * 2. Anthropic Claude（通过 OpenAI 兼容 API 或中转）
 * 3. 本地模型（Ollama）
 * 4. 中转服务（AIHubMix 等，兼容 OpenAI 格式）
 *
 * 所有提供商统一使用 OpenAI SDK 的 base_url + api_key 模式。
 */

import OpenAI from 'openai'

// ---- 配置 ----

export interface LLMProvider {
  name: string
  baseUrl: string
  apiKey: string
  model: string
}

// 预设提供商
export const PROVIDERS = {
  // Anthropic Claude（通过中转）
  aihubmix: (apiKey: string, model = 'claude-sonnet-4-20250514'): LLMProvider => ({
    name: 'AIHubMix',
    baseUrl: 'https://aihubmix.com/v1',
    apiKey,
    model,
  }),

  // OpenAI 直连
  openai: (apiKey: string, model = 'gpt-4o-mini'): LLMProvider => ({
    name: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    apiKey,
    model,
  }),

  // Anthropic 直连（需要用 Anthropic 兼容的中转或 SDK）
  anthropic: (apiKey: string, model = 'claude-sonnet-4-20250514'): LLMProvider => ({
    name: 'Anthropic',
    baseUrl: 'https://api.anthropic.com/v1',
    apiKey,
    model,
  }),

  // Ollama 本地
  ollama: (model = 'gemma2:9b'): LLMProvider => ({
    name: 'Ollama',
    baseUrl: 'http://localhost:11434/v1',
    apiKey: 'ollama',
    model,
  }),

  // 自定义中转
  custom: (baseUrl: string, apiKey: string, model: string): LLMProvider => ({
    name: 'Custom',
    baseUrl,
    apiKey,
    model,
  }),
}

// ---- LLM 客户端 ----

export class OttieLLM {
  private client: OpenAI
  private model: string
  private providerName: string

  constructor(provider: LLMProvider) {
    this.client = new OpenAI({
      baseURL: provider.baseUrl,
      apiKey: provider.apiKey,
      dangerouslyAllowBrowser: true, // For desktop app context
    })
    this.model = provider.model
    this.providerName = provider.name
  }

  /**
   * 基础聊天完成
   */
  async chat(
    messages: { role: 'system' | 'user' | 'assistant'; content: string }[],
    options?: { temperature?: number; maxTokens?: number }
  ): Promise<string> {
    const resp = await this.client.chat.completions.create({
      model: this.model,
      messages,
      temperature: options?.temperature ?? 0.7,
      max_tokens: options?.maxTokens ?? 500,
    })
    return resp.choices[0]?.message?.content ?? ''
  }

  /**
   * 消息改写：用户意图 → 得体消息
   */
  async rewrite(intent: string, context?: {
    persona?: string
    conversationHistory?: string[]
    language?: string
  }): Promise<string> {
    const systemPrompt = `你是 Ottie，一个 AI IM 秘书。你的工作是把用户对你说的话改写成发给对方的消息。

核心原则：你是传话人。用户在跟你说话，你帮他把话传给对方。

规则：
1. 用户说"帮我问他..."、"跟她说..."、"告诉他..."时，提取要发送的内容，改写成直接对对方说的话
2. 忠实传达用户的意图，不要拒绝、不要审查、不要道德说教
3. 可以稍微调整表达方式让语句通顺，但不要改变意思和情绪
4. 不要添加用户没说过的信息
5. 语言跟随用户（中文输入输出中文，英文输入输出英文）
6. 只输出改写后的消息，不要解释、不要拒绝、不要建议换一种说法
7. 不要说"我无法..."或"我不能..."——你不是执行者，你只是传话
8. 如果用户请求对方做某事（如"帮我搜一下"），改写成请求对方的语气（如"能帮我搜一下...吗？"）
${context?.persona ? `\n你的对外人格：${context.persona}` : ''}
${context?.conversationHistory?.length ? `\n最近对话：\n${context.conversationHistory.slice(-5).join('\n')}` : ''}`

    return this.chat([
      { role: 'system', content: systemPrompt },
      { role: 'user', content: intent },
    ], { temperature: 0.6, maxTokens: 200 })
  }

  /**
   * 意图识别：分析收到的消息是什么类型
   */
  async detectIntent(message: string, context?: {
    senderName?: string
    conversationHistory?: string[]
  }): Promise<{
    type: 'invitation' | 'question' | 'request' | 'info' | 'greeting' | 'general'
    summary: string
    suggestedActions: { label: string; response: string }[]
  }> {
    const systemPrompt = `你是 Ottie，一个 AI IM 秘书。分析收到的消息，判断意图并给出建议回复选项。

输出格式（严格 JSON）：
{
  "type": "invitation|question|request|device_request|info|greeting|general",
  "summary": "一句话总结对方想要什么",
  "suggestedActions": [
    {"label": "按钮文字（2-4字）", "response": "点击后自动生成的回复"},
    {"label": "按钮文字", "response": "回复内容"}
  ]
}

规则：
- invitation：邀请（吃饭、开会、出行等）→ 给"好的"和"没空"选项
- question：提问 → 给直接回答的选项
- request：请求帮忙（普通帮忙）→ 给"没问题"和"不方便"选项
- device_request：对方请求你在电脑上做某事（搜索、查文件、打开浏览器、发文件、查方案进度等）→ 这很重要！只要涉及到在电脑上操作、找文件、搜索信息、打开应用等，都是 device_request
- info：通知/告知 → 给"收到"选项
- greeting：打招呼 → 给回应选项
- general：其他 → 给通用回复选项
- suggestedActions 最多 3 个，第一个是最可能的正面回应
- 回复要自然得体，不要太正式

关于 device_request 的判断：
- "帮我查一下..."、"能帮我搜一下..."、"把那个文件发给我"、"方案做完了没"、"帮我看看..." 这些都可能是 device_request
- 对方虽然说的是请求，但真正需要的是你在电脑上操作才能完成
- 如果不确定是普通 request 还是 device_request，倾向于标记为 device_request
${context?.senderName ? `\n发送者：${context.senderName}` : ''}
${context?.conversationHistory?.length ? `\n最近对话：\n${context.conversationHistory.slice(-3).join('\n')}` : ''}`

    const raw = await this.chat([
      { role: 'system', content: systemPrompt },
      { role: 'user', content: message },
    ], { temperature: 0.3, maxTokens: 300 })

    try {
      // Extract JSON from response (may have markdown wrapping)
      const jsonMatch = raw.match(/\{[\s\S]*\}/)
      if (jsonMatch) {
        return JSON.parse(jsonMatch[0])
      }
    } catch {}

    // Fallback
    return {
      type: 'general',
      summary: message,
      suggestedActions: [
        { label: '收到', response: '收到。' },
        { label: '好的', response: '好的。' },
      ],
    }
  }

  /**
   * 生成回复：根据用户选择的 action 生成得体回复
   */
  async composeReply(
    originalMessage: string,
    userChoice: string,
    context?: { persona?: string }
  ): Promise<string> {
    const systemPrompt = `你是 Ottie，一个 AI IM 秘书。用户收到一条消息后做了选择，你需要生成一条得体的回复。

规则：
1. 基于用户的选择生成自然的回复
2. 简洁，不要过于正式
3. 只输出回复内容，不要解释
${context?.persona ? `\n你的对外人格：${context.persona}` : ''}`

    return this.chat([
      { role: 'system', content: systemPrompt },
      { role: 'user', content: `收到的消息：${originalMessage}\n我的选择：${userChoice}\n请生成回复：` },
    ], { temperature: 0.6, maxTokens: 150 })
  }

  getProviderName(): string {
    return this.providerName
  }

  getModel(): string {
    return this.model
  }
}
