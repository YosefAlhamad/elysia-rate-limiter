export class TimeAccumulator {
  private remainder = 0

  take(ms: number): number {
    if (!Number.isFinite(ms) || ms < 0) return 0
    const total = this.remainder + ms
    const whole = Math.floor(total)
    this.remainder = total - whole
    return whole
  }
}
