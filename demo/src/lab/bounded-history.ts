export class BoundedHistory<T extends object> {
  private readonly slots: (T | undefined)[]
  private start = 0
  private count = 0

  constructor(private readonly capacity: number) {
    if (!Number.isInteger(capacity) || capacity < 1) throw new RangeError('History capacity must be a whole number of at least 1')
    this.slots = Array.from({ length: capacity }, () => undefined)
  }

  get size(): number {
    return this.count
  }

  push(item: T): void {
    this.slots[this.slotAt(this.count)] = item
    if (this.count < this.capacity) this.count += 1
    else this.start = this.slotAt(1)
  }

  pop(): T | undefined {
    if (this.count === 0) return undefined
    const index = this.slotAt(this.count - 1)
    const item = this.slots[index]
    this.slots[index] = undefined
    this.count -= 1
    return item
  }

  latest(): T | undefined {
    return this.count === 0 ? undefined : this.slots[this.slotAt(this.count - 1)]
  }

  toArray(): readonly T[] {
    return Array.from({ length: this.count }, (_, offset) => this.slots[this.slotAt(offset)]).filter(
      (item): item is T => item !== undefined,
    )
  }

  clear(): void {
    this.slots.fill(undefined)
    this.start = 0
    this.count = 0
  }

  private slotAt(offset: number): number {
    return (this.start + offset) % this.capacity
  }
}
