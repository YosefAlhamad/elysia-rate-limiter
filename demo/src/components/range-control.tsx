import type { ReactElement } from 'react'

interface RangeControlProps {
  readonly label: string
  readonly value: number
  readonly min: number
  readonly max: number
  readonly step: number
  readonly display: string
  readonly onChange: (value: number) => void
}

export function RangeControl({ label, value, min, max, step, display, onChange }: RangeControlProps): ReactElement {
  const progress = ((value - min) / (max - min)) * 100
  return (
    <label className="range">
      <span className="range__header">
        <span className="range__label">{label}</span>
        <output className="range__value">{display}</output>
      </span>
      <input
        className="range__input"
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        style={{ backgroundSize: `${progress}% 100%` }}
        onChange={(event) => onChange(Number(event.currentTarget.value))}
      />
    </label>
  )
}
