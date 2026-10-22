export interface TrafficSource {
  arrivalsBetween(fromMs: number, toMs: number): readonly number[]
}
