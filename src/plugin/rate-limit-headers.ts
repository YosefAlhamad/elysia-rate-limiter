import type { RateLimitDecision } from '../core/decision'

const MS_PER_SECOND = 1_000

export class RateLimitHeaders {
  static from(decision: RateLimitDecision, windowMs: number, now: number): Record<string, string> {
    const headers: Record<string, string> = {
      'RateLimit-Limit': String(decision.limit),
      'RateLimit-Remaining': String(decision.remaining),
      'RateLimit-Reset': String(Math.max(0, RateLimitHeaders.toSeconds(decision.resetAt - now))),
      'RateLimit-Policy': `${decision.limit};w=${RateLimitHeaders.toSeconds(windowMs)}`,
    }
    if (decision.allowed) return headers
    return { ...headers, 'Retry-After': String(RateLimitHeaders.retryAfterSeconds(decision)) }
  }

  static retryAfterSeconds(decision: RateLimitDecision): number {
    return Math.max(1, RateLimitHeaders.toSeconds(decision.retryAfterMs))
  }

  private static toSeconds(ms: number): number {
    return Math.ceil(ms / MS_PER_SECOND)
  }
}
