/**
 * skill-delegate — 信任委托
 *
 * 规则引擎，决定哪些消息 Agent 可以自动处理，哪些需要用户审批。
 * 早期全部审批，逐步根据用户行为放权。
 */

export interface DelegateRule {
  id: string
  description: string
  // 匹配条件
  senderPattern?: RegExp    // 特定发送者
  contentPattern?: RegExp   // 特定内容模式
  intentType?: string       // 特定意图类型
  // 行为
  action: 'auto-approve' | 'auto-reply' | 'require-approval'
  autoReply?: string        // action = 'auto-reply' 时的回复内容
}

const DEFAULT_RULES: DelegateRule[] = [
  // 默认：所有消息都需要审批
  {
    id: 'default',
    description: '默认需要审批',
    action: 'require-approval',
  },
]

export class DelegateManager {
  private rules: DelegateRule[]

  constructor(rules?: DelegateRule[]) {
    this.rules = rules ?? [...DEFAULT_RULES]
  }

  /**
   * 评估消息，决定是否需要审批
   */
  evaluate(params: {
    sender: string
    content: string
    intentType?: string
  }): { action: 'auto-approve' | 'auto-reply' | 'require-approval'; autoReply?: string } {
    // 按规则顺序匹配，第一个命中的生效
    for (const rule of this.rules) {
      if (rule.id === 'default') continue // default 最后匹配

      let match = true
      if (rule.senderPattern && !rule.senderPattern.test(params.sender)) match = false
      if (rule.contentPattern && !rule.contentPattern.test(params.content)) match = false
      if (rule.intentType && rule.intentType !== params.intentType) match = false

      if (match) {
        return { action: rule.action, autoReply: rule.autoReply }
      }
    }

    // Default rule
    return { action: 'require-approval' }
  }

  addRule(rule: DelegateRule): void {
    // Insert before default rule
    this.rules.splice(this.rules.length - 1, 0, rule)
  }

  removeRule(ruleId: string): void {
    this.rules = this.rules.filter(r => r.id !== ruleId)
  }

  getRules(): DelegateRule[] {
    return [...this.rules]
  }
}
