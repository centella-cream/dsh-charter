import type { ProposalSource } from './schemas.js'

export type SourceKind = ProposalSource['kind']

export interface SourceRegistryEntry {
  readonly kind: SourceKind
  readonly fields: readonly string[]
  readonly digest: 'required' | 'optional' | 'not-applicable'
}

/** Registry of the persisted provenance fields for every proposal source kind. */
export const PROPOSAL_SOURCE_REGISTRY: Readonly<Record<SourceKind, SourceRegistryEntry>> = {
  manual: { kind: 'manual', fields: ['actor', 'at'], digest: 'not-applicable' },
  message: {
    kind: 'message',
    fields: ['sessionId', 'sessionCreatedAt', 'projectionVersion', 'digest', 'seqs', 'role', 'selection', 'at'],
    digest: 'required',
  },
  'compaction-summary': {
    kind: 'compaction-summary',
    fields: ['summarySeq', 'at', 'sessionId', 'projectionVersion', 'digest'],
    digest: 'optional',
  },
  'agent-tool': { kind: 'agent-tool', fields: ['toolCallId', 'at', 'digest'], digest: 'optional' },
  fork: {
    kind: 'fork',
    fields: ['parentBatchId', 'parentSessionId', 'parentRevision', 'sourceRefs', 'at', 'digest'],
    digest: 'optional',
  },
  'legacy-unknown': { kind: 'legacy-unknown', fields: [], digest: 'not-applicable' },
}

export function sourceRegistryEntry(source: ProposalSource): SourceRegistryEntry {
  return PROPOSAL_SOURCE_REGISTRY[source.kind]
}
