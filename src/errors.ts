import type { ZodError } from 'zod'

export class RateLimiterError extends Error {
  override readonly name: string = 'RateLimiterError'
}

export class RateLimiterConfigError extends RateLimiterError {
  override readonly name: string = 'RateLimiterConfigError'

  constructor(error: ZodError) {
    super(RateLimiterConfigError.describe(error), { cause: error })
  }

  private static describe(error: ZodError): string {
    const lines = error.issues.map((issue) => {
      const path = issue.path.map(String).join('.')
      return path.length > 0 ? `${path}: ${issue.message}` : issue.message
    })
    return ['Invalid rate limiter options:', ...lines].join('\n')
  }
}

export class StoreConflictError extends RateLimiterError {
  override readonly name: string = 'StoreConflictError'
}

export class StoreUnavailableError extends RateLimiterError {
  override readonly name: string = 'StoreUnavailableError'
}
