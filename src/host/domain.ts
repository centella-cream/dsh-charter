import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { z } from 'zod'

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
