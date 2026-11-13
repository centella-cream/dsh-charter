import { describe, expect, it } from 'vitest'
import { compareTrafficReports, formatTrafficDiff } from '../../scripts/verify/traffic-diff.mjs'

describe('traffic baseline diff', () => {
  it('separates charter-read growth from duplicate-injection growth', () => {
    const before = {
      modelAttempts: { total: 10, usage: { uncachedInputTokens: 1000, outputTokens: 200 } },
      runtime: { activeSurface: { snapshots: 2 }, activeSurfacePayloadBytes: 1000, duplicateRate: 0.1, activeCharterPayloadBytes: 200, charterDuplicateBytes: 20 },
      charterRead: { calls: 1, resultBytes: 100 },
      charterPropose: { calls: 0, rejected: 0, displayKeyRejects: 0, unknownIdRejects: 0 },
    }
    const after = {
      modelAttempts: { total: 10, usage: { uncachedInputTokens: 1100, outputTokens: 220 } },
      runtime: { activeSurface: { snapshots: 2 }, activeSurfacePayloadBytes: 1300, duplicateRate: 0.2, activeCharterPayloadBytes: 300, charterDuplicateBytes: 50 },
      charterRead: { calls: 3, resultBytes: 900 },
      charterPropose: { calls: 2, rejected: 1, displayKeyRejects: 1, unknownIdRejects: 0 },
    }
    const rows = compareTrafficReports(before, after)
    const read = rows.find(row => row.metric === 'charterRead.calls')!
    const duplicate = rows.find(row => row.metric === 'runtime.duplicateRate')!
    expect(read.delta).toBe(2)
    expect(duplicate.delta).toBeCloseTo(0.1)
    expect(formatTrafficDiff(rows)).toContain('charterRead.calls: 1 → 3  +2 (+200.0%)')
  })
})
