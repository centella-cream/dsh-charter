import {
  bootstrapFromSummary,
  bulletLines,
  cleanLine,
  compactionSummaryEvent,
  paragraphLines,
  sectionKind,
  splitSections,
  type BootstrapSource,
  type CompactionSummaryEvent,
} from './bootstrap.js'
import type { CharterLimits } from './limits.js'
import { utf8Bytes } from './limits.js'

export type StructuredDraftLanguage = 'zh' | 'en' | 'mixed'

export interface StructuredDraftMember {
  readonly ref: string
  readonly text: string
}

export interface StructuredDraftItem {
  readonly ref: string
  readonly kind: 'objective' | 'invariant' | 'deliverable'
  readonly text: string
  readonly lang: StructuredDraftLanguage
  readonly oversized: boolean
  /** Original UTF-8 byte count when a >4x candidate was explicitly truncated. */
  readonly truncatedFrom?: number
  readonly kindConfidence?: 'high' | 'low'
  readonly foldCount?: number
  readonly foldMembers?: readonly StructuredDraftMember[]
}

export interface StructuredDraftExtraction {
  readonly objective: string | null
  readonly invariants: readonly string[]
  readonly deliverables: readonly string[]
  readonly items: readonly StructuredDraftItem[]
  readonly draftLang: StructuredDraftLanguage
  readonly source: BootstrapSource
  readonly extractorVersion: 2
}

const OBJECTIVE_LABEL = /^(?:latest correction|latest|original|原始|最新修正|目标|objective)\s*[:：]\s*(.+)$/i
const DEDUPE_TRAILING = /[。.!！?？;；,，、:：]+$/u
const SENTENCE_END = /(?<=[.!?。！？])\s+/u
const MARKER = '…'

function normalizeForDedupe(value: string): string {
  return value
    .normalize('NFC')
    .toLowerCase()
    .replace(/\s+/gu, ' ')
    .replace(DEDUPE_TRAILING, '')
    .trim()
}

export function detectLanguage(value: string): StructuredDraftLanguage {
  let cjk = 0
  let latin = 0
  for (const character of value) {
    const code = character.codePointAt(0) ?? 0
    if ((code >= 0x3400 && code <= 0x4dbf) || (code >= 0x4e00 && code <= 0x9fff)
      || (code >= 0xf900 && code <= 0xfaff)) {
      cjk += 1
    } else if ((code >= 0x41 && code <= 0x5a) || (code >= 0x61 && code <= 0x7a)
      || (code >= 0x00c0 && code <= 0x024f)) {
      latin += 1
    }
  }
  const total = cjk + latin
  if (total === 0) return 'mixed'
  if (latin / total >= 0.7) return 'en'
  if (cjk / total >= 0.7) return 'zh'
  return 'mixed'
}

/**
 * Split only at sentence boundaries. A sentence larger than maxItemBytes is
 * kept whole and marked oversized; no word/codepoint fragments are produced.
 * Only a >4x sentence is explicitly truncated, and the metadata keeps the
 * original byte count so the UI can explain the exception.
 */
export function splitComplete(
  value: string,
  maxBytes: number,
): Array<{ readonly text: string; readonly oversized: boolean; readonly truncatedFrom?: number }> {
  const text = value.replace(/\s+/gu, ' ').trim()
  if (text.length === 0) return []
  if (utf8Bytes(text) <= maxBytes) return [{ text, oversized: false }]

  const sentences = text.split(SENTENCE_END).map(part => part.trim()).filter(Boolean)
  const chunks: Array<{ text: string; oversized: boolean; truncatedFrom?: number }> = []
  let current = ''
  const flush = (): void => {
    if (current.length > 0) chunks.push({ text: current, oversized: false })
    current = ''
  }
  const fitTruncated = (sentence: string): { text: string; oversizeFrom: number } => {
    const markerBytes = utf8Bytes(MARKER)
    const budget = Math.max(1, maxBytes - markerBytes)
    let result = ''
    let bytes = 0
    for (const character of sentence) {
      const size = utf8Bytes(character)
      if (bytes + size > budget) break
      result += character
      bytes += size
    }
    // Prefer a sentence/clause boundary near the byte cut when one exists.
    const boundary = Math.max(result.lastIndexOf(' '), result.lastIndexOf('。'), result.lastIndexOf('.'))
    if (boundary > Math.floor(result.length / 2)) result = result.slice(0, boundary).trimEnd()
    return { text: `${result}${MARKER}`, oversizeFrom: utf8Bytes(sentence) }
  }

  for (const sentence of sentences) {
    if (utf8Bytes(sentence) <= maxBytes) {
      const joined = current.length === 0 ? sentence : `${current} ${sentence}`
      if (utf8Bytes(joined) <= maxBytes) {
        current = joined
      } else {
        flush()
        current = sentence
      }
      continue
    }
    flush()
    if (utf8Bytes(sentence) <= maxBytes * 4) {
      chunks.push({ text: sentence, oversized: true })
    } else {
      const truncated = fitTruncated(sentence)
      chunks.push({ text: truncated.text, oversized: true, truncatedFrom: truncated.oversizeFrom })
    }
  }
  flush()
  return chunks
}

interface Candidate {
  readonly text: string
  readonly oversized: boolean
  readonly truncatedFrom?: number
}

interface FoldGroup {
  readonly candidates: Candidate[]
  representative: string
}

function foldCandidates(candidates: readonly Candidate[]): FoldGroup[] {
  const groups: FoldGroup[] = []
  for (const candidate of candidates) {
    const key = normalizeForDedupe(candidate.text)
    if (key.length === 0) continue
    let target: FoldGroup | undefined
    for (const group of groups) {
      const existing = normalizeForDedupe(group.representative)
      if (existing === key) { target = group; break }
      const shorter = existing.length <= key.length ? existing : key
      if (shorter.length >= 12 && (existing.startsWith(key) || key.startsWith(existing))) {
        target = group
        break
      }
    }
    if (target === undefined) {
      groups.push({ candidates: [candidate], representative: candidate.text })
      continue
    }
    target.candidates.push(candidate)
    if (utf8Bytes(candidate.text) > utf8Bytes(target.representative)) {
      target.representative = candidate.text
    }
  }
  return groups
}

function groupMembers(group: FoldGroup): readonly StructuredDraftMember[] {
  let representativeConsumed = false
  return group.candidates
    .filter(candidate => {
      if (!representativeConsumed && candidate.text === group.representative) {
        representativeConsumed = true
        return false
      }
      return true
    })
    .map((candidate, index) => ({ ref: `.${index + 1}`, text: candidate.text }))
}

function languageOfTexts(texts: readonly string[]): StructuredDraftLanguage {
  let zh = 0
  let en = 0
  let mixed = 0
  for (const text of texts) {
    const lang = detectLanguage(text)
    if (lang === 'zh') zh += utf8Bytes(text)
    else if (lang === 'en') en += utf8Bytes(text)
    else mixed += utf8Bytes(text)
  }
  if (zh === 0 && en === 0) return 'mixed'
  if (zh >= en && zh >= mixed) return 'zh'
  if (en >= zh && en >= mixed) return 'en'
  return 'mixed'
}

function buildKindItems(
  candidates: readonly string[],
  kind: 'invariant' | 'deliverable',
  maxBytes: number,
): StructuredDraftItem[] {
  const split: Candidate[] = candidates.flatMap(candidate => splitComplete(candidate, maxBytes))
  const groups = foldCandidates(split)
  return groups.map((group, groupIndex) => {
    const members = groupMembers(group)
    const representative = group.representative
    const representativeCandidate = split.find(candidate => candidate.text === representative)
    return {
      ref: `d-${kind === 'invariant' ? 'inv' : 'del'}-${groupIndex}`,
      kind,
      text: representative,
      lang: detectLanguage(representative),
      oversized: representativeCandidate?.oversized ?? false,
      ...(representativeCandidate?.truncatedFrom === undefined
        ? {}
        : { truncatedFrom: representativeCandidate.truncatedFrom }),
      kindConfidence: 'high' as const,
      ...(members.length === 0
        ? {}
        : {
            foldCount: group.candidates.length,
            foldMembers: members.map(member => ({ ...member, ref: `d-${kind === 'invariant' ? 'inv' : 'del'}-${groupIndex}${member.ref}` })),
          }),
    }
  })
}

/** Deterministically extract a structured, language-tagged, duplicate-folded draft. */
export function structuredFromSummary(
  summary: string,
  limits: Pick<CharterLimits, 'maxObjectiveBytes' | 'maxItemBytes'>,
): { readonly objective: string | null; readonly items: readonly StructuredDraftItem[]; readonly draftLang: StructuredDraftLanguage } {
  const legacy = bootstrapFromSummary(summary, limits)
  const sections = splitSections(summary)
  const primary = sections.filter(section => sectionKind(section.title) === 'primary')
  const critical = sections.filter(section => sectionKind(section.title) === 'critical')
  const pending = sections.filter(section => sectionKind(section.title) === 'pending')

  const primaryBullets = primary.flatMap(section => bulletLines(section.lines))
    .filter(line => !OBJECTIVE_LABEL.test(line))
  const criticalLines = critical.flatMap(section => [...bulletLines(section.lines), ...paragraphLines(section.lines)])
  const invariants = [...primaryBullets, ...criticalLines]
    .map(cleanLine)
    .filter((line): line is string => line !== null)
    .filter(line => line !== legacy.objective)
  const deliverables = pending.flatMap(section => {
    const bullets = bulletLines(section.lines)
    return bullets.length > 0 ? bullets : paragraphLines(section.lines)
  }).map(cleanLine).filter((line): line is string => line !== null)

  const invariantItems = buildKindItems(invariants, 'invariant', limits.maxItemBytes)
  const deliverableItems = buildKindItems(deliverables, 'deliverable', limits.maxItemBytes)
  const objective = legacy.objective
  const items: StructuredDraftItem[] = []
  if (objective !== null) {
    items.push({
      ref: 'd-obj-0',
      kind: 'objective',
      text: objective,
      lang: detectLanguage(objective),
      oversized: utf8Bytes(objective) > limits.maxObjectiveBytes,
      kindConfidence: 'high',
    })
  }
  items.push(...invariantItems, ...deliverableItems)
  const draftLang = languageOfTexts(items.map(item => item.text))
  return {
    objective,
    items,
    draftLang,
  }
}

/** Find the latest usable compaction summary and extract its structured draft. */
export function structuredFromEvents(
  events: readonly CompactionSummaryEvent[],
  limits: Pick<CharterLimits, 'maxObjectiveBytes' | 'maxItemBytes'>,
): StructuredDraftExtraction | undefined {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index]
    if (event === undefined) continue
    const parsed = compactionSummaryEvent(event)
    if (parsed === undefined) continue
    const draft = structuredFromSummary(parsed.text, limits)
    if (draft.objective === null && draft.items.length === 0) continue
    const invariantTexts = draft.items.filter(item => item.kind === 'invariant').map(item => item.text)
    const deliverableTexts = draft.items.filter(item => item.kind === 'deliverable').map(item => item.text)
    return {
      objective: draft.objective,
      invariants: invariantTexts,
      deliverables: deliverableTexts,
      items: draft.items,
      draftLang: draft.draftLang,
      source: parsed.source,
      extractorVersion: 2,
    }
  }
  return undefined
}

export const STRUCTURED_EXTRACTOR_VERSION = 2 as const
