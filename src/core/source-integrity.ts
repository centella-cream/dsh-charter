import type { ProposalSource } from './schemas.js'
import { sourceRegistryEntry } from './source-registry.js'

export type SourceIntegrity = 'not-applicable' | 'intact' | 'unknown' | 'unavailable'

/**
 * Derived source-integrity label. It never mutates review/lifecycle and never
 * treats a missing digest as a verified source.
 */
export function sourceIntegrity(source: ProposalSource): SourceIntegrity {
  const entry = sourceRegistryEntry(source)
  if (entry.digest === 'not-applicable') return 'not-applicable'
  return 'digest' in source && source.digest !== undefined ? 'intact' : 'unknown'
}
