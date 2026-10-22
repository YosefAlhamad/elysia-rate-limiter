import { z } from 'zod'
import { RateLimiterConfigError } from '../../../src/errors'

export const LIMIT_RANGE = { min: 1, max: 20 } as const
export const WINDOW_RANGE_MS = { min: 2_000, max: 30_000 } as const

export const labPolicySchema = z.strictObject({
  limit: z.number().int().min(LIMIT_RANGE.min).max(LIMIT_RANGE.max),
  windowMs: z.number().int().min(WINDOW_RANGE_MS.min).max(WINDOW_RANGE_MS.max),
})

export type LabPolicyInput = z.input<typeof labPolicySchema>

export type LabPolicy = Readonly<z.output<typeof labPolicySchema>>

export const parseLabPolicy = (input: unknown): LabPolicy => {
  const result = labPolicySchema.safeParse(input)
  if (!result.success) throw new RateLimiterConfigError(result.error)
  return result.data
}
