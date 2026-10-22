import type { ReactElement } from 'react'
import { formatSeconds } from '../lab/format'
import type { Explanation } from '../lab/insights/explanation'
import type { RequestRecord } from '../lab/request-record'

interface ExplanationPanelProps {
  readonly record: RequestRecord | undefined
  readonly explanation: Explanation | undefined
}

const STEP_STAGGER_MS = 45

export function ExplanationPanel({ record, explanation }: ExplanationPanelProps): ReactElement {
  return (
    <section className="explain">
      <header className="explain__header">
        <h4 className="explain__title">Step by step</h4>
        {record !== undefined && (
          <span className="explain__meta">
            request #{record.id} at {formatSeconds(record.at)}
          </span>
        )}
      </header>
      {record === undefined || explanation === undefined ? (
        <p className="explain__empty">Send a request to watch this algorithm decide.</p>
      ) : (
        <ol key={record.id} className="explain__steps">
          {explanation.steps.map((step, index) => (
            <li key={step.title} className={`step step--${step.tone}`} style={{ animationDelay: `${index * STEP_STAGGER_MS}ms` }}>
              <span className="step__number">{index + 1}</span>
              <div className="step__body">
                <p className="step__title">{step.title}</p>
                <code className="step__formula">{step.formula}</code>
                <p className="step__detail">{step.detail}</p>
              </div>
            </li>
          ))}
        </ol>
      )}
    </section>
  )
}
