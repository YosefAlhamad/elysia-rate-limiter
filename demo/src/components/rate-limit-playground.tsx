import { type ReactElement, type ReactNode, useMemo, useState } from 'react'
import type { AlgorithmName } from '../../../src/algorithms/algorithm'
import type { Explanation } from '../lab/insights/explanation'
import type { LabPolicy } from '../lab/lab-policy'
import type { LabSnapshot, LaneSnapshot } from '../lab/rate-limit-lab'
import type { RequestRecord } from '../lab/request-record'
import { SCENARIOS, type Scenario } from '../lab/traffic/scenarios'
import { AlgorithmCard } from './algorithm-card'
import { ControlPanel } from './control-panel'
import { FixedWindowVisual } from './fixed-window-visual'
import { type InsightSet, createInsightSet } from './insight-set'
import { ScenarioPicker } from './scenario-picker'
import { SlidingWindowVisual } from './sliding-window-visual'
import { TokenBucketVisual } from './token-bucket-visual'
import { useBackgroundTraffic, useLab, useLabSnapshot, useSimulatedTime } from './use-lab'

const DEFAULT_POLICY = { limit: 5, windowMs: 6_000 } as const
const DEFAULT_RATE = 1

interface CardDefinition {
  readonly name: AlgorithmName
  readonly title: string
  readonly tagline: string
  readonly explain: (record: RequestRecord) => Explanation
  readonly visual: (lane: LaneSnapshot) => ReactNode
}

interface VisualContext {
  readonly snapshot: LabSnapshot
  readonly insights: InsightSet
  readonly playing: boolean
  readonly speed: number
}

const cardDefinitions = ({ snapshot, insights, playing, speed }: VisualContext): readonly CardDefinition[] => [
  {
    name: 'fixed-window',
    title: 'Fixed window',
    tagline: 'One counter per clock-aligned window.',
    explain: (record) => insights.fixedWindow.explain(record),
    visual: (lane) => <FixedWindowVisual view={insights.fixedWindow.view(lane.state, snapshot.now)} />,
  },
  {
    name: 'sliding-window',
    title: 'Sliding window',
    tagline: 'Weighs the previous window into a rolling estimate.',
    explain: (record) => insights.slidingWindow.explain(record),
    visual: (lane) => (
      <SlidingWindowVisual view={insights.slidingWindow.view(lane.state, snapshot.now)} windowMs={snapshot.policy.windowMs} />
    ),
  },
  {
    name: 'token-bucket',
    title: 'Token bucket',
    tagline: 'Tokens drip in steadily, and each request spends one.',
    explain: (record) => insights.tokenBucket.explain(record),
    visual: (lane) => (
      <TokenBucketVisual view={insights.tokenBucket.view(lane.state, snapshot.now)} playing={playing} speed={speed} />
    ),
  },
]

const selectRecord = (lane: LaneSnapshot, pinnedId: number | undefined): RequestRecord | undefined =>
  pinnedId === undefined ? lane.latest : (lane.requests.find((record) => record.id === pinnedId) ?? lane.latest)

export function RateLimitPlayground(): ReactElement {
  const lab = useLab(DEFAULT_POLICY)
  const snapshot = useLabSnapshot(lab)
  const [playing, setPlaying] = useState(true)
  const [speed, setSpeed] = useState(1)
  const [rate, setRate] = useState(DEFAULT_RATE)
  const [pinnedId, setPinnedId] = useState<number | undefined>(undefined)
  useSimulatedTime(lab, playing, speed)
  useBackgroundTraffic(lab, rate)
  const insights = useMemo(() => createInsightSet(snapshot.policy), [snapshot.policy])

  const startScenario = (scenario: Scenario): void => {
    lab.schedule(scenario.arrivals(snapshot.now, snapshot.policy))
    setPlaying(true)
  }
  const changePolicy = (policy: LabPolicy): void => {
    lab.configure(policy)
    setPinnedId(undefined)
  }
  const reset = (): void => {
    lab.reset()
    setPinnedId(undefined)
  }

  return (
    <div className="playground">
      <ControlPanel
        now={snapshot.now}
        playing={playing}
        speed={speed}
        rate={rate}
        policy={snapshot.policy}
        onTogglePlay={() => setPlaying((value) => !value)}
        onSpeedChange={setSpeed}
        onRateChange={setRate}
        onSend={() => lab.send()}
        onPolicyChange={changePolicy}
        onReset={reset}
      />
      <ScenarioPicker scenarios={SCENARIOS} pendingArrivals={snapshot.pendingArrivals} onStart={startScenario} />
      <InspectBar pinnedId={pinnedId} onFollow={() => setPinnedId(undefined)} />
      <div className="lanes">
        {cardDefinitions({ snapshot, insights, playing, speed }).map((definition, index) => {
          const lane = snapshot.lanes[definition.name]
          const record = selectRecord(lane, pinnedId)
          return (
            <AlgorithmCard
              key={definition.name}
              position={index + 1}
              title={definition.title}
              tagline={definition.tagline}
              lane={lane}
              now={snapshot.now}
              windowMs={snapshot.policy.windowMs}
              record={record}
              explanation={record === undefined ? undefined : definition.explain(record)}
              selectedId={record?.id}
              onSelect={setPinnedId}
            >
              {definition.visual(lane)}
            </AlgorithmCard>
          )
        })}
      </div>
    </div>
  )
}

interface InspectBarProps {
  readonly pinnedId: number | undefined
  readonly onFollow: () => void
}

function InspectBar({ pinnedId, onFollow }: InspectBarProps): ReactElement {
  return (
    <div className="inspect-bar" aria-live="polite">
      <span className={pinnedId === undefined ? 'inspect-bar__dot inspect-bar__dot--live' : 'inspect-bar__dot'} />
      {pinnedId === undefined ? (
        <span>Following the latest request. Click any dot to pin it and compare the three verdicts.</span>
      ) : (
        <>
          <span>
            Pinned on <strong>request #{pinnedId}</strong> in all three algorithms.
          </span>
          <button className="link-button" type="button" onClick={onFollow}>
            Follow latest
          </button>
        </>
      )}
    </div>
  )
}
