/**
 * skill-persona — 对外人格控制
 *
 * 控制 Agent 对外展示的形象：哪些信息该暴露、什么语气、什么风格。
 * 基于 SOUL.md 配置。
 */

export interface Persona {
  name: string
  tone: 'formal' | 'casual' | 'friendly' | 'professional'
  language: 'zh' | 'en' | 'auto'
  boundaries: string[]  // 不暴露的信息，如 "工作单位"、"家庭住址"
  greeting?: string     // 自定义打招呼方式
}

const DEFAULT_PERSONA: Persona = {
  name: 'Ottie',
  tone: 'friendly',
  language: 'auto',
  boundaries: [],
}

export function createPersona(config: Partial<Persona> = {}): Persona {
  return { ...DEFAULT_PERSONA, ...config }
}

/**
 * 检查消息是否触犯了人格边界
 */
export function checkBoundaries(message: string, persona: Persona): { safe: boolean; violation?: string } {
  for (const boundary of persona.boundaries) {
    if (message.toLowerCase().includes(boundary.toLowerCase())) {
      return { safe: false, violation: `消息包含了不应暴露的信息：${boundary}` }
    }
  }
  return { safe: true }
}

/**
 * 根据人格生成改写提示
 */
export function getPersonaPrompt(persona: Persona): string {
  const toneMap = {
    formal: '正式、礼貌、商务',
    casual: '随意、轻松、口语化',
    friendly: '友好、亲切、自然',
    professional: '专业、简洁、高效',
  }
  return `你的名字是${persona.name}。语气：${toneMap[persona.tone]}。${persona.greeting ? `打招呼方式：${persona.greeting}。` : ''}`
}
