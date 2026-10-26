import { sha256Json, sha256Text } from './digest.js'
import type { CharterLimits } from './limits.js'
import type { CharterItem, CharterObjective, CharterSnapshot } from './schemas.js'
import { canonicalItems, normalizeItemShape } from './items.js'
import { renderCharterPrompt } from './prompt.js'
import { assertStateQuota } from './state.js'

export {
  CHARTER_PROMPT_PREFIX,
  encodePromptText,
  renderCharterPrompt,
  renderCharterPrompt as renderPrompt,
} from './prompt.js'
export type { PromptItem } from './prompt.js'

/**
 * Project a charter snapshot without applying the current quota configuration.
 *
 * Structural consistency validation must not depend on mutable admission
 * limits: lowering a limit later is a policy change, not record corruption.
 * Quotas are enforced separately when a new snapshot is admitted.
 */
export function buildSnapshotUnchecked(
  revision: number,
  objective: CharterObjective | undefined,
  items: readonly CharterItem[],
): CharterSnapshot {
  const canonical = canonicalItems(items).map(normalizeItemShape)
  const promptText = renderCharterPrompt(objective, canonical)
  return {
    revision,
    ...(objective === undefined ? {} : { objective }),
    items: [...canonical],
    promptText,
    promptDigest: sha256Text(promptText),
    stateDigest: sha256Json({
      revision,
      objective: objective ?? null,
      items: canonical,
    }),
  }
}

/** Build a snapshot and require it to satisfy the full quota configuration. */
export function buildSnapshot(
  revision: number,
  objective: CharterObjective | undefined,
  items: readonly CharterItem[],
  limits: CharterLimits,
): CharterSnapshot {
  const snapshot = buildSnapshotUnchecked(revision, objective, items)
  assertStateQuota(snapshot, limits)
  return snapshot
}

export function emptySnapshot(limits: CharterLimits): CharterSnapshot {
  return buildSnapshot(0, undefined, [], limits)
}
