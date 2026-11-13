import { dependencyProjection } from './dependencies.js'
import { isStandingItem } from './items.js'
import type { CharterItem } from './schemas.js'

/** The hard standing tool envelope; kept here so Host and Diagnostics cannot drift. */
export const STANDING_TOOL_MAX_ITEMS = 64
export const STANDING_TOOL_MAX_BYTES = 32 * 1_024

export interface StandingToolItem {
  readonly kind: 'invariant' | 'deliverable'
  readonly text: string
  readonly verification: CharterItem['verification']['state']
  readonly progress: string | null
  readonly id?: string
  readonly key?: string | null
  readonly requires?: readonly string[]
}

export interface StandingToolView {
  readonly revision: number
  readonly objective: string | null
  readonly items: readonly StandingToolItem[]
  readonly truncated: 0
}

export interface StandingEnvelopeEstimate {
  readonly view: StandingToolView
  readonly bytes: number
  readonly itemCount: number
  readonly deliverableCount: number
}

/**
 * Build the exact `charter_read standing` payload and its serialized byte count.
 * The property order and shape are part of the tool-result fixture: do not
 * reorder fields without updating the envelope test.
 */
export function buildStandingEnvelope(
  items: readonly CharterItem[],
  revision: number,
  objective: string | null,
): StandingEnvelopeEstimate {
  const standing = items.filter(isStandingItem)
  const plan = dependencyProjection(standing)
  const keyById = new Map(plan.map(row => [row.id, row]))
  const simplified: StandingToolItem[] = standing.map(item => ({
    kind: item.kind,
    text: item.text,
    verification: item.verification.state,
    progress: item.kind === 'deliverable' ? item.progress : null,
    ...(item.kind === 'deliverable'
      ? {
          id: item.id,
          key: keyById.get(item.id)?.localKey ?? null,
          requires: keyById.get(item.id)?.requires ?? [],
        }
      : {}),
  }))
  const view: StandingToolView = { revision, objective, items: simplified, truncated: 0 }
  return {
    view,
    bytes: new TextEncoder().encode(JSON.stringify(view)).byteLength,
    itemCount: simplified.length,
    deliverableCount: simplified.filter(item => item.kind === 'deliverable').length,
  }
}
