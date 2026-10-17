import { z } from 'zod'
import { RateLimiterConfigError } from '../errors'

const DURATION_PATTERN = /^(\d+)(ms|s|m|h|d)$/

const UNIT_MILLISECONDS = new Map<string, number>([
  ['ms', 1],
  ['s', 1_000],
  ['m', 60_000],
  ['h', 3_600_000],
  ['d', 86_400_000],
])

const MAX_DURATION_MS = 30 * 86_400_000

export class Duration {
  private static readonly millisecondsSchema = z
    .number()
    .int('Duration must be a whole number of milliseconds')
    .min(1, 'Duration must be at least 1ms')
    .max(MAX_DURATION_MS, 'Duration must be at most 30 days')

  private static readonly textSchema = z
    .string()
    .regex(DURATION_PATTERN, 'Duration must look like "500ms", "30s", "15m", "1h" or "1d"')
    .transform((text) => Duration.parseText(text))
    .pipe(Duration.millisecondsSchema)

  static readonly schema = z.union([z.number(), z.string()]).transform((input, context) => {
    const result = Duration.schemaFor(input).safeParse(input)
    if (result.success) return result.data
    for (const issue of result.error.issues) context.addIssue({ code: 'custom', message: issue.message })
    return z.NEVER
  })

  static toMilliseconds(input: number | string): number {
    const result = Duration.schema.safeParse(input)
    if (!result.success) throw new RateLimiterConfigError(result.error)
    return result.data
  }

  private static schemaFor(input: number | string): z.ZodType<number, number | string> {
    return typeof input === 'number' ? Duration.millisecondsSchema : Duration.textSchema
  }

  private static parseText(text: string): number {
    const match = DURATION_PATTERN.exec(text)
    const amount = match?.[1]
    const unit = match?.[2]
    if (amount === undefined || unit === undefined) return Number.NaN
    return Number(amount) * (UNIT_MILLISECONDS.get(unit) ?? Number.NaN)
  }
}
