/**
 * Injection Guard — 注入检测
 *
 * 从 Mission Control 提取，扫描 prompt 注入、命令注入、数据外泄。
 * 用于扫描用户输入和 agent 输出，保证安全。
 */

export type InjectionSeverity = 'info' | 'warning' | 'critical'
export type InjectionCategory = 'prompt' | 'command' | 'exfiltration' | 'encoding'

export interface InjectionMatch {
  category: InjectionCategory
  severity: InjectionSeverity
  rule: string
  description: string
  matched: string
}

export interface InjectionReport {
  safe: boolean
  matches: InjectionMatch[]
}

export interface GuardOptions {
  criticalOnly?: boolean
  maxLength?: number
  context?: 'prompt' | 'display' | 'shell'
}

interface InjectionRule {
  rule: string
  category: InjectionCategory
  severity: InjectionSeverity
  pattern: RegExp
  description: string
  contexts: Array<'prompt' | 'display' | 'shell'>
}

const RULES: InjectionRule[] = [
  // Prompt injection
  {
    rule: 'prompt-override',
    category: 'prompt',
    severity: 'critical',
    pattern: /\b(?:ignore|disregard|forget|override)\s+(?:all\s+)?(?:previous|prior|above|your|system)\s+(?:instructions?|rules?|guidelines?|prompts?|directives?|constraints?)/i,
    description: 'Attempts to override system instructions',
    contexts: ['prompt', 'display'],
  },
  {
    rule: 'prompt-new-identity',
    category: 'prompt',
    severity: 'critical',
    pattern: /\b(?:you\s+are\s+now|act\s+as\s+(?:if\s+you\s+(?:are|were)\s+)?(?:a\s+)?(?:(?:un)?restricted|evil|jailbr(?:o|ea)ken|different|new))\b/i,
    description: 'Attempts to assign a new identity',
    contexts: ['prompt', 'display'],
  },
  {
    rule: 'prompt-safety-bypass',
    category: 'prompt',
    severity: 'critical',
    pattern: /\b(?:bypass|disable|turn\s+off|deactivate|circumvent)\s+(?:all\s+)?(?:safety|security|content|moderation|ethic(?:al|s)?)\s*(?:filters?|checks?|guard(?:rail)?s?|rules?|measures?|restrictions?)?\b/i,
    description: 'Attempts to bypass safety measures',
    contexts: ['prompt', 'display'],
  },
  {
    rule: 'prompt-hidden-instruction',
    category: 'prompt',
    severity: 'critical',
    pattern: /\[(?:SYSTEM|INST|HIDDEN|ADMIN|IMPORTANT)\s*(?:OVERRIDE|MESSAGE|INSTRUCTION)?[\]:]\s*.{10,}/i,
    description: 'Hidden system-style instruction markers',
    contexts: ['prompt', 'display'],
  },
  {
    rule: 'prompt-delimiter-escape',
    category: 'prompt',
    severity: 'warning',
    pattern: /(?:<\/?(?:system|user|assistant|human|ai|instruction|context)>|```\s*system\b|\|>\s*(?:system|admin)\b)/i,
    description: 'Prompt delimiter injection',
    contexts: ['prompt', 'display'],
  },
  // Command injection
  {
    rule: 'cmd-shell-metachar',
    category: 'command',
    severity: 'critical',
    pattern: /(?:[;&|`$]\s*(?:rm\b|wget\b|curl\b|nc\b|ncat\b|bash\b|sh\b|python\b|perl\b|ruby\b|php\b|node\b))|(?:\$\(.*(?:rm|wget|curl|nc|bash|sh))/i,
    description: 'Shell metacharacters followed by dangerous commands',
    contexts: ['prompt', 'shell'],
  },
  {
    rule: 'cmd-path-traversal',
    category: 'command',
    severity: 'critical',
    pattern: /(?:\.\.\/){2,}|\.\.\\(?:\.\.\\){1,}/,
    description: 'Path traversal sequences',
    contexts: ['prompt', 'shell', 'display'],
  },
  {
    rule: 'cmd-reverse-shell',
    category: 'command',
    severity: 'critical',
    pattern: /\b(?:\/dev\/tcp\/|mkfifo|nc\s+-[elp]|ncat\s.*-[elp]|bash\s+-i\s+>&?\s*\/dev\/|python.*socket.*connect)\b/i,
    description: 'Reverse shell patterns',
    contexts: ['prompt', 'shell'],
  },
  // Exfiltration
  {
    rule: 'exfil-send-data',
    category: 'exfiltration',
    severity: 'critical',
    pattern: /\b(?:send|post|upload|transmit|exfiltrate|forward)\s+(?:all\s+)?(?:the\s+)?(?:data|files?|contents?|secrets?|keys?|tokens?|credentials?|passwords?|env(?:ironment)?)\s+(?:to|via|using|through)\b/i,
    description: 'Instructions to exfiltrate data',
    contexts: ['prompt', 'display'],
  },
]

export function scanForInjection(input: string, options: GuardOptions = {}): InjectionReport {
  const { criticalOnly = false, maxLength = 50_000, context = 'prompt' } = options

  if (!input || typeof input !== 'string') {
    return { safe: true, matches: [] }
  }

  const text = input.length > maxLength ? input.slice(0, maxLength) : input
  const matches: InjectionMatch[] = []

  for (const rule of RULES) {
    if (!rule.contexts.includes(context)) continue
    const match = rule.pattern.exec(text)
    if (match) {
      matches.push({
        category: rule.category,
        severity: rule.severity,
        rule: rule.rule,
        description: rule.description,
        matched: match[0].slice(0, 80),
      })
    }
  }

  const unsafe = matches.some(
    m => m.severity === 'critical' || (!criticalOnly && m.severity === 'warning')
  )

  return { safe: !unsafe, matches }
}

export function sanitizeForShell(input: string): string {
  return input
    .replace(/\0/g, '')
    .replace(/[;&|`$(){}[\]<>!\\]/g, '')
    .replace(/\n/g, ' ')
    .replace(/\r/g, '')
}

export function sanitizeForPrompt(input: string): string {
  return input
    .replace(/<\/?(?:system|user|assistant|human|ai|instruction|context)>/gi, '')
    .replace(/\[(?:SYSTEM|INST|HIDDEN|ADMIN)\s*(?:OVERRIDE|MESSAGE|INSTRUCTION)?[\]:]/gi, '')
}
