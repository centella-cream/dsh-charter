import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { charterRecordSchema } from '../../src/core/schemas.js'

interface LegacyFixture {
  readonly schemaVersion: number
  readonly record: unknown
}

function load(version: string): LegacyFixture {
  return JSON.parse(readFileSync(new URL(`../fixtures/record-${version}.json`, import.meta.url), 'utf8')) as LegacyFixture
}

describe('0.3.2 / 0.3.3 record downgrade compatibility', () => {
  for (const version of ['0.3.2', '0.3.3'] as const) {
    it(`reads an actual ${version}-produced v2 record without migration`, () => {
      const fixture = load(version)
      expect(fixture.schemaVersion).toBe(2)
      const parsed = charterRecordSchema.safeParse(fixture.record)
      expect(parsed.success).toBe(true)
      if (!parsed.success) return
      // Strict parsing must be lossless for the frozen old-version bytes.
      expect(JSON.parse(JSON.stringify(parsed.data))).toEqual(fixture.record)
      expect(parsed.data.recordSchemaVersion).toBe(2)
      expect(parsed.data.current.items).toHaveLength(2)
    })
  }
})
