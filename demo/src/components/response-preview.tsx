import type { ReactElement } from 'react'
import { RateLimitHeaders } from '../../../src/plugin/rate-limit-headers'
import type { RequestRecord } from '../lab/request-record'

interface ResponsePreviewProps {
  readonly record: RequestRecord | undefined
  readonly windowMs: number
}

export function ResponsePreview({ record, windowMs }: ResponsePreviewProps): ReactElement | null {
  if (record === undefined) return null
  const { decision } = record.evaluation
  const headers = Object.entries(RateLimitHeaders.from(decision, windowMs, record.at))
  return (
    <div className={decision.allowed ? 'response response--allowed' : 'response response--denied'}>
      <p className="response__status">
        <span className="response__code">{decision.allowed ? '200' : '429'}</span>
        {decision.allowed ? 'OK' : 'Too Many Requests'}
      </p>
      <dl className="response__headers">
        {headers.map(([name, value]) => (
          <div key={name} className="response__header">
            <dt>{name}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
    </div>
  )
}
