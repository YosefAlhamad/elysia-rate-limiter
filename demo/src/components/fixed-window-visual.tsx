import type { ReactElement } from 'react'
import { formatSeconds } from '../lab/format'
import type { FixedWindowView } from '../lab/insights/fixed-window-insight'

const MAX_COLUMNS = 10
const DRAIN_STAGGER_MS = 25

export function FixedWindowVisual({ view }: { readonly view: FixedWindowView }): ReactElement {
  const { windowStart, windowEnd, count, limit, progress, msUntilReset } = view
  const columns = limit <= MAX_COLUMNS ? limit : Math.ceil(limit / 2)
  return (
    <div className="fw">
      <div className="visual-meta">
        <span>
          window <strong>{formatSeconds(windowStart)}</strong> → <strong>{formatSeconds(windowEnd)}</strong>
        </span>
        <span className="visual-meta__accent">resets in {formatSeconds(msUntilReset)}</span>
      </div>
      <div className="fw__progress" aria-hidden="true">
        <span className="fw__progress-fill" style={{ transform: `scaleX(${progress})` }} />
      </div>
      <div className="fw__slots" style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}>
        {Array.from({ length: limit }, (_, index) => (
          <span
            key={index}
            className={index < count ? 'fw__slot fw__slot--filled' : 'fw__slot'}
            style={{ transitionDelay: index < count ? '0ms' : `${index * DRAIN_STAGGER_MS}ms` }}
          />
        ))}
      </div>
      <p className="visual-caption">
        <strong className={count >= limit ? 'text-denied' : 'text-primary'}>{count}</strong> of {limit} slots used in this
        window. They all empty at the boundary.
      </p>
    </div>
  )
}
