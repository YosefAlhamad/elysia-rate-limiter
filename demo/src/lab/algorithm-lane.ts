import type { AlgorithmName, RateLimitAlgorithm } from '../../../src/algorithms/algorithm'
import type { RateLimitDecision } from '../../../src/core/decision'
import { BoundedHistory } from './bounded-history'
import type { RequestRecord } from './request-record'

export interface LaneTotals {
  readonly allowed: number
  readonly denied: number
}

export class AlgorithmLane {
  private readonly history: BoundedHistory<RequestRecord>
  private state: unknown
  private allowedCount = 0
  private deniedCount = 0

  constructor(
    private readonly algorithm: RateLimitAlgorithm<unknown>,
    historySize: number,
  ) {
    this.history = new BoundedHistory(historySize)
  }

  get name(): AlgorithmName {
    return this.algorithm.name
  }

  get currentState(): unknown {
    return this.state
  }

  send(id: number, at: number, cost: number): RequestRecord {
    const evaluation = this.algorithm.evaluate(this.state, at, cost)
    const record = { id, at, cost, stateBefore: this.state, evaluation }
    this.history.push(record)
    this.state = evaluation.state
    if (evaluation.decision.allowed) this.allowedCount += 1
    else this.deniedCount += 1
    return record
  }

  preview(now: number): RateLimitDecision {
    return this.algorithm.evaluate(this.state, now, 1).decision
  }

  requests(): readonly RequestRecord[] {
    return this.history.toArray()
  }

  latest(): RequestRecord | undefined {
    return this.history.latest()
  }

  totals(): LaneTotals {
    return { allowed: this.allowedCount, denied: this.deniedCount }
  }
}
