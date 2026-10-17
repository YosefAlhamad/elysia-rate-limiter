export interface StoreWrite<TResult> {
  readonly value: string
  readonly ttlMs: number
  readonly result: TResult
}

export type StoreMutation<TResult> = (current: string | null) => StoreWrite<TResult>

export interface RateLimitStore {
  update<TResult>(key: string, mutation: StoreMutation<TResult>): Promise<TResult>
  delete(key: string): Promise<void>
  close?(): Promise<void>
}

export const isRateLimitStore = (value: unknown): value is RateLimitStore => {
  if (typeof value !== 'object' || value === null) return false
  if (!('update' in value) || typeof value.update !== 'function') return false
  if (!('delete' in value) || typeof value.delete !== 'function') return false
  return !('close' in value) || value.close === undefined || typeof value.close === 'function'
}
