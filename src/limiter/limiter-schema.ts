import { z } from 'zod'
import { type Clock, isClock } from '../core/clock'
import { Duration } from '../core/duration'
import { RateLimiterConfigError } from '../errors'
import { type RateLimitStore, isRateLimitStore } from '../stores/store'

export const rateLimiterOptionsShape = {
  limit: z.number().int().positive().max(1_000_000_000),
  window: Duration.schema,
  algorithm: z.enum(['fixed-window', 'sliding-window', 'token-bucket']).default('sliding-window'),
  prefix: z
    .string()
    .regex(/^[A-Za-z0-9_-]{1,64}$/, 'Prefix must be 1 to 64 letters, digits, "_" or "-"')
    .default('rate-limit'),
  store: z.custom<RateLimitStore>(isRateLimitStore, 'Expected a store with read(), update() and delete()').optional(),
  clock: z.custom<Clock>(isClock, 'Expected an object with a now() method').optional(),
}

export const withWindowMs = <TOptions extends { readonly window: number }>({
  window,
  ...rest
}: TOptions): Omit<TOptions, 'window'> & { readonly windowMs: number } => ({ ...rest, windowMs: window })

export const rateLimiterOptionsSchema = z.strictObject(rateLimiterOptionsShape).transform(withWindowMs)

export type RateLimiterOptions = z.input<typeof rateLimiterOptionsSchema>

export type RateLimiterSettings = z.output<typeof rateLimiterOptionsSchema>

export const parseOptions = <TOutput>(schema: z.ZodType<TOutput>, options: unknown): TOutput => {
  const result = schema.safeParse(options)
  if (!result.success) throw new RateLimiterConfigError(result.error)
  return result.data
}
