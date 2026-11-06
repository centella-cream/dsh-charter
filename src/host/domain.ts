import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { z } from 'zod'
import { charterRecordArchiveSchema, type CharterRecordArchive } from '../core/schemas.js'

export const CHARTER_DOMAIN_NAME = 'dsh_charter_v1'
export const CHARTER_DOMAIN_VERSION = 1
export const CHARTER_SESSIONS_TABLE = 'sessions'

export const charterDomainSpec = defineDomain({
  name: CHARTER_DOMAIN_NAME,
  version: CHARTER_DOMAIN_VERSION,
  layout: 'per-record',
  // Record documents stay unparsed at this boundary on purpose: the service
  // validates each one and marks only that Session unavailable, so a single
  // corrupt or forward-skewed record cannot brick every other Session's
  // charter. Writes always come from `createEmptyRecord`/`forkRecord`/
  // `commitRecord`, which construct schema-valid records.
  tables: {
    sessions: domainTable<SessionId, unknown>(z.unknown()),
  },
})

export type CharterDomainSpec = typeof charterDomainSpec

export const CHARTER_ARCHIVES_DOMAIN_NAME = 'dsh_charter_archives_v1'
export const CHARTER_ARCHIVES_DOMAIN_VERSION = 1
export const CHARTER_ARCHIVES_TABLE = 'archives'
export const CHARTER_ARCHIVE_CACHE_LIMIT = 5

export interface CharterArchiveCacheEntry {
  readonly key: string
  readonly sessionId: string
  readonly revision: number
  readonly archivedAt: number
  readonly archive: CharterRecordArchive
}

export const charterArchiveCacheEntrySchema = z.object({
  key: z.string().min(1),
  sessionId: z.string().min(1).max(256),
  revision: z.number().int().nonnegative(),
  archivedAt: z.number().int().nonnegative(),
  archive: charterRecordArchiveSchema,
}).strict()

export const charterArchivesDomainSpec = defineDomain({
  name: CHARTER_ARCHIVES_DOMAIN_NAME,
  version: CHARTER_ARCHIVES_DOMAIN_VERSION,
  layout: 'per-record',
  tables: {
    archives: domainTable<string, CharterArchiveCacheEntry>(charterArchiveCacheEntrySchema),
  },
})

export function archiveCacheKey(sessionId: string, revision: number): string {
  return `${sessionId}--r${revision}`
}
