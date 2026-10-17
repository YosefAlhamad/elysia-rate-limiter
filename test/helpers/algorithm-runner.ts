import type { Evaluation, RateLimitAlgorithm } from '../../src/algorithms/algorithm'
import type { Clock } from '../../src/core/clock'

export class AlgorithmRunner<TState> {
  private state: TState | undefined

  constructor(
    private readonly algorithm: RateLimitAlgorithm<TState>,
    private readonly clock: Clock,
  ) {}

  consume(cost = 1): Evaluation<TState> {
    const evaluation = this.peek(cost)
    this.state = evaluation.state
    return evaluation
  }

  peek(cost = 1): Evaluation<TState> {
    return this.algorithm.evaluate(this.state, this.clock.now(), cost)
  }

  consumeTimes(times: number, cost = 1): Evaluation<TState>[] {
    return Array.from({ length: times }, () => this.consume(cost))
  }

  get current(): TState | undefined {
    return this.state
  }
}
