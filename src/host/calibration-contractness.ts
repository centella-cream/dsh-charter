/**
 * Deterministic contractness filter for calibration input/output.
 *
 * The L1 extractor intentionally preserves raw history wording. Calibration is
 * the layer that must separate durable contract items from headings, progress
 * reports, historical context, pending decisions and optional suggestions.
 */

export type ContractnessReason = 'fragment' | 'status' | 'history' | 'optional' | 'pending' | 'non-contract'

const TRAILING_COLON = /[:：]\s*$/u
const STATUS_START = /^(?:current(?:ly)?|status|progress|done|completed|in progress|implementing|working on|blocked|latest(?: known)?|full gate|docker gate|git status|head\b|test(?:s)?\b|coverage\b|remaining\b)/iu
const STATUS_ANY = /(?:\bgit status\b|\bHEAD\s+[0-9a-f]{7,}\b|\b(?:done|completed)\s*[.!]?\s*$|\bcurrently failing\b|\bcode done\b|\bfailing due\b|\bT[-_ ]?\d+\b.*\b(?:done|added|completed|implemented|updated|restored)\b)/iu
const HISTORY = /^(?:previously|historical|goal state|user decision|decision authority|baseline decision|earlier\b|user(?:'s|’s)? (?:last )?(?:instruction|request|decision)|user explicitly|the user explicitly)/iu
const OPTIONAL = /^(?:suggested|optional|nice[- ]to[- ]have|maybe|could consider|if time permits|建议|可选|可以考虑)/iu
const PENDING = /^(?:need(?:s)?(?: to)? confirm|to confirm|pending|tbd|open question|must confirm|待确认|需要确认)/iu
const CONFIG_FRAGMENT = /^(?:[A-Z][A-Z0-9_]{2,}\s*=|(?:[A-Z][A-Z0-9_]{2,}\s*,\s*)+[A-Z][A-Z0-9_]{2,}\s*=)/u
const ACTION_LABEL = /^(?:T|D|F)[-_]?\d+[:：]\s*/iu
const IMPERATIVE = /\b(?:add|apply|clarify|commit|confirm|create|decide|define|drop|ensure|fix|implement|keep|merge|pin|remove|restore|run|set|update|write)\b/iu
const HARD_INVARIANT = /\b(?:must(?: not)?|never|forbidden|not allowed|do not|don't|shall|always|no\b.*\buntil)\b/iu
const ACTION_START = /^(?:add|apply|clarify|commit|confirm|create|decide|define|drop|ensure|fix|implement|keep|merge|pin|remove|restore|run|set|update|write)\b/iu

/** Return why a raw line/calibrated candidate is not a durable contract item. */
export function contractnessReason(text: string): ContractnessReason | undefined {
  const value = text.trim()
  if (value.length === 0) return 'fragment'
  if (TRAILING_COLON.test(value)) return 'fragment'
  if (CONFIG_FRAGMENT.test(value) && !IMPERATIVE.test(value)) return 'fragment'
  if (STATUS_START.test(value) || STATUS_ANY.test(value)) return 'status'
  if (HISTORY.test(value)) return 'history'
  if (OPTIONAL.test(value)) return 'optional'
  if (PENDING.test(value)) return 'pending'
  return undefined
}

/** Reclassify action items such as `T-1: add ...` as deliverables. */
export function reclassifyContractKind(
  text: string,
  kind: 'invariant' | 'deliverable' | 'objective',
): 'invariant' | 'deliverable' | 'objective' {
  if (kind === 'objective') return kind
  if (kind === 'invariant' && ACTION_LABEL.test(text) && IMPERATIVE.test(text)) return 'deliverable'
  if (kind === 'deliverable' && HARD_INVARIANT.test(text) && !ACTION_LABEL.test(text) && !ACTION_START.test(text)) return 'invariant'
  return kind
}
