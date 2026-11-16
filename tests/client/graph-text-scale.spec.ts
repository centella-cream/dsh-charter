import { describe, expect, it } from 'vitest'
import { graphTextScale } from '../../src/client/DependencyGraph.js'

describe('graph root-text scaling', () => {
  it('keeps the px canvas at the default root size and caps at 200%', () => {
    expect(graphTextScale(16)).toBe(1)
    expect(graphTextScale(20)).toBe(1.25)
    expect(graphTextScale(24)).toBe(1.5)
    expect(graphTextScale(32)).toBe(2)
    expect(graphTextScale(40)).toBe(2)
    expect(graphTextScale(Number.NaN)).toBe(1)
  })
})
