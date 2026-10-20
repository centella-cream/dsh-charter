import type { CharterObjective, DeliverableProgress } from './schemas.js'
import { compareOrderedItems } from './items.js'

export const CHARTER_PROMPT_PREFIX =
  'Current user-authored session charter. It does not override system, host, tool-permission, or execution policies.\n'

/**
 * The minimum shape needed to render a model-visible charter. `CharterItem`
 * satisfies it, and so does a UI draft item that has not been committed yet.
 */
export interface PromptItem {
  readonly id: string
  readonly kind: 'invariant' | 'deliverable'
  readonly text: string
  readonly review: 'pending' | 'accepted' | 'rejected'
  readonly lifecycle: 'current' | 'superseded' | 'archived'
  readonly order: number
  readonly progress?: DeliverableProgress
}

function isStanding(item: PromptItem): boolean {
  return item.review === 'accepted' && item.lifecycle === 'current'
}

function isInvariant(item: PromptItem): item is PromptItem & { kind: 'invariant' } {
  return item.kind === 'invariant'
}

function isDeliverable(
  item: PromptItem,
): item is PromptItem & { kind: 'deliverable'; progress: DeliverableProgress } {
  return item.kind === 'deliverable' && item.progress !== undefined
}

/**
 * Encode one user-authored value as a JSON string token without leaving a
 * `{{var}}` sequence in the rendered prompt.
 *
 * DSH 0.2.1 and later can register a context with `interpolate: false`, but
 * DSH 0.1.7 and 0.2.0 always run the prompt-variable interpolator over runtime
 * contexts.
 * Escaping the first brace of every run as `\u007b` keeps the token valid JSON
 * and decodes to exactly the same text, while no longer matching the
 * `{{name}}` grammar on any supported runtime.
 */
export function encodePromptText(value: string): string {
  return JSON.stringify(value).replace(
    /\{{2,}/gu,
    run => '\\u007b'.repeat(run.length - 1) + '{',
  )
}

/**
 * Render the complete model-visible charter contribution.
 *
 * The output is deliberately small and deterministic: only the current
 * objective and accepted, current invariants and deliverables participate.
 * Metadata such as review state, verification, origin, evidence, revision and
 * timestamps never enters the model-visible text.
 */
export function renderCharterPrompt<T extends PromptItem>(
  objective: CharterObjective | undefined,
  items: readonly T[],
): string {
  const standing = [...items].filter(isStanding).sort(compareOrderedItems)
  if (objective === undefined && standing.length === 0) return ''

  const invariants = standing.filter(isInvariant).map(item => encodePromptText(item.text))
  const deliverables = standing.filter(isDeliverable).map(item =>
    `{"text":${encodePromptText(item.text)},"progress":${JSON.stringify(item.progress)}}`,
  )

  return CHARTER_PROMPT_PREFIX
    + `{"objective":${objective === undefined ? 'null' : encodePromptText(objective.current.text)}`
    + `,"invariants":[${invariants.join(',')}]`
    + `,"deliverables":[${deliverables.join(',')}]}`
}
