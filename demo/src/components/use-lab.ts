import { useEffect, useState, useSyncExternalStore } from 'react'
import type { LabPolicyInput } from '../lab/lab-policy'
import { type LabSnapshot, RateLimitLab } from '../lab/rate-limit-lab'
import { TimeAccumulator } from '../lab/time-accumulator'
import { SeededRandom } from '../lab/traffic/seeded-random'
import { SteadyTraffic } from '../lab/traffic/steady-traffic'

const MAX_FRAME_MS = 100
const TRAFFIC_SEED = 42

export const useLab = (policy: LabPolicyInput): RateLimitLab => {
  const [lab] = useState(() => new RateLimitLab({ policy }))
  return lab
}

export const useLabSnapshot = (lab: RateLimitLab): LabSnapshot =>
  useSyncExternalStore(lab.subscribe, lab.snapshot, lab.snapshot)

export const useSimulatedTime = (lab: RateLimitLab, playing: boolean, speed: number): void => {
  useEffect(() => {
    if (!playing) return undefined
    const accumulator = new TimeAccumulator()
    let last = performance.now()
    let frame = 0
    const tick = (time: number): void => {
      const elapsed = Math.min(MAX_FRAME_MS, Math.max(0, time - last))
      last = time
      const ms = accumulator.take(elapsed * speed)
      if (ms > 0) lab.advance(ms)
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [lab, playing, speed])
}

export const useBackgroundTraffic = (lab: RateLimitLab, ratePerSecond: number): void => {
  useEffect(() => {
    lab.setTraffic(ratePerSecond > 0 ? new SteadyTraffic(ratePerSecond, new SeededRandom(TRAFFIC_SEED)) : undefined)
  }, [lab, ratePerSecond])
}
