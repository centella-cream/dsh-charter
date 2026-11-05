import { sha256Json } from './digest.js'
import type { ProposalSource } from './schemas.js'

export type SourceKind = ProposalSource['kind']

export type SourceIntegrity =
  | 'not-applicable'
  | 'intact'
  | 'missing'
  | 'mismatch'
  | 'unsupported'

export interface SourceProjectionEvent {
  readonly seq: number
  readonly type: string
  readonly data: unknown
}

export interface SourceProjectionCandidate {
  readonly kind: 'item' | 'objective'
  readonly text: string
  readonly proposedRequires?: readonly string[]
}

export interface SourceProjectionCompaction {
  readonly objective: string | null
  readonly invariants: readonly string[]
  readonly deliverables: readonly string[]
}

export interface SourceProjectionContext {
  readonly events?: readonly SourceProjectionEvent[]
  readonly candidates?: readonly SourceProjectionCandidate[]
  readonly compaction?: SourceProjectionCompaction
}

export interface SourceRegistryEntry {
  readonly kind: SourceKind
  readonly fields: readonly string[]
  readonly requirements: 'complete' | 'not-applicable' | 'legacy'
  readonly projectionVersion: number
}

export const PROPOSAL_SOURCE_REGISTRY: Readonly<Record<SourceKind, SourceRegistryEntry>> = {
  manual: { kind: 'manual', fields: ['actor', 'at'], requirements: 'not-applicable', projectionVersion: 0 },
  message: {
    kind: 'message',
    fields: ['sessionId', 'sessionCreatedAt', 'projectionVersion', 'digest', 'seqs', 'role', 'selection', 'at'],
    requirements: 'complete',
    projectionVersion: 1,
  },
  'compaction-summary': {
    kind: 'compaction-summary',
    fields: ['summarySeq', 'at', 'sessionId', 'projectionVersion', 'digest'],
    requirements: 'complete',
    projectionVersion: 1,
  },
  'agent-tool': {
    kind: 'agent-tool',
    fields: ['toolCallId', 'at', 'digest'],
    requirements: 'complete',
    projectionVersion: 1,
  },
  fork: {
    kind: 'fork',
    fields: ['parentBatchId', 'parentSessionId', 'parentRevision', 'sourceRefs', 'at', 'digest'],
    requirements: 'complete',
    projectionVersion: 1,
  },
  'legacy-unknown': { kind: 'legacy-unknown', fields: [], requirements: 'legacy', projectionVersion: 0 },
}

export function sourceRegistryEntry(source: ProposalSource): SourceRegistryEntry {
  return PROPOSAL_SOURCE_REGISTRY[source.kind]
}

function textOfMessage(event: SourceProjectionEvent): string {
  const data = event.data as { content?: readonly { type?: string; text?: string }[] }
  return (data.content ?? [])
    .filter(block => block.type === 'text' && typeof block.text === 'string')
    .map(block => block.text)
    .join('\n')
}

export function messageProjectionDigest(source: {
  readonly sessionId: string
  readonly sessionCreatedAt: number
  readonly seqs: readonly number[]
  readonly role: 'user' | 'assistant' | 'tool'
  readonly selection?: unknown
}, texts: readonly string[]): `sha256:${string}` {
  return sha256Json({
    version: 1,
    kind: 'message-projection',
    sessionId: source.sessionId,
    sessionCreatedAt: source.sessionCreatedAt,
    seqs: [...source.seqs],
    role: source.role,
    selection: source.selection ?? null,
    texts: [...texts],
  })
}

export function agentProjectionDigest(
  toolCallId: string,
  candidates: readonly SourceProjectionCandidate[],
): `sha256:${string}` {
  return sha256Json({
    version: 1,
    kind: 'agent-tool-projection',
    toolCallId,
    candidates: candidates.map(candidate => ({
      kind: candidate.kind,
      text: candidate.text,
      requires: [...(candidate.proposedRequires ?? [])].sort(),
    })),
  })
}

export function compactionProjectionDigest(source: {
  readonly sessionId?: string
  readonly summarySeq: number
  readonly projectionVersion: number
}, compaction: SourceProjectionCompaction): `sha256:${string}` {
  return sha256Json({
    version: 1,
    kind: 'compaction-summary-projection',
    sessionId: source.sessionId ?? null,
    summarySeq: source.summarySeq,
    projectionVersion: source.projectionVersion,
    objective: compaction.objective,
    invariants: [...compaction.invariants],
    deliverables: [...compaction.deliverables],
  })
}

export function forkProjectionDigest(source: {
  readonly parentBatchId: string
  readonly parentSessionId?: string
  readonly parentRevision?: number
  readonly sourceRefs?: readonly { readonly kind: 'item' | 'objective'; readonly id: string }[]
}): `sha256:${string}` {
  return sha256Json({
    version: 1,
    kind: 'fork-projection',
    parentBatchId: source.parentBatchId,
    parentSessionId: source.parentSessionId ?? null,
    parentRevision: source.parentRevision ?? null,
    sourceRefs: [...(source.sourceRefs ?? [])].sort((left, right) =>
      left.kind === right.kind ? left.id.localeCompare(right.id) : left.kind.localeCompare(right.kind)),
  })
}

/** Recompute the source digest from the projection supplied by the Host. */
export function verifySourceProjection(
  source: ProposalSource,
  context: SourceProjectionContext = {},
): SourceIntegrity {
  const entry = sourceRegistryEntry(source)
  if (entry.requirements === 'not-applicable') return 'not-applicable'
  if (entry.requirements === 'legacy') return 'unsupported'
  const version = 'projectionVersion' in source
    ? source.projectionVersion
    : source.kind === 'agent-tool' || source.kind === 'fork' ? 1 : undefined
  if (version === undefined) return 'unsupported'
  if (version !== entry.projectionVersion) return 'unsupported'
  if (!('digest' in source) || source.digest === undefined) return 'missing'
  switch (source.kind) {
    case 'message': {
      if (context.events === undefined) return 'unsupported'
      const selection = source.selection as { readonly start?: unknown; readonly end?: unknown } | undefined
      const texts = source.seqs.map(seq => {
        const event = context.events!.find(candidate => candidate.seq === seq && candidate.type === 'user/message')
        if (event === undefined) return undefined
        const full = textOfMessage(event)
        if (selection === undefined) return full
        if (!Number.isSafeInteger(selection.start) || !Number.isSafeInteger(selection.end)) return undefined
        return full.slice(selection.start as number, selection.end as number).trim()
      })
      if (texts.some(text => text === undefined)) return 'missing'
      return messageProjectionDigest(source, texts as string[]) === source.digest ? 'intact' : 'mismatch'
    }
    case 'compaction-summary': {
      if (context.compaction === undefined) return 'unsupported'
      return compactionProjectionDigest({
        summarySeq: source.summarySeq,
        projectionVersion: source.projectionVersion!,
        ...(source.sessionId === undefined ? {} : { sessionId: source.sessionId }),
      }, context.compaction) === source.digest ? 'intact' : 'mismatch'
    }
    case 'agent-tool': {
      if (context.candidates === undefined) return 'unsupported'
      return agentProjectionDigest(source.toolCallId, context.candidates) === source.digest ? 'intact' : 'mismatch'
    }
    case 'fork':
      return 'unsupported'
  }
}
