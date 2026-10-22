import type { ReactElement } from 'react'
import { formatNumber, formatSeconds } from '../lab/format'
import { LIMIT_RANGE, type LabPolicy, WINDOW_RANGE_MS } from '../lab/lab-policy'
import { BoltIcon, PauseIcon, PlayIcon, ResetIcon } from './icons'
import { RangeControl } from './range-control'

const SPEEDS: readonly number[] = [0.5, 1, 2, 4]
const MAX_TRAFFIC_RATE = 6
const MS_PER_SECOND = 1_000

interface ControlPanelProps {
  readonly now: number
  readonly playing: boolean
  readonly speed: number
  readonly rate: number
  readonly policy: LabPolicy
  readonly onTogglePlay: () => void
  readonly onSpeedChange: (speed: number) => void
  readonly onRateChange: (rate: number) => void
  readonly onSend: () => void
  readonly onPolicyChange: (policy: LabPolicy) => void
  readonly onReset: () => void
}

export function ControlPanel(props: ControlPanelProps): ReactElement {
  return (
    <div className="control-panel">
      <TransportControls {...props} />
      <div className="control-panel__ranges">
        <RangeControl
          label="Traffic"
          value={props.rate}
          min={0}
          max={MAX_TRAFFIC_RATE}
          step={0.5}
          display={props.rate === 0 ? 'off' : `${formatNumber(props.rate)}/s`}
          onChange={props.onRateChange}
        />
        <PolicyControls policy={props.policy} onPolicyChange={props.onPolicyChange} />
      </div>
    </div>
  )
}

function TransportControls({ now, playing, speed, onTogglePlay, onSpeedChange, onSend, onReset }: ControlPanelProps): ReactElement {
  return (
    <div className="control-panel__transport">
      <button className="icon-button" type="button" onClick={onTogglePlay} aria-label={playing ? 'Pause time' : 'Play time'}>
        {playing ? <PauseIcon /> : <PlayIcon />}
      </button>
      <div className="segmented" role="radiogroup" aria-label="Simulation speed">
        {SPEEDS.map((option) => (
          <button
            key={option}
            type="button"
            role="radio"
            aria-checked={option === speed}
            className="segmented__option"
            onClick={() => onSpeedChange(option)}
          >
            {option}×
          </button>
        ))}
      </div>
      <div className="sim-clock" aria-live="off">
        <span className="sim-clock__label">time</span>
        <span className="sim-clock__value">{formatSeconds(now)}</span>
      </div>
      <button className="pill-button pill-button--primary" type="button" onClick={onSend}>
        <BoltIcon />
        Send request
      </button>
      <button className="pill-button pill-button--ghost" type="button" onClick={onReset}>
        <ResetIcon />
        Reset
      </button>
    </div>
  )
}

interface PolicyControlsProps {
  readonly policy: LabPolicy
  readonly onPolicyChange: (policy: LabPolicy) => void
}

function PolicyControls({ policy, onPolicyChange }: PolicyControlsProps): ReactElement {
  return (
    <>
      <RangeControl
        label="Limit"
        value={policy.limit}
        min={LIMIT_RANGE.min}
        max={LIMIT_RANGE.max}
        step={1}
        display={`${policy.limit} requests`}
        onChange={(limit) => onPolicyChange({ ...policy, limit })}
      />
      <RangeControl
        label="Window"
        value={policy.windowMs / MS_PER_SECOND}
        min={WINDOW_RANGE_MS.min / MS_PER_SECOND}
        max={WINDOW_RANGE_MS.max / MS_PER_SECOND}
        step={1}
        display={formatSeconds(policy.windowMs)}
        onChange={(seconds) => onPolicyChange({ ...policy, windowMs: seconds * MS_PER_SECOND })}
      />
    </>
  )
}
