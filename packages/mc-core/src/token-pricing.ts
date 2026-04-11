/**
 * Token Pricing — 模型定价与成本计算
 *
 * 从 Mission Control 提取，移除外部依赖。
 */

interface ModelPricing {
  inputPerMTok: number
  outputPerMTok: number
}

const DEFAULT_MODEL_PRICING: ModelPricing = {
  inputPerMTok: 3.0,
  outputPerMTok: 15.0,
}

const MODEL_PRICING: Record<string, ModelPricing> = {
  'claude-3-5-haiku': { inputPerMTok: 0.8, outputPerMTok: 4.0 },
  'claude-haiku-4-5': { inputPerMTok: 0.8, outputPerMTok: 4.0 },
  'claude-sonnet-4': { inputPerMTok: 3.0, outputPerMTok: 15.0 },
  'claude-sonnet-4-5': { inputPerMTok: 3.0, outputPerMTok: 15.0 },
  'claude-sonnet-4-6': { inputPerMTok: 3.0, outputPerMTok: 15.0 },
  'claude-opus-4-5': { inputPerMTok: 15.0, outputPerMTok: 75.0 },
  'claude-opus-4-6': { inputPerMTok: 15.0, outputPerMTok: 75.0 },
  'gpt-4o': { inputPerMTok: 2.5, outputPerMTok: 10.0 },
  'gpt-4o-mini': { inputPerMTok: 0.15, outputPerMTok: 0.6 },
  'gemma2:9b': { inputPerMTok: 0.0, outputPerMTok: 0.0 },
}

export function getModelPricing(modelName: string): ModelPricing {
  const normalized = modelName.trim().toLowerCase()
  if (MODEL_PRICING[normalized]) return MODEL_PRICING[normalized]

  for (const [model, pricing] of Object.entries(MODEL_PRICING)) {
    const shortName = model.split('/').pop() || model
    if (normalized.includes(shortName)) return pricing
  }

  return DEFAULT_MODEL_PRICING
}

export function calculateTokenCost(
  modelName: string,
  inputTokens: number,
  outputTokens: number,
): number {
  const pricing = getModelPricing(modelName)
  return ((inputTokens * pricing.inputPerMTok) + (outputTokens * pricing.outputPerMTok)) / 1_000_000
}
