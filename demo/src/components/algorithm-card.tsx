import type { ReactElement, ReactNode } from 'react'
import { formatSeconds } from '../lab/format'
import type { Explanation } from '../lab/insights/explanation'
import type { LaneSnapshot } from '../lab/rate-limit-lab'
import type { RequestRecord } from '../lab/request-record'
import { ExplanationPanel } from './explanation-panel'
import { RequestLane } from './request-lane'
import { ResponsePreview } from './response-preview'

interface AlgorithmCardProps {
  readonly position: number
  readonly title: string
  readonly tagline: string
  readonly lane: LaneSnapshot
  readonly now: number
  readonly windowMs: number
  readonly record: RequestRecord | undefined
  readonly explanation: Explanation | undefined
  readonly selectedId: number | undefined
  readonly onSelect: (id: number) => void
  readonly children: ReactNode
}

export function AlgorithmCard(props: AlgorithmCardProps): ReactElement {
  const { lane, now, windowMs, record, explanation, selectedId, onSelect, children } = props
  return (
    <article className="algo-card">
      <CardFlash latest={lane.latest} />
      <header className="algo-card__header">
        <span className="node-tag">
          <span className="node-tag__index">0{props.position}</span>
          {lane.name}
        </span>
        <div className="algo-card__heading">
          <h3 className="algo-card__title">{props.title}</h3>
          <p className="algo-card__tagline">{props.tagline}</p>
        </div>
      </header>
      <div className={`algo-card__visual algo-card__visual--${lane.name}`}>
        <span className="algo-card__wash" aria-hidden="true" />
        {children}
      </div>
      <LaneStats lane={lane} />
      <RequestLane requests={lane.requests} now={now} windowMs={windowMs} selectedId={selectedId} onSelect={onSelect} />
      <ExplanationPanel record={record} explanation={explanation} />
      <ResponsePreview record={record} windowMs={windowMs} />
    </article>
  )
}

function CardFlash({ latest }: { readonly latest: RequestRecord | undefined }): ReactElement | null {
  if (latest === undefined) return null
  const tone = latest.evaluation.decision.allowed ? 'allowed' : 'denied'
  return <span key={latest.id} className={`algo-card__flash algo-card__flash--${tone}`} aria-hidden="true" />
}

function LaneStats({ lane }: { readonly lane: LaneSnapshot }): ReactElement {
  const { totals, preview } = lane
  return (
    <dl className="stats">
      <div className="stats__item stats__item--allowed">
        <dt>Allowed</dt>
        <dd>{totals.allowed}</dd>
      </div>
      <div className="stats__item stats__item--denied">
        <dt>Rejected</dt>
        <dd>{totals.denied}</dd>
      </div>
      <div className="stats__item">
        <dt>Room</dt>
        <dd>
          {preview.remaining + (preview.allowed ? 1 : 0)}
          <small>/{preview.limit}</small>
        </dd>
      </div>
      <div className="stats__item">
        <dt>Next</dt>
        <dd>{preview.allowed ? 'now' : `in ${formatSeconds(preview.retryAfterMs)}`}</dd>
      </div>
    </dl>
  )
}
