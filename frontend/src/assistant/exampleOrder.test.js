import { describe, it, expect } from 'vitest'
import { shuffledOrder, EXAMPLES } from './AssistantPanel'

describe('the landing examples start in a random order', () => {
  it('is a permutation of every example', () => {
    const o = shuffledOrder(EXAMPLES.length)
    expect([...o].sort((a, b) => a - b)).toEqual(EXAMPLES.map((_, i) => i))
  })
  it('follows the random source, so different loads start on different examples', () => {
    const first = (r) => shuffledOrder(EXAMPLES.length, () => r)[0]
    expect(first(0)).not.toBe(first(0.999))
    const seen = new Set(Array.from({ length: 200 }, () => shuffledOrder(EXAMPLES.length)[0]))
    expect(seen.size).toBe(EXAMPLES.length)
  })
})
