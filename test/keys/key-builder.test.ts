import { describe, expect, test } from 'bun:test'
import { KeyBuilder } from '../../src/keys/key-builder'

const SHA256_HEX = /^[0-9a-f]{64}$/

describe('KeyBuilder', () => {
  test('builds prefix:algorithm:sha256 in lowercase hex', () => {
    const key = new KeyBuilder('api', 'token-bucket').build('user-1')
    const expected = new Bun.CryptoHasher('sha256').update('user-1').digest('hex')
    expect(key).toBe(`api:token-bucket:${expected}`)
  })

  test('gives every key the same shape no matter the identifier', () => {
    for (const identifier of ['', 'a', 'x'.repeat(10_000), '203.0.113.7', 'ユーザー']) {
      const [prefix, algorithm, digest, ...rest] = new KeyBuilder('rate-limit', 'sliding-window').build(identifier).split(':')
      expect([prefix, algorithm, rest]).toEqual(['rate-limit', 'sliding-window', []])
      expect(digest).toMatch(SHA256_HEX)
    }
  })

  test('identifiers containing ":" cannot collide with other keys', () => {
    const builder = new KeyBuilder('rate-limit', 'fixed-window')
    const identifiers = ['a:b', 'a', 'b', 'a:b:c', 'fixed-window:a', 'rate-limit:fixed-window:a', ':', '']
    const keys = identifiers.map((identifier) => builder.build(identifier))
    expect(new Set(keys).size).toBe(identifiers.length)
    expect(new KeyBuilder('a', 'fixed-window').build('b:c')).not.toBe(new KeyBuilder('a:b', 'fixed-window').build('c'))
  })

  test('separates keys by prefix and algorithm', () => {
    const keys = [
      new KeyBuilder('one', 'fixed-window').build('id'),
      new KeyBuilder('two', 'fixed-window').build('id'),
      new KeyBuilder('one', 'token-bucket').build('id'),
    ]
    expect(new Set(keys).size).toBe(3)
  })

  test('never contains the raw identifier', () => {
    expect(new KeyBuilder('rate-limit', 'sliding-window').build('203.0.113.7')).not.toContain('203.0.113.7')
  })
})
