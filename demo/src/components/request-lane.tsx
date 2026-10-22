import type { ReactElement } from 'react'
import { formatSeconds } from '../lab/format'
import type { RequestRecord } from '../lab/request-record'

interface RequestLaneProps {
  readonly requests: readonly RequestRecord[]
  readonly now: number
  readonly windowMs: number
  readonly selectedId: number | undefined
  readonly onSelect: (id: number) => void
}

const WINDOWS_SHOWN = 2

const boundariesBetween = (from: number, to: number, windowMs: number): readonly number[] => {
  const first = Math.max(0, Math.ceil(from / windowMs))
  const last = Math.floor(to / windowMs)
  return Array.from({ length: Math.max(0, last - first + 1) }, (_, index) => (first + index) * windowMs)
}

export function RequestLane({ requests, now, windowMs, selectedId, onSelect }: RequestLaneProps): ReactElement {
  const span = windowMs * WINDOWS_SHOWN
  const position = (at: number): string => `${(1 - (now - at) / span) * 100}%`
  const visible = requests.filter((record) => now - record.at <= span)
  return (
    <div className="lane">
      <div className="lane__track">
        {boundariesBetween(now - span, now, windowMs).map((at) => (
          <span key={at} className="lane__boundary" style={{ left: position(at) }} />
        ))}
        {visible.map((record) => (
          <LaneDot key={record.id} record={record} left={position(record.at)} selected={record.id === selectedId} onSelect={onSelect} />
        ))}
      </div>
      <div className="lane__axis">
        <span>−{formatSeconds(span)}</span>
        <span>window boundaries are dashed</span>
        <span>now</span>
      </div>
    </div>
  )
}

interface LaneDotProps {
  readonly record: RequestRecord
  readonly left: string
  readonly selected: boolean
  readonly onSelect: (id: number) => void
}

function LaneDot({ record, left, selected, onSelect }: LaneDotProps): ReactElement {
  const allowed = record.evaluation.decision.allowed
  const classes = ['lane__dot', allowed ? 'lane__dot--allowed' : 'lane__dot--denied', selected ? 'lane__dot--selected' : '']
  return (
    <button
      type="button"
      className={classes.join(' ')}
      style={{ left }}
      onClick={() => onSelect(record.id)}
      aria-label={`Request ${record.id} at ${formatSeconds(record.at)}: ${allowed ? 'allowed' : 'rejected'}`}
    />
  )
}
