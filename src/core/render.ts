import { sha256Json, sha256Text } from './digest.js'
import type { CharterLimits } from './limits.js'
import type { CharterItem, CharterObjective, CharterSnapshot } from './schemas.js'
import { canonicalItems } from './items.js'
import { renderCharterPrompt } from './prompt.js'
import { assertStateQuota } from './state.js'

export {
  CHARTER_PROMPT_PREFIX,
  encodePromptText,
  renderCharterPrompt,
  renderCharterPrompt as renderPrompt,
} from './prompt.js'
export type { PromptItem } from './prompt.js'

export function buildSnapshot(
  revision: number,
  objective: CharterObjective | undefined,
  items: readonly CharterItem[],
  limits: CharterLimits,
): CharterSnapshot {
  const canonical = canonicalItems(items)
  const promptText = renderCharterPrompt(objective, canonical)
  const snapshot: CharterSnapshot = {
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
  assertStateQuota(snapshot, limits)
  return snapshot
}

export function emptySnapshot(limits: CharterLimits): CharterSnapshot {
  return buildSnapshot(0, undefined, [], limits)
}
