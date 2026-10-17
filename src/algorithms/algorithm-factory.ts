import type { AlgorithmName, AlgorithmPolicy, RateLimitAlgorithm, RateLimitAlgorithmConstructor } from './algorithm'
import { FixedWindow } from './fixed-window'
import { SlidingWindow } from './sliding-window'
import { TokenBucket } from './token-bucket'

export class AlgorithmFactory {
  private static readonly constructors: ReadonlyMap<AlgorithmName, RateLimitAlgorithmConstructor> = new Map<
    AlgorithmName,
    RateLimitAlgorithmConstructor
  >([
    ['fixed-window', FixedWindow],
    ['sliding-window', SlidingWindow],
    ['token-bucket', TokenBucket],
  ])

  static create(name: AlgorithmName, policy: AlgorithmPolicy): RateLimitAlgorithm<unknown> {
    const AlgorithmClass = AlgorithmFactory.constructors.get(name)
    if (AlgorithmClass === undefined) throw new RangeError(`Unknown rate limit algorithm: ${name}`)
    return new AlgorithmClass(policy)
  }
}
