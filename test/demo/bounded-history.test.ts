import { describe, expect, test } from 'bun:test'
import { BoundedHistory } from '../../demo/src/lab/bounded-history'

interface Item {
  readonly id: number
}

const filled = (capacity: number, count: number): BoundedHistory<Item> => {
  const history = new BoundedHistory<Item>(capacity)
  for (let id = 1; id <= count; id += 1) history.push({ id })
  return history
}

const ids = (history: BoundedHistory<Item>): number[] => history.toArray().map((item) => item.id)

describe('BoundedHistory', () => {
  test('rejects a capacity that is not a whole number of at least 1', () => {
    expect(() => new BoundedHistory<Item>(0)).toThrow(RangeError)
    expect(() => new BoundedHistory<Item>(1.5)).toThrow(RangeError)
  })

  test('keeps items in insertion order while under capacity', () => {
    const history = filled(5, 3)
    expect(history.size).toBe(3)
    expect(ids(history)).toEqual([1, 2, 3])
    expect(history.latest()).toEqual({ id: 3 })
  })

  test('drops the oldest items once full', () => {
    const history = filled(3, 7)
    expect(history.size).toBe(3)
    expect(ids(history)).toEqual([5, 6, 7])
  })

  test('pops the newest item, even after wrapping', () => {
    const history = filled(3, 5)
    expect(history.pop()).toEqual({ id: 5 })
    expect(history.pop()).toEqual({ id: 4 })
    expect(ids(history)).toEqual([3])
    history.push({ id: 8 })
    expect(ids(history)).toEqual([3, 8])
  })

  test('returns undefined when empty', () => {
    const history = filled(2, 1)
    history.pop()
    expect(history.pop()).toBeUndefined()
    expect(history.latest()).toBeUndefined()
    expect(history.toArray()).toEqual([])
  })

  test('clear empties the history and starts over', () => {
    const history = filled(3, 5)
    history.clear()
    expect(history.size).toBe(0)
    history.push({ id: 9 })
    expect(ids(history)).toEqual([9])
  })
})
