import { z } from 'zod'
import type { CharterLimits } from './limits.js'
import { utf8Bytes } from './limits.js'

/** One compaction summary event in the parts this parser needs. */
export interface CompactionSummaryEvent {
  readonly type: string
  readonly seq: number
  readonly time: number
  readonly data: unknown
}

/** Structured draft extracted from history. It is never written as effective state. */
export interface BootstrapDraft {
  readonly objective: string | null
  readonly invariants: string[]
  readonly deliverables: string[]
}

export interface BootstrapSource {
  readonly summarySeq: number
  readonly at: number
  readonly shadowedTokens?: number
}

export interface BootstrapExtraction {
  readonly draft: BootstrapDraft
  readonly source: BootstrapSource
}

const compactionSummaryDataSchema = z.object({
  summary: z.array(z.object({
    type: z.string(),
    text: z.string(),
  }).passthrough()).min(1),
  shadowedTokenCount: z.number().optional(),
}).passthrough()

const SECTION = /^#{1,6}\s+(.+?)\s*$/
const BULLET = /^\s*(?:[-*+]|\d+[.)])\s+(.+)$/
const OBJECTIVE_LABEL = /^(?:latest correction|latest|original|原始|最新修正|目标|objective)\s*[:：]\s*(.+)$/i
const USER_WANTS_LABEL = /^(?:user wants|user requests|用户希望|用户要求)\s*[:：]?$/i
const CONSTRAINT = /(?:^|\s)(?:must|never|only|do not|don't|required|ensure|keep|should not|shall|always|no\s)|必须|禁止|不得|不要|只能|仅|保持|确保|需要/i

interface Section {
  readonly title: string
  readonly lines: readonly string[]
}

function splitSections(text: string): Section[] {
  const sections: Section[] = []
  let title = ''
  let lines: string[] = []
  for (const line of text.replaceAll('\r\n', '\n').split('\n')) {
    const match = SECTION.exec(line)
    if (match !== null) {
      sections.push({ title, lines })
      title = match[1] ?? ''
      lines = []
    } else {
      lines.push(line)
    }
  }
  sections.push({ title, lines })
  return sections
}

function sectionKind(title: string): 'primary' | 'critical' | 'pending' | 'other' {
  const value = title.toLowerCase()
  if (/primary request|request and intent|user request|用户请求|主要请求|原始目标|^目标$/.test(value)) return 'primary'
  if (/critical context|key constraints|constraints|约束|关键上下文|注意事项/.test(value)) return 'critical'
  if (/pending jobs|pending tasks|next step|current work|todo|待办|下一步|当前工作|交付/.test(value)) return 'pending'
  return 'other'
}

function unquote(value: string): string {
  let result = value.trim()
  for (let index = 0; index < 2; index += 1) {
    if (result.length >= 2
      && ((result.startsWith('"') && result.endsWith('"'))
        || (result.startsWith('“') && result.endsWith('”'))
        || (result.startsWith('\'') && result.endsWith('\'')))) {
      result = result.slice(1, -1).trim()
    }
  }
  return result
}

function cleanLine(raw: string): string | null {
  let value = raw.replace(BULLET, '$1').trim()
  if (value.length === 0) return null
  value = value
    .replace(/\*\*(.*?)\*\*/gu, '$1')
    .replace(/`([^`]+)`/gu, '$1')
    .replace(/^["“”'](.*)["“”']$/u, '$1')
    .replace(/\s+/gu, ' ')
    .trim()
  if (value.length === 0) return null
  if (USER_WANTS_LABEL.test(value)) return null
  return value
}

function bulletLines(lines: readonly string[]): string[] {
  const values: string[] = []
  for (const line of lines) {
    if (!BULLET.test(line)) continue
    const value = cleanLine(line)
    if (value !== null) values.push(value)
  }
  return values
}

function paragraphLines(lines: readonly string[]): string[] {
  const values: string[] = []
  for (const line of lines) {
    if (BULLET.test(line)) continue
    const value = cleanLine(line)
    if (value !== null) values.push(value)
  }
  return values
}

function hardSplit(value: string, maxBytes: number): string[] {
  const chunks: string[] = []
  let current = ''
  let bytes = 0
  for (const character of value) {
    const size = utf8Bytes(character)
    if (current.length > 0 && bytes + size > maxBytes) {
      chunks.push(current)
      current = ''
      bytes = 0
    }
    current += character
    bytes += size
  }
  if (current.length > 0) chunks.push(current)
  return chunks
}

/**
 * Split text into chunks no larger than the item budget without dropping
 * content. Sentence and clause boundaries are preferred; a single oversized
 * clause is split at a code-point boundary as a last resort. The UI still
 * checks the resulting bytes before Apply.
 */
function splitForLimit(value: string, maxBytes: number): string[] {
  const text = value.replace(/\s+/gu, ' ').trim()
  if (text.length === 0) return []
  if (utf8Bytes(text) <= maxBytes) return [text]

  const chunks: string[] = []
  let current = ''
  let currentBytes = 0
  const push = (part: string): void => {
    const partBytes = utf8Bytes(part)
    const joinedBytes = current.length === 0 ? partBytes : currentBytes + 1 + partBytes
    if (joinedBytes <= maxBytes) {
      current = current.length === 0 ? part : `${current} ${part}`
      currentBytes = joinedBytes
      return
    }
    if (current.length > 0) chunks.push(current)
    current = part
    currentBytes = partBytes
  }

  for (const sentence of text.split(/(?<=[.!?。！？])\s+/u)) {
    if (utf8Bytes(sentence) <= maxBytes) {
      push(sentence)
      continue
    }
    const clauses = sentence.split(/(?<=[;；,，、:：])\s*/u)
    for (const clause of clauses) {
      if (utf8Bytes(clause) <= maxBytes) {
        push(clause)
      } else {
        for (const piece of hardSplit(clause, maxBytes)) push(piece)
      }
    }
  }
  if (current.length > 0) chunks.push(current)
  return chunks.filter(chunk => chunk.length > 0)
}

function unique(values: readonly string[], exclude: string | null, limit: number): string[] {
  const seen = new Set<string>()
  const result: string[] = []
  for (const value of values) {
    if (value === exclude) continue
    const key = value.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    result.push(value)
    if (result.length >= limit) break
  }
  return result
}

/**
 * Deterministically extract a draft charter from a compaction summary.
 *
 * This intentionally does not call a model. The result is a proposal for the
 * user to review; it never enters the effective record on its own.
 */
export function bootstrapFromSummary(
  summary: string,
  limits: Pick<CharterLimits, 'maxObjectiveBytes' | 'maxItemBytes'>,
): BootstrapDraft {
  const sections = splitSections(summary)
  const primary = sections.filter(section => sectionKind(section.title) === 'primary')
  const critical = sections.filter(section => sectionKind(section.title) === 'critical')
  const pending = sections.filter(section => sectionKind(section.title) === 'pending')

  const primaryLines = primary.flatMap(section => section.lines)
  const labeledLines = primaryLines
    .map(line => cleanLine(line))
    .filter((line): line is string => line !== null && OBJECTIVE_LABEL.test(line))
  const latestLine = labeledLines.find(line => /^latest|最新修正/i.test(line))
  const originalLine = labeledLines.find(line => /^original|原始/i.test(line))
  // Real DSH summaries usually describe the request as bullets without an
  // `Original:`/`Latest correction:` label; the first primary bullet is the
  // best deterministic objective after the explicit labels.
  const firstPrimaryBullet = bulletLines(primaryLines)[0] ?? null
  const firstParagraph = paragraphLines(primaryLines)[0] ?? null
  const firstAnyBullet = bulletLines(sections.flatMap(section => section.lines))[0] ?? null
  const fallbackParagraph = paragraphLines(sections.flatMap(section => section.lines))[0] ?? null
  const objectiveLine = latestLine ?? originalLine ?? firstPrimaryBullet ?? firstParagraph
    ?? firstAnyBullet ?? fallbackParagraph
  const objectiveSource = objectiveLine === null
    ? null
    : unquote(OBJECTIVE_LABEL.exec(objectiveLine)?.[1]?.trim() ?? objectiveLine)
  const objective = objectiveSource === null ? null : unquote(objectiveSource).replace(/\s+/gu, ' ').trim()

  const primaryBullets = primary.flatMap(section => bulletLines(section.lines))
    .filter(line => !OBJECTIVE_LABEL.test(line))
  const criticalBullets = critical.flatMap(section => [...bulletLines(section.lines), ...paragraphLines(section.lines)])
    .filter(line => CONSTRAINT.test(line))
  const invariants = unique(
    [...primaryBullets, ...criticalBullets]
      .flatMap(line => splitForLimit(line, limits.maxItemBytes)),
    objective,
    Number.POSITIVE_INFINITY,
  )

  const deliverables = unique(
    pending.flatMap(section => {
      const bullets = bulletLines(section.lines)
      return bullets.length > 0 ? bullets : paragraphLines(section.lines)
    }).flatMap(line => splitForLimit(line, limits.maxItemBytes)),
    null,
    Number.POSITIVE_INFINITY,
  )

  return { objective, invariants, deliverables }
}

/**
 * Find the latest non-empty compaction summary and extract a draft from it.
 * Returns undefined when the log has no usable summary.
 */
export function bootstrapFromEvents(
  events: readonly CompactionSummaryEvent[],
  limits: Pick<CharterLimits, 'maxObjectiveBytes' | 'maxItemBytes'>,
): BootstrapExtraction | undefined {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index]
    if (event === undefined || event.type !== 'compaction/summary') continue
    const parsed = compactionSummaryDataSchema.safeParse(event.data)
    if (!parsed.success) continue
    const text = parsed.data.summary.map(part => part.text).join('\n').trim()
    if (text.length === 0) continue
    const draft = bootstrapFromSummary(text, limits)
    if (draft.objective === null && draft.invariants.length === 0 && draft.deliverables.length === 0) continue
    return {
      draft,
      source: {
        summarySeq: event.seq,
        at: event.time,
        ...(parsed.data.shadowedTokenCount === undefined
          ? {}
          : { shadowedTokens: parsed.data.shadowedTokenCount }),
      },
    }
  }
  return undefined
}
