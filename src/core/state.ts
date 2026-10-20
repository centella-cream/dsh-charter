import { charterError } from './errors.js'
import { utf8Bytes, type CharterLimits } from './limits.js'
import {
  isDeliverable,
  isInvariant,
  isStandingItem,
} from './items.js'
import { normalizeUserText } from './normalize.js'
import type {
  CharterItem,
  CharterObjective,
  CharterSnapshot,
} from './schemas.js'

export {
  canonicalItems,
  compareCodeUnits,
  compareOrderedItems as compareItems,
  isDeliverable,
  isInvariant,
  isStandingItem,
} from './items.js'

function assertCanonicalText(value: string, field: string): void {
  try {
    if (normalizeUserText(value, field) !== value) {
      throw charterError('CORRUPT_STATE', `${field} is not in canonical text form`)
    }
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'CORRUPT_STATE') throw error
    throw charterError('CORRUPT_STATE', `${field} is not in canonical text form`)
  }
}

export function validateState(
  revision: number,
  objective: CharterObjective | undefined,
  items: readonly CharterItem[],
): void {
  if (!Number.isSafeInteger(revision) || revision < 0) {
    throw charterError('CORRUPT_STATE', `invalid charter revision ${String(revision)}`)
  }

  if (objective !== undefined) {
    assertCanonicalText(objective.original.text, 'original objective')
    assertCanonicalText(objective.current.text, 'current objective')
    if (objective.current.reason !== undefined) {
      assertCanonicalText(objective.current.reason, 'objective redirect reason')
    }
    if (objective.original.setAtRevision < 1
      || objective.original.setAtRevision > revision
      || objective.current.setAtRevision < objective.original.setAtRevision
      || objective.current.setAtRevision > revision) {
      throw charterError('CORRUPT_STATE', 'objective revision markers are outside the snapshot revision')
    }
  }

  const byId = new Map<string, CharterItem>()
  for (const item of items) {
    if (byId.has(item.id)) {
      throw charterError('CORRUPT_STATE', `duplicate item id ${item.id}`)
    }
    byId.set(item.id, item)
    assertCanonicalText(item.text, `item ${item.id}`)

    if (item.createdRevision < 1 || item.createdRevision > revision) {
      throw charterError('CORRUPT_STATE', `item ${item.id} has an invalid createdRevision`)
    }

    if (item.review !== 'accepted') {
      if (item.lifecycle !== 'current') {
        throw charterError('CORRUPT_STATE', `non-accepted item ${item.id} must remain current`)
      }
      if (item.verification.state !== 'unchecked') {
        throw charterError('CORRUPT_STATE', `non-accepted item ${item.id} must remain unchecked`)
      }
      if (item.supersedes !== undefined || item.supersededBy !== undefined) {
        throw charterError('CORRUPT_STATE', `non-accepted item ${item.id} cannot participate in a replacement chain`)
      }
    }

    if (item.lifecycle === 'superseded' && item.supersededBy === undefined) {
      throw charterError('CORRUPT_STATE', `superseded item ${item.id} has no successor`)
    }
    if (item.lifecycle !== 'superseded' && item.supersededBy !== undefined) {
      throw charterError('CORRUPT_STATE', `item ${item.id} has a successor but is not superseded`)
    }
  }

  for (const item of items) {
    if (item.supersedes !== undefined) {
      const previous = byId.get(item.supersedes)
      if (previous === undefined) {
        throw charterError('CORRUPT_STATE', `item ${item.id} references missing predecessor ${item.supersedes}`)
      }
      if (previous.supersededBy !== item.id) {
        throw charterError('CORRUPT_STATE', `item ${item.id} has a one-way predecessor link`)
      }
      if (previous.kind !== item.kind || previous.review !== 'accepted' || item.review !== 'accepted') {
        throw charterError('CORRUPT_STATE', `replacement link ${previous.id} -> ${item.id} is incompatible`)
      }
      if (item.lifecycle !== 'current') {
        throw charterError('CORRUPT_STATE', `replacement ${item.id} must be the current successor`)
      }
    }
    if (item.supersededBy !== undefined) {
      const next = byId.get(item.supersededBy)
      if (next === undefined || next.supersedes !== item.id) {
        throw charterError('CORRUPT_STATE', `item ${item.id} has a one-way successor link`)
      }
    }
  }

  for (const item of items) {
    const seen = new Set<string>([item.id])
    let cursor = item
    while (cursor.supersededBy !== undefined) {
      if (seen.has(cursor.supersededBy)) {
        throw charterError('CORRUPT_STATE', `replacement chain contains a cycle at ${cursor.supersededBy}`)
      }
      seen.add(cursor.supersededBy)
      const next = byId.get(cursor.supersededBy)
      if (next === undefined) break
      cursor = next
    }
  }
}

export function assertStateQuota(snapshot: CharterSnapshot, limits: CharterLimits): void {
  if (snapshot.items.length > limits.maxItems) {
    throw charterError('QUOTA_EXCEEDED', `charter exceeds ${limits.maxItems} items`)
  }

  const pending = snapshot.items.filter(item => item.review === 'pending').length
  if (pending > limits.maxPendingItems) {
    throw charterError('QUOTA_EXCEEDED', `charter exceeds ${limits.maxPendingItems} pending items`)
  }

  const standing = snapshot.items.filter(isStandingItem)
  const invariants = standing.filter(isInvariant)
  const deliverables = standing.filter(isDeliverable)
  if (invariants.length > limits.maxActiveInvariants) {
    throw charterError('QUOTA_EXCEEDED', `charter exceeds ${limits.maxActiveInvariants} active invariants`)
  }
  if (deliverables.length > limits.maxActiveDeliverables) {
    throw charterError('QUOTA_EXCEEDED', `charter exceeds ${limits.maxActiveDeliverables} active deliverables`)
  }

  if (snapshot.objective !== undefined
    && utf8Bytes(snapshot.objective.current.text) > limits.maxObjectiveBytes) {
    throw charterError('QUOTA_EXCEEDED', `the objective exceeds ${limits.maxObjectiveBytes} UTF-8 bytes`)
  }
  if (snapshot.items.some(item => utf8Bytes(item.text) > limits.maxItemBytes)) {
    throw charterError('QUOTA_EXCEEDED', `an item exceeds ${limits.maxItemBytes} UTF-8 bytes`)
  }
  if (utf8Bytes(snapshot.promptText) > limits.maxPromptBytes) {
    throw charterError('QUOTA_EXCEEDED', `charter prompt exceeds ${limits.maxPromptBytes} UTF-8 bytes`)
  }
}
