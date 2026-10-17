import { z } from 'zod'
import { RateLimiterConfigError, StoreConflictError, StoreUnavailableError } from '../errors'
import type { RateLimitStore, StoreMutation, StoreWrite } from './store'

export interface RedisCommandClient {
  send(command: string, args: string[]): Promise<unknown>
}

export interface RedisStoreOptions {
  readonly client: RedisCommandClient
  readonly maxAttempts?: number
}

const isRedisCommandClient = (value: unknown): value is RedisCommandClient =>
  typeof value === 'object' && value !== null && 'send' in value && typeof value.send === 'function'

const redisStoreOptionsSchema = z.strictObject({
  client: z.custom<RedisCommandClient>(isRedisCommandClient, 'Expected a client with a send() method'),
  maxAttempts: z.number().int().min(1).max(20).default(5),
})

export class RedisStore implements RateLimitStore {
  private static readonly COMPARE_AND_SET_SCRIPT = [
    "local current = redis.call('GET', KEYS[1])",
    "if ARGV[1] == '0' then",
    '  if current then return 0 end',
    'elseif current ~= ARGV[2] then',
    '  return 0',
    'end',
    "redis.call('SET', KEYS[1], ARGV[3], 'PX', ARGV[4])",
    'return 1',
  ].join('\n')

  private static readonly COMPARE_AND_SET_SHA = new Bun.CryptoHasher('sha1')
    .update(RedisStore.COMPARE_AND_SET_SCRIPT)
    .digest('hex')

  private readonly client: RedisCommandClient
  private readonly maxAttempts: number

  constructor(options: RedisStoreOptions) {
    const result = redisStoreOptionsSchema.safeParse(options)
    if (!result.success) throw new RateLimiterConfigError(result.error)
    this.client = result.data.client
    this.maxAttempts = result.data.maxAttempts
  }

  async update<TResult>(key: string, mutation: StoreMutation<TResult>): Promise<TResult> {
    for (let attempt = 0; attempt < this.maxAttempts; attempt += 1) {
      const current = await this.read(key)
      const write = mutation(current)
      if (await this.compareAndSet(key, current, write)) return write.result
    }
    throw new StoreConflictError(`Rate limit state kept changing after ${this.maxAttempts} attempts`)
  }

  async delete(key: string): Promise<void> {
    await this.send('DEL', [key])
  }

  private async read(key: string): Promise<string | null> {
    const reply = await this.send('GET', [key])
    if (reply === null || typeof reply === 'string') return reply
    throw new StoreUnavailableError('Rate limit store returned an unexpected reply')
  }

  private async compareAndSet<TResult>(key: string, current: string | null, write: StoreWrite<TResult>): Promise<boolean> {
    const existed = current === null ? '0' : '1'
    const args = ['1', key, existed, current ?? '', write.value, RedisStore.ttlArgument(write.ttlMs)]
    const reply = await this.runScript(args)
    return Number(reply) === 1
  }

  private async runScript(args: string[]): Promise<unknown> {
    try {
      return await this.client.send('EVALSHA', [RedisStore.COMPARE_AND_SET_SHA, ...args])
    } catch (error) {
      if (!RedisStore.isMissingScript(error)) throw RedisStore.unavailable(error)
      return this.send('EVAL', [RedisStore.COMPARE_AND_SET_SCRIPT, ...args])
    }
  }

  private async send(command: string, args: string[]): Promise<unknown> {
    try {
      return await this.client.send(command, args)
    } catch (error) {
      throw RedisStore.unavailable(error)
    }
  }

  private static ttlArgument(ttlMs: number): string {
    if (!Number.isFinite(ttlMs)) throw new RangeError('Store TTL must be a finite number of milliseconds')
    return String(Math.max(1, Math.ceil(ttlMs)))
  }

  private static isMissingScript(error: unknown): boolean {
    return error instanceof Error && error.message.includes('NOSCRIPT')
  }

  private static unavailable(error: unknown): StoreUnavailableError {
    return new StoreUnavailableError('Rate limit store is unavailable', { cause: error })
  }
}
