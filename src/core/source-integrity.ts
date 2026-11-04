import type { ProposalSource } from './schemas.js'

export type SourceIntegrity = 'not-applicable' | 'intact' | 'unknown' | 'unavailable'

/**
 * Derived source-integrity label. It never mutates review/lifecycle and never
 * treats a missing digest as a verified source.
 */
export function sourceIntegrity(source: ProposalSource): SourceIntegrity {
  switch (source.kind) {
    case 'manual':
    case 'legacy-unknown':
      return 'not-applicable'
    case 'compaction-summary':
    case 'agent-tool':
    case 'fork':
    case 'message':
      return source.digest === undefined ? 'unknown' : 'intact'
  }
}
