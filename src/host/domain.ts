import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { charterRecordSchema, type CharterRecord } from '../core/schemas.js'

export const CHARTER_DOMAIN_NAME = 'dsh_charter_v1'
export const CHARTER_DOMAIN_VERSION = 1
export const CHARTER_SESSIONS_TABLE = 'sessions'

export const charterDomainSpec = defineDomain({
  name: CHARTER_DOMAIN_NAME,
  version: CHARTER_DOMAIN_VERSION,
  layout: 'per-record',
  tables: {
    sessions: domainTable<SessionId, CharterRecord>(charterRecordSchema),
  },
})

export type CharterDomainSpec = typeof charterDomainSpec
