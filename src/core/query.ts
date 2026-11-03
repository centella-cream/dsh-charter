import { charterError } from './errors.js'
import { sha256Json } from './digest.js'
import { compareOrderedItems } from './items.js'
import type { CharterLifecycle, CharterReview, CharterItem } from './schemas.js'

const QUERY_VERSION = 1 as const

export interface ItemQueryFilter {
  readonly kind?: 'invariant' | 'deliverable'
  readonly review?: CharterReview
  readonly lifecycle?: CharterLifecycle
  readonly search?: string
  readonly sourceKind?: 'manual' | 'message' | 'compaction-summary' | 'agent-tool' | 'fork' | 'legacy-unknown'
}

export interface ItemQueryRequest extends ItemQueryFilter {
  readonly cursor?: string | undefined
  readonly limit?: number | undefined
}

export interface ItemQueryPage {
  readonly ok: true
  readonly revision: number
  readonly items: readonly CharterItem[]
  readonly nextCursor?: string
  readonly filterDigest: string
}

export interface ItemQueryFailure {
  readonly ok: false
  readonly code: 'STALE_REVISION' | 'INVALID_CURSOR' | 'LIMIT_EXCEEDED' | 'NOT_FOUND' | 'UNAVAILABLE'
  readonly message: string
  readonly revision?: number
}

interface CursorPayload {
  readonly v: 1
  readonly queryKind: 'items'
  readonly lifecycle: string
  readonly revision: number
  readonly filterDigest: string
  readonly lastKey: string
}

function sortKey(item: CharterItem): string {
  return `${item.order.toString().padStart(12, '0')}:${item.id}`
}

function normalizeSearch(value: string): string {
  return value.normalize('NFC').toLowerCase()
}

function filterDigestOf(filter: ItemQueryFilter): string {
  return sha256Json({
    v: QUERY_VERSION,
    queryKind: 'items',
    kind: filter.kind ?? null,
    review: filter.review ?? null,
    lifecycle: filter.lifecycle ?? null,
    search: filter.search === undefined ? null : normalizeSearch(filter.search),
    sourceKind: filter.sourceKind ?? null,
  })
}

function encodeCursor(cursor: CursorPayload): string {
  return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url')
}

function decodeCursor(value: string): CursorPayload {
  try {
    const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as CursorPayload
    if (parsed.v !== 1 || parsed.queryKind !== 'items'
      || typeof parsed.lifecycle !== 'string'
      || !Number.isSafeInteger(parsed.revision)
      || typeof parsed.filterDigest !== 'string'
      || typeof parsed.lastKey !== 'string') {
      throw new Error('cursor shape')
    }
    return parsed
  } catch {
    throw charterError('INVALID_CURSOR', 'invalid item query cursor')
  }
}

/** One immutable-snapshot query page; cursor binds lifecycle, revision and filter. */
export function queryItems(
  revision: number,
  lifecycle: string,
  items: readonly CharterItem[],
  filter: ItemQueryRequest,
  sourceKindById: ReadonlyMap<string, string> = new Map(),
): ItemQueryPage | ItemQueryFailure {
  const limit = filter.limit ?? 50
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
    return { ok: false, code: 'LIMIT_EXCEEDED', message: 'limit must be between 1 and 100', revision }
  }
  const digest = filterDigestOf(filter)
  let after: string | undefined
  if (filter.cursor !== undefined) {
    try {
      const cursor = decodeCursor(filter.cursor)
      if (cursor.revision !== revision || cursor.filterDigest !== digest || cursor.lifecycle !== lifecycle) {
        return {
          ok: false,
          code: 'STALE_REVISION',
          message: 'cursor was created for another revision, lifecycle, or filter',
          revision,
        }
      }
      after = cursor.lastKey
    } catch (error) {
      if (error instanceof Error && 'code' in error) {
        return { ok: false, code: 'INVALID_CURSOR', message: error.message, revision }
      }
      throw error
    }
  }
  const search = filter.search === undefined ? undefined : normalizeSearch(filter.search)
  const selected = items
    .filter(item => filter.kind === undefined || item.kind === filter.kind)
    .filter(item => filter.review === undefined || item.review === filter.review)
    .filter(item => filter.lifecycle === undefined || item.lifecycle === filter.lifecycle)
    .filter(item => search === undefined || normalizeSearch(item.text).includes(search))
    .filter(item => filter.sourceKind === undefined || sourceKindById.get(item.id) === filter.sourceKind)
    .sort(compareOrderedItems)
    .filter(item => after === undefined || sortKey(item) > after)
  const page = selected.slice(0, limit)
  const hasMore = selected.length > page.length
  return {
    ok: true,
    revision,
    items: page,
    filterDigest: digest,
    ...(hasMore && page.length > 0
      ? { nextCursor: encodeCursor({ v: 1, queryKind: 'items', lifecycle, revision, filterDigest: digest, lastKey: sortKey(page[page.length - 1]!) }) }
      : {}),
  }
}
