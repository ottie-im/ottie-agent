/**
 * Task Costs — 成本聚合与报告
 *
 * 从 Mission Control 提取。纯数据转换，无 DB 依赖。
 */

export interface TokenCostRecord {
  model: string
  agentName: string
  timestamp: number
  totalTokens: number
  cost: number
  taskId?: number | null
}

export interface TokenStats {
  totalTokens: number
  totalCost: number
  requestCount: number
  avgTokensPerRequest: number
  avgCostPerRequest: number
}

export function calculateStats(records: TokenCostRecord[]): TokenStats {
  if (records.length === 0) {
    return { totalTokens: 0, totalCost: 0, requestCount: 0, avgTokensPerRequest: 0, avgCostPerRequest: 0 }
  }

  const totalTokens = records.reduce((sum, r) => sum + r.totalTokens, 0)
  const totalCost = records.reduce((sum, r) => sum + r.cost, 0)
  const requestCount = records.length

  return {
    totalTokens,
    totalCost,
    requestCount,
    avgTokensPerRequest: Math.round(totalTokens / requestCount),
    avgCostPerRequest: totalCost / requestCount,
  }
}

export function groupByModel(records: TokenCostRecord[]): Record<string, TokenStats> {
  const groups: Record<string, TokenCostRecord[]> = {}
  for (const r of records) {
    if (!groups[r.model]) groups[r.model] = []
    groups[r.model].push(r)
  }
  const result: Record<string, TokenStats> = {}
  for (const [model, recs] of Object.entries(groups)) {
    result[model] = calculateStats(recs)
  }
  return result
}

export function buildTimeline(records: TokenCostRecord[]): Array<{ date: string; cost: number; tokens: number }> {
  const byDate: Record<string, { cost: number; tokens: number }> = {}
  for (const r of records) {
    const date = new Date(r.timestamp).toISOString().split('T')[0]
    if (!byDate[date]) byDate[date] = { cost: 0, tokens: 0 }
    byDate[date].cost += r.cost
    byDate[date].tokens += r.totalTokens
  }
  return Object.entries(byDate)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, totals]) => ({ date, ...totals }))
}
