import type { AlgorithmName } from '../algorithms/algorithm'

export class KeyBuilder {
  constructor(
    private readonly prefix: string,
    private readonly algorithm: AlgorithmName,
  ) {}

  build(identifier: string): string {
    const digest = Bun.CryptoHasher.hash('sha256', identifier, 'hex')
    return `${this.prefix}:${this.algorithm}:${digest}`
  }
}
