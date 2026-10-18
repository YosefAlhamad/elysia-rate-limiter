import type { Context } from 'elysia'
import { z } from 'zod'
import type { RateLimitDecision } from '../core/decision'
import { trustProxySchema } from '../keys/client-ip-resolver'
import { rateLimiterOptionsShape, withWindowMs } from '../limiter/limiter-schema'

export type RateLimitElysiaContext = Context<{ params: Record<string, string | undefined> }>

export interface RateLimitRequestContext {
  readonly request: Request
  readonly path: string
  readonly ip: string | null
  readonly elysia: RateLimitElysiaContext
}

type MaybePromise<TValue> = TValue | Promise<TValue>

export type RateLimitKeyFunction = (context: RateLimitRequestContext) => MaybePromise<string>
export type RateLimitCostFunction = (context: RateLimitRequestContext) => MaybePromise<number>
export type RateLimitSkipFunction = (context: RateLimitRequestContext) => MaybePromise<boolean>
export type RateLimitedHandler = (context: RateLimitRequestContext, decision: RateLimitDecision) => unknown

const isFunction = (value: unknown): boolean => typeof value === 'function'

const functionOption = <TFunction>() => z.custom<TFunction>(isFunction, 'Expected a function')

export const rateLimitPluginOptionsSchema = z
  .strictObject({
    ...rateLimiterOptionsShape,
    key: functionOption<RateLimitKeyFunction>().optional(),
    cost: z.union([z.number().int().positive(), functionOption<RateLimitCostFunction>()]).default(1),
    skip: functionOption<RateLimitSkipFunction>().optional(),
    trustProxy: trustProxySchema.default(false),
    ipv6Subnet: z.number().int().min(0).max(128).default(56),
    headers: z.boolean().default(true),
    failureMode: z.enum(['open', 'closed']).default('open'),
    onLimited: functionOption<RateLimitedHandler>().optional(),
    scope: z.enum(['global', 'scoped', 'local']).default('scoped'),
  })
  .refine((options) => typeof options.cost !== 'number' || options.cost <= options.limit, {
    message: 'Cost must not be greater than limit',
    path: ['cost'],
  })
  .transform(withWindowMs)

export type RateLimitPluginOptions = z.input<typeof rateLimitPluginOptionsSchema>

export type RateLimitPluginSettings = z.output<typeof rateLimitPluginOptionsSchema>
