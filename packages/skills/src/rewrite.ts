/**
 * skill-rewrite: 把用户意图改写成得体的对外消息
 *
 * 当前实现用简单的规则引擎。
 * 后续接入 LLM（Claude/Gemma）做更自然的改写。
 */

export interface RewriteInput {
  intent: string
  persona?: string
  conversationContext?: string[]
}

export interface RewriteOutput {
  rewritten: string
  confidence: number
}

// 指令前缀模式：用户在指挥 Agent
const COMMAND_PATTERNS = [
  { pattern: /^(帮我|替我|跟他|跟她|告诉他|告诉她|问他|问她|和他说|和她说|跟他说|跟她说)(.+)/, extract: 2 },
  { pattern: /^(tell him|tell her|ask him|ask her|let him know|let her know)\s+(.+)/i, extract: 2 },
]

// 口语化 → 书面化的简单替换
const POLISH_RULES: [RegExp, string][] = [
  [/^那个/, ''],
  [/^嗯/, ''],
  [/^哦/, ''],
  [/不去了/, '去不了了'],
  [/搞定了/, '完成了'],
  [/咋回事/, '怎么回事'],
]

export function rewrite(input: RewriteInput): RewriteOutput {
  let text = input.intent.trim()

  // Step 1: 提取指令中的真正内容
  for (const { pattern, extract } of COMMAND_PATTERNS) {
    const match = text.match(pattern)
    if (match && match[extract]) {
      text = match[extract].trim()
      break
    }
  }

  // Step 2: 口语化润色
  for (const [pattern, replacement] of POLISH_RULES) {
    text = text.replace(pattern, replacement)
  }

  // Step 3: 确保结尾有标点
  if (text && !/[。？！.?!]$/.test(text)) {
    // 疑问句加问号
    if (/吗|呢|么|嘛|不$|没$|\?/.test(text)) {
      text += '？'
    } else {
      text += '。'
    }
  }

  // Step 4: 首字母大写（英文）
  if (/^[a-z]/.test(text)) {
    text = text.charAt(0).toUpperCase() + text.slice(1)
  }

  return {
    rewritten: text,
    confidence: text === input.intent.trim() ? 0.5 : 0.8,
  }
}
