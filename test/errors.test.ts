import { describe, expect, test } from 'bun:test'
import { z } from 'zod'
import {
  RateLimiterConfigError,
  RateLimiterError,
  StoreConflictError,
  StoreUnavailableError,
} from '../src/errors'

const zodErrorFor = (input: unknown) => {
  const schema = z.object({
    limit: z.number().int().positive(),
    nested: z.object({ prefix: z.string() }),
  })
  const result = schema.safeParse(input)
  if (result.success) throw new Error('expected the input to be invalid')
  return result.error
}

describe('RateLimiterError', () => {
  test('is an Error with its own name', () => {
    const error = new RateLimiterError('boom')
    expect(error).toBeInstanceOf(Error)
    expect(error.name).toBe('RateLimiterError')
    expect(error.message).toBe('boom')
  })
})

describe('RateLimiterConfigError', () => {
  test('extends RateLimiterError and sets its name', () => {
    const error = new RateLimiterConfigError(zodErrorFor({ limit: 0, nested: { prefix: 'a' } }))
    expect(error).toBeInstanceOf(RateLimiterError)
    expect(error.name).toBe('RateLimiterConfigError')
  })

  test('keeps the ZodError as cause', () => {
    const zodError = zodErrorFor({ limit: 0, nested: { prefix: 'a' } })
    const error = new RateLimiterConfigError(zodError)
    expect(error.cause).toBe(zodError)
  })

  test('names every bad field on its own line', () => {
    const error = new RateLimiterConfigError(zodErrorFor({ limit: -1, nested: { prefix: 3 } }))
    const lines = error.message.split('\n')
    expect(lines[0]).toBe('Invalid rate limiter options:')
    expect(lines).toHaveLength(3)
    expect(lines[1]).toStartWith('limit: ')
    expect(lines[2]).toStartWith('nested.prefix: ')
  })

  test('omits the path for root issues', () => {
    const result = z.string().safeParse(5)
    if (result.success) throw new Error('expected the input to be invalid')
    const error = new RateLimiterConfigError(result.error)
    const lines = error.message.split('\n')
    expect(lines).toHaveLength(2)
    expect(lines[1]).toBe(result.error.issues[0]?.message ?? '')
  })
})

describe('store errors', () => {
  test('StoreConflictError extends RateLimiterError and sets its name', () => {
    const error = new StoreConflictError('conflict')
    expect(error).toBeInstanceOf(RateLimiterError)
    expect(error.name).toBe('StoreConflictError')
    expect(error.message).toBe('conflict')
  })

  test('StoreUnavailableError extends RateLimiterError, sets its name and keeps its cause', () => {
    const cause = new Error('connection refused')
    const error = new StoreUnavailableError('unavailable', { cause })
    expect(error).toBeInstanceOf(RateLimiterError)
    expect(error.name).toBe('StoreUnavailableError')
    expect(error.cause).toBe(cause)
  })
})
