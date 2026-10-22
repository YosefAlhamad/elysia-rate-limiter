import { type ReactElement, useId } from 'react'
import { formatNumber, formatSeconds } from '../lab/format'
import type { TokenBucketView } from '../lab/insights/token-bucket-insight'

const BUCKET_PATH = 'M66 64 L214 64 L198 170 Q196 178 188 178 L92 178 Q84 178 82 170 Z'
const TAP_PATH = 'M112 14 h56 a6 6 0 0 1 6 6 v4 a6 6 0 0 1 -6 6 h-20 v10 h-16 v-10 h-20 a6 6 0 0 1 -6 -6 v-4 a6 6 0 0 1 6 -6z'
const WAVE_PATH = 'M0 64 Q35 57 70 64 T140 64 T210 64 T280 64 T350 64 T420 64 V200 H0 Z'
const LIQUID_DEPTH = 114
const MIN_DRIP_MS = 220

interface TokenBucketVisualProps {
  readonly view: TokenBucketView
  readonly playing: boolean
  readonly speed: number
}

export function TokenBucketVisual({ view, playing, speed }: TokenBucketVisualProps): ReactElement {
  const { tokens, limit, msPerToken, msUntilFull } = view
  const ids = useId().replace(/:/g, '')
  const full = tokens >= limit
  const dripMs = Math.max(MIN_DRIP_MS, msPerToken / speed)
  return (
    <div className="tb">
      <svg className="tb__chart" viewBox="0 0 280 190" role="img" aria-label={`${formatNumber(tokens, 1)} of ${limit} tokens`}>
        <defs>
          <clipPath id={`${ids}-bucket`}>
            <path d={BUCKET_PATH} />
          </clipPath>
          <linearGradient id={`${ids}-liquid`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#ecda98" />
            <stop offset="0.55" stopColor="#ff9473" />
            <stop offset="1" stopColor="#f37a0a" />
          </linearGradient>
        </defs>
        <path className="tb__tap" d={TAP_PATH} />
        <circle
          className={full ? 'tb__drop tb__drop--idle' : 'tb__drop'}
          cx={140}
          cy={46}
          r={4.5}
          style={{ animationDuration: `${dripMs}ms`, animationPlayState: playing && !full ? 'running' : 'paused' }}
        />
        <g clipPath={`url(#${ids}-bucket)`}>
          <g className="tb__liquid" style={{ transform: `translateY(${(1 - tokens / limit) * LIQUID_DEPTH}px)` }}>
            <path className="tb__wave" d={WAVE_PATH} fill={`url(#${ids}-liquid)`} />
          </g>
        </g>
        <path className="tb__bucket" d={BUCKET_PATH} />
        <text className="tb__value" x={140} y={130} textAnchor="middle">
          {formatNumber(tokens, 1)}
        </text>
        <text className="tb__unit" x={140} y={150} textAnchor="middle">
          of {limit} tokens
        </text>
      </svg>
      <div className="tb__coins" aria-hidden="true">
        {Array.from({ length: limit }, (_, index) => (
          <span key={index} className="coin">
            <span className="coin__fill" style={{ transform: `scaleY(${Math.min(1, Math.max(0, tokens - index))})` }} />
          </span>
        ))}
      </div>
      <p className="visual-caption">
        <strong className="text-primary">+1 token</strong> every {formatSeconds(msPerToken)} ·{' '}
        {full ? 'the bucket is full' : `full in ${formatSeconds(msUntilFull)}`}
      </p>
    </div>
  )
}
