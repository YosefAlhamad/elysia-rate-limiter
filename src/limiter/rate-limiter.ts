import { AlgorithmFactory } from '../algorithms/algorithm-factory'
import type { AlgorithmName, Evaluation, RateLimitAlgorithm } from '../algorithms/algorithm'
import { type Clock, SystemClock } from '../core/clock'
import type { RateLimitDecision } from '../core/decision'
import { KeyBuilder } from '../keys/key-builder'
import { MemoryStore } from '../stores/memory-store'
import type { RateLimitStore, StoreWrite } from '../stores/store'
import { type RateLimiterOptions, parseOptions, rateLimiterOptionsSchema } from './limiter-schema'

export class RateLimiter {
  private readonly policyLimit: number
  private readonly policyWindowMs: number
  private readonly algorithm: RateLimitAlgorithm<unknown>
  private readonly keys: KeyBuilder
  private readonly clock: Clock
  private readonly store: RateLimitStore
  private readonly ownsStore: boolean

  constructor(options: RateLimiterOptions) {
    const settings = parseOptions(rateLimiterOptionsSchema, options)
    this.policyLimit = settings.limit
    this.policyWindowMs = settings.windowMs
    this.algorithm = AlgorithmFactory.create(settings.algorithm, settings)
    this.keys = new KeyBuilder(settings.prefix, settings.algorithm)
    this.clock = settings.clock ?? new SystemClock()
    this.store = settings.store ?? new MemoryStore({ clock: this.clock })
    this.ownsStore = settings.store === undefined
  }

  get limit(): number {
    return this.policyLimit
  }

  get windowMs(): number {
    return this.policyWindowMs
  }

  get algorithmName(): AlgorithmName {
    return this.algorithm.name
  }

  async consume(identifier: string, cost = 1): Promise<RateLimitDecision> {
    this.assertValidCost(cost)
    return this.store.update(this.keyFor(identifier), (current) => this.toWrite(this.evaluate(current, cost)))
  }

  async peek(identifier: string): Promise<RateLimitDecision> {
    const current = await this.store.read(this.keyFor(identifier))
    return this.evaluate(current, 1).decision
  }

  async reset(identifier: string): Promise<void> {
    return this.store.delete(this.keyFor(identifier))
  }

  async close(): Promise<void> {
    if (this.ownsStore) await this.store.close?.()
  }

  private keyFor(identifier: string): string {
    if (typeof identifier !== 'string') throw new TypeError('Rate limit identifier must be a string')
    return this.keys.build(identifier)
  }

  private assertValidCost(cost: number): void {
    if (Number.isInteger(cost) && cost >= 1 && cost <= this.policyLimit) return
    throw new RangeError(`Rate limit cost must be a whole number from 1 to ${this.policyLimit}`)
  }

  private evaluate(current: string | null, cost: number): Evaluation<unknown> {
    return this.algorithm.evaluate(this.decode(current), this.clock.now(), cost)
  }

  private toWrite(evaluation: Evaluation<unknown>): StoreWrite<RateLimitDecision> {
    return { value: JSON.stringify(evaluation.state), ttlMs: evaluation.ttlMs, result: evaluation.decision }
  }

  private decode(current: string | null): unknown {
    if (current === null) return undefined
    try {
      const result = this.algorithm.stateSchema.safeParse(JSON.parse(current))
      return result.success ? result.data : undefined
    } catch {
      return undefined
    }
  }
}
