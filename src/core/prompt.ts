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
  readonly requires?: readonly string[] | undefined
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
  const deliverables = standing.filter(isDeliverable) as readonly DependencyPromptItem[]
  const dependencyAware = deliverables.some(item => (item.requires?.length ?? 0) > 0)

  const rendered = dependencyAware
    ? renderDependencyDeliverables(deliverables)
    : deliverables.map(item =>
      `{"text":${encodePromptText(item.text)},"progress":${JSON.stringify(item.progress)}}`,
    )

  return CHARTER_PROMPT_PREFIX
    + `{"objective":${objective === undefined ? 'null' : encodePromptText(objective.current.text)}`
    + `,"invariants":[${invariants.join(',')}]`
    + `,"deliverables":[${rendered.join(',')}]}`
}

interface DependencyPromptItem extends PromptItem {
  readonly kind: 'deliverable'
  readonly progress: DeliverableProgress
  readonly requires?: readonly string[] | undefined
}

function renderDependencyDeliverables(deliverables: readonly DependencyPromptItem[]): string[] {
  const byId = new Map(deliverables.map(item => [item.id, item]))
  const pending = new Map(deliverables.map(item => [item.id, new Set(
    (item.requires ?? []).filter(id => byId.has(id) && id !== item.id),
  )]))
  const ordered: DependencyPromptItem[] = []
  while (pending.size > 0) {
    const layer = deliverables
      .filter(item => pending.has(item.id) && [...pending.get(item.id)!].every(id => !pending.has(id)))
      .sort(compareOrderedItems)
    if (layer.length === 0) {
      throw new Error('deliverable dependency graph contains a cycle')
    }
    for (const item of layer) {
      ordered.push(item)
      pending.delete(item.id)
    }
  }
  const keyById = new Map(ordered.map((item, index) => [item.id, `D${index + 1}`]))
  return ordered.map(item => {
    const requires = [...(item.requires ?? [])]
      .filter(id => keyById.has(id))
      .map(id => keyById.get(id)!)
      .sort()
    return `{"key":${JSON.stringify(keyById.get(item.id))}`
      + `,"text":${encodePromptText(item.text)}`
      + `,"progress":${JSON.stringify(item.progress)}`
      + `,"requires":[${requires.map(value => JSON.stringify(value)).join(',')}]}`
  })
}
