import { z } from 'zod'
import type { AlgorithmName } from '../../../src/algorithms/algorithm'
import { AlgorithmFactory } from '../../../src/algorithms/algorithm-factory'
import type { RateLimitDecision } from '../../../src/core/decision'
import { RateLimiterConfigError } from '../../../src/errors'
import { AlgorithmLane, type LaneTotals } from './algorithm-lane'
import { type LabPolicy, type LabPolicyInput, parseLabPolicy } from './lab-policy'
import type { RequestRecord } from './request-record'
import { type ControllableClock, SimulationClock, isControllableClock } from './simulation-clock'
import type { TrafficSource } from './traffic/traffic-source'

export const ALGORITHM_NAMES: readonly AlgorithmName[] = ['fixed-window', 'sliding-window', 'token-bucket']

const MAX_PENDING_ARRIVALS = 500

export interface LaneSnapshot {
  readonly name: AlgorithmName
  readonly state: unknown
  readonly requests: readonly RequestRecord[]
  readonly latest: RequestRecord | undefined
  readonly totals: LaneTotals
  readonly preview: RateLimitDecision
}

export interface LabSnapshot {
  readonly version: number
  readonly now: number
  readonly policy: LabPolicy
  readonly pendingArrivals: number
  readonly lanes: Readonly<Record<AlgorithmName, LaneSnapshot>>
}

export interface RateLimitLabOptions {
  readonly policy: LabPolicyInput
  readonly clock?: ControllableClock
  readonly historySize?: number
}

const labOptionsSchema = z.strictObject({
  policy: z.unknown(),
  clock: z.custom<ControllableClock>(isControllableClock, 'Expected a clock with now(), set() and advance()').optional(),
  historySize: z.number().int().min(1).max(5_000).default(300),
})

export class RateLimitLab {
  private readonly clock: ControllableClock
  private readonly historySize: number
  private readonly listeners = new Set<() => void>()
  private currentPolicy: LabPolicy
  private lanes: ReadonlyMap<AlgorithmName, AlgorithmLane>
  private pending: readonly number[] = []
  private traffic: TrafficSource | undefined
  private nextId = 1
  private version = 0
  private cached: LabSnapshot

  constructor(options: RateLimitLabOptions) {
    const result = labOptionsSchema.safeParse(options)
    if (!result.success) throw new RateLimiterConfigError(result.error)
    this.clock = result.data.clock ?? new SimulationClock()
    this.historySize = result.data.historySize
    this.currentPolicy = parseLabPolicy(result.data.policy)
    this.lanes = this.createLanes()
    this.cached = this.buildSnapshot()
  }

  get policy(): LabPolicy {
    return this.currentPolicy
  }

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  readonly snapshot = (): LabSnapshot => this.cached

  send(cost = 1): void {
    this.assertValidCost(cost)
    this.dispatch(this.clock.now(), cost)
    this.publish()
  }

  schedule(arrivals: readonly number[]): void {
    const now = this.clock.now()
    const upcoming = arrivals.filter((at) => Number.isInteger(at) && at >= now)
    this.pending = [...this.pending, ...upcoming].sort((left, right) => left - right).slice(0, MAX_PENDING_ARRIVALS)
    this.publish()
  }

  setTraffic(source: TrafficSource | undefined): void {
    this.traffic = source
  }

  advance(ms: number): void {
    if (!Number.isInteger(ms) || ms < 0) throw new RangeError('Lab time must advance by a whole number of milliseconds')
    const from = this.clock.now()
    const to = from + ms
    for (const at of this.arrivalsUntil(from, to)) this.dispatch(at, 1)
    this.clock.set(to)
    this.publish()
  }

  reset(): void {
    this.lanes = this.createLanes()
    this.pending = []
    this.nextId = 1
    this.clock.set(0)
    this.publish()
  }

  configure(input: LabPolicyInput): void {
    this.currentPolicy = parseLabPolicy(input)
    this.reset()
  }

  private arrivalsUntil(from: number, to: number): readonly number[] {
    const due = this.pending.filter((at) => at <= to)
    this.pending = this.pending.filter((at) => at > to)
    const generated = this.traffic?.arrivalsBetween(from, to) ?? []
    return [...due, ...generated].sort((left, right) => left - right)
  }

  private dispatch(at: number, cost: number): void {
    this.clock.set(at)
    for (const lane of this.lanes.values()) lane.send(this.nextId, at, cost)
    this.nextId += 1
  }

  private createLanes(): ReadonlyMap<AlgorithmName, AlgorithmLane> {
    return new Map(
      ALGORITHM_NAMES.map((name) => [name, new AlgorithmLane(AlgorithmFactory.create(name, this.currentPolicy), this.historySize)]),
    )
  }

  private assertValidCost(cost: number): void {
    if (Number.isInteger(cost) && cost >= 1 && cost <= this.currentPolicy.limit) return
    throw new RangeError(`Request cost must be a whole number from 1 to ${this.currentPolicy.limit}`)
  }

  private publish(): void {
    this.version += 1
    this.cached = this.buildSnapshot()
    for (const listener of this.listeners) listener()
  }

  private buildSnapshot(): LabSnapshot {
    const now = this.clock.now()
    return {
      version: this.version,
      now,
      policy: this.currentPolicy,
      pendingArrivals: this.pending.length,
      lanes: {
        'fixed-window': this.laneSnapshot('fixed-window', now),
        'sliding-window': this.laneSnapshot('sliding-window', now),
        'token-bucket': this.laneSnapshot('token-bucket', now),
      },
    }
  }

  private laneSnapshot(name: AlgorithmName, now: number): LaneSnapshot {
    const lane = this.lanes.get(name)
    if (lane === undefined) throw new RangeError(`No lane for algorithm ${name}`)
    return {
      name: lane.name,
      state: lane.currentState,
      requests: lane.requests(),
      latest: lane.latest(),
      totals: lane.totals(),
      preview: lane.preview(now),
    }
  }
}
