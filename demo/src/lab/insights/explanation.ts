import type { RequestRecord } from '../request-record'

export type StepTone = 'info' | 'allowed' | 'denied'

export interface ExplanationStep {
  readonly title: string
  readonly formula: string
  readonly detail: string
  readonly tone: StepTone
}

export interface Explanation {
  readonly allowed: boolean
  readonly steps: readonly ExplanationStep[]
}

export interface AlgorithmInsight<TView> {
  view(state: unknown, now: number): TView
  explain(record: RequestRecord): Explanation
}

export const infoStep = (title: string, formula: string, detail: string): ExplanationStep => ({
  title,
  formula,
  detail,
  tone: 'info',
})

export const verdictStep = (title: string, formula: string, detail: string, allowed: boolean): ExplanationStep => ({
  title,
  formula,
  detail,
  tone: allowed ? 'allowed' : 'denied',
})
