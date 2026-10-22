const MODULUS = 2_147_483_648

export class SeededRandom {
  constructor(private seed: number) {}

  next(): number {
    this.seed = (this.seed * 1_103_515_245 + 12_345) % MODULUS
    return this.seed / MODULUS
  }
}
