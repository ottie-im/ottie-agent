// Event Bus
export { eventBus } from './event-bus'
export type { OttieEvent, OttieEventType } from './event-bus'

// Task Tracker
export { TaskTracker } from './task-tracker'
export type { OttieTask, TaskStatus, TaskType } from './task-tracker'

// Trust Score
export { TrustScoreManager } from './trust-score'
export type { TrustFactors } from './trust-score'

// Injection Guard
export { scanForInjection, sanitizeForShell, sanitizeForPrompt } from './injection-guard'
export type { InjectionReport, InjectionMatch, GuardOptions } from './injection-guard'

// Token Pricing
export { getModelPricing, calculateTokenCost } from './token-pricing'

// Task Costs
export { calculateStats, groupByModel, buildTimeline } from './task-costs'
export type { TokenCostRecord, TokenStats } from './task-costs'
