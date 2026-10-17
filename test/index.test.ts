import { expect, test } from 'bun:test'

test('package entry loads', async () => {
  const entry = await import('../src/index')
  expect(entry).toBeDefined()
})
