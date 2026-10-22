import { type ReactElement, useId } from 'react'
import { formatNumber, formatPercent } from '../lab/format'
import type { SlidingWindowView } from '../lab/insights/sliding-window-insight'

const LEFT = 24
const BLOCK = 150
const BASE = 128
const BAR_MAX = 84
const TOP = BASE - BAR_MAX
const BAR_INSET = 8

interface SlidingWindowVisualProps {
  readonly view: SlidingWindowView
  readonly windowMs: number
}

export function SlidingWindowVisual({ view, windowMs }: SlidingWindowVisualProps): ReactElement {
  const { previous, current, weight, estimate, limit } = view
  const ids = useId().replace(/:/g, '')
  const frameX = LEFT + (view.elapsed / windowMs) * BLOCK
  const middle = LEFT + BLOCK
  const nowX = frameX + BLOCK
  const ratio = (count: number): number => Math.min(1, count / limit)
  const full = estimate + 1 > limit
  return (
    <div className="sw">
      <svg className="sw__chart" viewBox="0 0 348 160" role="img" aria-label={`Previous window ${previous}, current window ${current}`}>
        <defs>
          <clipPath id={`${ids}-overlap`}>
            <rect x={frameX} y={0} width={Math.max(0, middle - frameX)} height={160} />
          </clipPath>
          <clipPath id={`${ids}-elapsed`}>
            <rect x={middle} y={0} width={Math.max(0, nowX - middle)} height={160} />
          </clipPath>
        </defs>
        <rect className="sw__block" x={LEFT} y={TOP - 8} width={BLOCK} height={BAR_MAX + 8} rx={10} />
        <rect className="sw__block" x={middle} y={TOP - 8} width={BLOCK} height={BAR_MAX + 8} rx={10} />
        <Bar x={LEFT} ratio={ratio(previous)} className="sw__bar sw__bar--ghost" />
        <g clipPath={`url(#${ids}-overlap)`}>
          <Bar x={LEFT} ratio={ratio(previous)} className="sw__bar sw__bar--previous" />
        </g>
        <g clipPath={`url(#${ids}-elapsed)`}>
          <Bar x={middle} ratio={ratio(current)} className="sw__bar sw__bar--current" />
        </g>
        <line className="sw__limit" x1={LEFT} x2={LEFT + 2 * BLOCK} y1={TOP} y2={TOP} />
        <text className="sw__limit-label" x={LEFT + 2 * BLOCK} y={TOP - 12} textAnchor="end">
          limit {limit}
        </text>
        <rect className="sw__frame" x={frameX} y={TOP - 14} width={BLOCK} height={BAR_MAX + 22} rx={10} />
        <text className="sw__frame-label" x={frameX + BLOCK / 2} y={TOP - 20} textAnchor="middle">
          rolling window
        </text>
        <line className="sw__now" x1={nowX} x2={nowX} y1={TOP - 14} y2={BASE + 8} />
        <text className="sw__axis" x={LEFT + BLOCK / 2} y={BASE + 24} textAnchor="middle">
          previous · {previous}
        </text>
        <text className="sw__axis" x={middle + BLOCK / 2} y={BASE + 24} textAnchor="middle">
          current · {current}
        </text>
      </svg>
      <p className="sw__formula">
        <span className="chip">{previous}</span>×<span className="chip chip--primary">{formatPercent(weight)}</span>+
        <span className="chip">{current}</span>=<strong className={full ? 'text-denied' : 'text-primary'}>{formatNumber(estimate)}</strong>
        <span className="sw__formula-limit">of {limit}</span>
      </p>
      <div className="meter" aria-hidden="true">
        <span className={full ? 'meter__fill meter__fill--full' : 'meter__fill'} style={{ transform: `scaleX(${Math.min(1, estimate / limit)})` }} />
      </div>
    </div>
  )
}

function Bar({ x, ratio, className }: { readonly x: number; readonly ratio: number; readonly className: string }): ReactElement {
  return (
    <rect
      className={className}
      x={x + BAR_INSET}
      y={TOP}
      width={BLOCK - BAR_INSET * 2}
      height={BAR_MAX}
      rx={6}
      style={{ transform: `scaleY(${ratio})` }}
    />
  )
}
