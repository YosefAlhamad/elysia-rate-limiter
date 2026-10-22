import { Elysia } from 'elysia'
import { type Clock, SystemClock } from '../core/clock'
import type { RateLimitDecision } from '../core/decision'
import { RateLimiterError, StoreUnavailableError } from '../errors'
import { ClientIpResolver } from '../keys/client-ip-resolver'
import { parseOptions } from '../limiter/limiter-schema'
import { RateLimiter } from '../limiter/rate-limiter'
import {
  type RateLimitElysiaContext,
  type RateLimitPluginOptions,
  type RateLimitPluginSettings,
  type RateLimitRequestContext,
  rateLimitPluginOptionsSchema,
} from './plugin-schema'
import { RateLimitHeaders } from './rate-limit-headers'

export type RateLimitOutcome =
  | { readonly status: 'allowed'; readonly decision: RateLimitDecision }
  | { readonly status: 'limited'; readonly decision: RateLimitDecision }
  | { readonly status: 'skipped' }
  | { readonly status: 'unavailable'; readonly error: RateLimiterError }

interface RequestCheck {
  readonly context: RateLimitRequestContext
  readonly outcome: RateLimitOutcome
}

const UNKNOWN_CLIENT = 'unknown-client'

const SKIPPED: RateLimitOutcome = { status: 'skipped' }

let pluginInstances = 0

class RateLimitGuard {
  private readonly limiter: RateLimiter
  private readonly resolver: ClientIpResolver
  private readonly clock: Clock
  private readonly checks = new WeakMap<Request, RequestCheck>()

  constructor(private readonly settings: RateLimitPluginSettings) {
    const { limit, windowMs, algorithm, prefix, store, clock } = settings
    this.limiter = new RateLimiter({ limit, window: windowMs, algorithm, prefix, store, clock })
    this.resolver = new ClientIpResolver(settings.trustProxy)
    this.clock = clock ?? new SystemClock()
  }

  async check(elysia: RateLimitElysiaContext): Promise<RateLimitOutcome> {
    const result = await this.run(elysia)
    this.checks.set(elysia.request, result)
    return result.outcome
  }

  async respond(elysia: RateLimitElysiaContext): Promise<unknown> {
    const { context, outcome } = await this.checkFor(elysia)
    this.applyHeaders(elysia, outcome)
    if (outcome.status === 'limited') return this.limited(elysia, context, outcome.decision)
    if (outcome.status !== 'unavailable' || this.settings.failureMode === 'open') return undefined
    elysia.set.status = 503
    return { error: 'Rate limiter unavailable' }
  }

  close(): Promise<void> {
    return this.limiter.close()
  }

  private async checkFor(elysia: RateLimitElysiaContext): Promise<RequestCheck> {
    return this.checks.get(elysia.request) ?? this.run(elysia)
  }

  private async run(elysia: RateLimitElysiaContext): Promise<RequestCheck> {
    const context = this.requestContext(elysia)
    return { context, outcome: await this.evaluate(context) }
  }

  private async evaluate(context: RateLimitRequestContext): Promise<RateLimitOutcome> {
    if ((await this.settings.skip?.(context)) === true) return SKIPPED
    const identifier = await this.identifierFor(context)
    const cost = await this.costFor(context)
    return this.consume(identifier, cost)
  }

  private requestContext(elysia: RateLimitElysiaContext): RateLimitRequestContext {
    const address = this.resolver.resolve(elysia.request, elysia.server)
    const ip = address === null ? null : address.toKey(this.settings.ipv6Subnet)
    return { request: elysia.request, path: elysia.path, ip, elysia }
  }

  private async identifierFor(context: RateLimitRequestContext): Promise<string> {
    if (this.settings.key === undefined) return context.ip ?? UNKNOWN_CLIENT
    const identifier: unknown = await this.settings.key(context)
    if (typeof identifier !== 'string') throw new TypeError('Rate limit key function must return a string')
    return identifier
  }

  private async costFor(context: RateLimitRequestContext): Promise<number> {
    const { cost, limit } = this.settings
    const value: unknown = typeof cost === 'number' ? cost : await cost(context)
    if (typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= limit) return value
    throw new RangeError(`Rate limit cost must be a whole number from 1 to ${limit}`)
  }

  private async consume(identifier: string, cost: number): Promise<RateLimitOutcome> {
    try {
      const decision = await this.limiter.consume(identifier, cost)
      return { status: decision.allowed ? 'allowed' : 'limited', decision }
    } catch (error) {
      return { status: 'unavailable', error: RateLimitGuard.toRateLimiterError(error) }
    }
  }

  private applyHeaders(elysia: RateLimitElysiaContext, outcome: RateLimitOutcome): void {
    if (!this.settings.headers || !('decision' in outcome)) return
    const headers = RateLimitHeaders.from(outcome.decision, this.settings.windowMs, this.clock.now())
    for (const [name, value] of Object.entries(headers)) elysia.set.headers[name] = value
  }

  private async limited(
    elysia: RateLimitElysiaContext,
    context: RateLimitRequestContext,
    decision: RateLimitDecision,
  ): Promise<unknown> {
    elysia.set.status = 429
    const custom: unknown = await this.settings.onLimited?.(context, decision)
    if (custom !== undefined && custom !== null) return custom
    return { error: 'Too Many Requests', retryAfter: RateLimitHeaders.retryAfterSeconds(decision) }
  }

  private static toRateLimiterError(error: unknown): RateLimiterError {
    if (error instanceof RateLimiterError) return error
    return new StoreUnavailableError('Rate limit store is unavailable', { cause: error })
  }
}

export const rateLimit = (options: RateLimitPluginOptions) => {
  const settings = parseOptions(rateLimitPluginOptionsSchema, options)
  const guard = new RateLimitGuard(settings)
  const scope = { as: settings.scope as 'scoped' }
  pluginInstances += 1
  return new Elysia({ name: 'elysia-rate-limiter', seed: pluginInstances })
    .derive(scope, async (context) => ({ rateLimit: await guard.check(context) }))
    .onBeforeHandle(scope, (context) => guard.respond(context))
    .onStop(() => guard.close())
}

export type RateLimitPlugin = ReturnType<typeof rateLimit>
