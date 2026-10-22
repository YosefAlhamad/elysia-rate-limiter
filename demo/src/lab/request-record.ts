import type { Evaluation } from '../../../src/algorithms/algorithm'

export interface RequestRecord {
  readonly id: number
  readonly at: number
  readonly cost: number
  readonly stateBefore: unknown
  readonly evaluation: Evaluation<unknown>
}
