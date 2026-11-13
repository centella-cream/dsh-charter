import { createHash } from 'node:crypto'

const RUNTIME_CONTEXT = 'runtime-context'
const CHARTER_SECTION = 'charter:standing'
const SURFACE_TYPES = new Set(['system/message', 'developer/message', 'user/message', 'assistant/message', 'tool/result'])

function textOfContent(content) {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content.filter(part => part?.type === 'text' && typeof part.text === 'string').map(part => part.text).join('\n')
}

function digest(value) {
  return createHash('sha256').update(value, 'utf8').digest('hex')
}

function finite(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function usageFromChunks(stream) {
  if (!Array.isArray(stream)) return undefined
  let usage
  for (const record of stream) {
    if (record?.type === 'chunk' && record.chunk?.type === 'usage') usage = record.chunk.usage
  }
  return usage
}

function usageFields(usage) {
  if (usage === undefined || usage === null) return undefined
  const input = finite(usage.inputTokens)
  const output = finite(usage.outputTokens)
  if (input === undefined || output === undefined) return undefined
  const cacheRead = finite(usage.cacheReadTokens)
  const cacheWrite = finite(usage.cacheWriteTokens)
  const total = finite(usage.totalTokens)
  const reasoning = finite(usage.reasoningTokens)
  return {
    uncachedInputTokens: input,
    outputTokens: output,
    cacheReadTokens: cacheRead,
    cacheWriteTokens: cacheWrite,
    totalTokens: total,
    reasoningTokens: reasoning,
    cacheReported: cacheRead !== undefined && cacheWrite !== undefined,
  }
}

/**
 * Reconstruct the currently model-visible runtime-context snapshots.
 *
 * The transcript is append-only, so physical events are not current context.
 * A surface replacement shadows every covered event seq; runtime snapshots in
 * those ranges are historical, not active. The current compaction epoch starts
 * after the last completed compaction.
 */
export function summarizeRuntimeSnapshots(events) {
  const ordered = [...events].sort((left, right) => left.seq - right.seq)
  const shadowed = []
  let lastCompactionSeq
  let epoch = 0
  for (const event of ordered) {
    const op = event.surfaceOp
    if (SURFACE_TYPES.has(event.type) && op !== null && typeof op === 'object' && op.op === 'replace') {
      if (Number.isInteger(op.startSeq) && Number.isInteger(op.endSeq)) shadowed.push([op.startSeq, op.endSeq])
    }
    if (event.type === 'compaction/end') {
      lastCompactionSeq = event.seq
      epoch += 1
    }
  }
  const isShadowed = seq => shadowed.some(([start, end]) => seq >= start && seq <= end)
  const snapshots = []
  for (const event of ordered) {
    if (event.type !== 'user/message' || event.data?.source?.kind !== RUNTIME_CONTEXT) continue
    const text = textOfContent(event.data?.content)
    const sections = Array.isArray(event.data?.source?.sections) ? event.data.source.sections : []
    const charter = sections.find(section => section?.name === CHARTER_SECTION)
    snapshots.push({
      seq: event.seq,
      bytes: Buffer.byteLength(text, 'utf8'),
      digest: digest(text),
      sections: sections
        .filter(section => typeof section?.name === 'string')
        .map(section => ({
          name: section.name,
          bytes: Buffer.byteLength(String(section.text ?? ''), 'utf8'),
          digest: digest(String(section.text ?? '')),
        })),
      charterBytes: charter === undefined ? 0 : Buffer.byteLength(String(charter.text ?? ''), 'utf8'),
      charterDigest: charter === undefined ? undefined : digest(String(charter.text ?? '')),
      shadowed: isShadowed(event.seq),
      currentEpoch: lastCompactionSeq === undefined || event.seq > lastCompactionSeq,
    })
  }
  const active = snapshots.filter(snapshot => !snapshot.shadowed)
  const historical = snapshots
  const current = snapshots.filter(snapshot => snapshot.currentEpoch)
  return {
    historical,
    active,
    currentEpoch: current,
    shadowedCount: snapshots.length - active.length,
    compactionEpoch: epoch,
    lastCompactionSeq: lastCompactionSeq ?? null,
  }
}

/** Count section changes between adjacent active snapshots. */
export function summarizeSectionChurn(activeSnapshots) {
  const byName = new Map()
  for (let index = 1; index < activeSnapshots.length; index += 1) {
    const previous = new Map(activeSnapshots[index - 1].sections.map(section => [section.name, section]))
    const current = new Map(activeSnapshots[index].sections.map(section => [section.name, section]))
    const names = new Set([...previous.keys(), ...current.keys()])
    for (const name of names) {
      const before = previous.get(name)
      const after = current.get(name)
      if (before?.digest === after?.digest) continue
      const entry = byName.get(name) ?? { name, changes: 0, bytes: 0 }
      entry.changes += 1
      entry.bytes += after?.bytes ?? 0
      byName.set(name, entry)
    }
  }
  return {
    events: activeSnapshots.length <= 1 ? 0 : [...byName.values()].reduce((sum, entry) => sum + entry.changes, 0),
    sections: [...byName.values()].sort((left, right) => right.changes - left.changes || left.name.localeCompare(right.name)),
  }
}

function summarizeSnapshotSet(snapshots, selector = () => true) {
  const selected = snapshots.filter(selector)
  const charter = selected.filter(snapshot => snapshot.charterDigest !== undefined)
  return {
    snapshots: selected.length,
    distinct: new Set(selected.map(snapshot => snapshot.digest)).size,
    totalBytes: selected.reduce((sum, snapshot) => sum + snapshot.bytes, 0),
    maxBytes: selected.reduce((max, snapshot) => Math.max(max, snapshot.bytes), 0),
    charterSnapshots: charter.length,
    charterDistinct: new Set(charter.map(snapshot => snapshot.charterDigest)).size,
    charterTotalBytes: charter.reduce((sum, snapshot) => sum + snapshot.charterBytes, 0),
    charterMaxBytes: charter.reduce((max, snapshot) => Math.max(max, snapshot.charterBytes), 0),
    latest: selected.at(-1) ?? null,
    latestCharter: charter.at(-1) ?? null,
  }
}

/** Pair charter_read calls/results without relying on a reusable callId alone. */
export function summarizeCharterRead(events, activeSnapshots = []) {
  const ordered = [...events].sort((left, right) => left.seq - right.seq)
  const calls = []
  const callsBySeq = new Map()
  for (const event of ordered) {
    if (event.type !== 'tool/call' || event.data?.name !== 'charter_read') continue
    const call = {
      seq: event.seq,
      turn: event.data?.turn,
      step: event.data?.step,
      callId: event.data?.callId,
      view: 'standing',
      resultBytes: undefined,
      resultDigest: undefined,
      activeCharterBeforeCall: false,
      activeCharterSeq: null,
      activeCharterDigest: null,
      redundantReadCandidate: false,
    }
    try {
      const parsed = typeof event.data.arguments === 'string' ? JSON.parse(event.data.arguments) : event.data.arguments
      if (parsed?.view === 'all') call.view = 'all'
      else if (parsed?.view !== undefined && parsed?.view !== 'standing') call.view = String(parsed.view)
    } catch { call.view = 'invalid-arguments' }
    calls.push(call)
    callsBySeq.set(call.seq, call)
  }
  const legacyKeys = new Map()
  for (const call of calls) {
    const key = `${call.turn}:${call.step}:${call.callId}`
    const list = legacyKeys.get(key) ?? []
    list.push(call)
    legacyKeys.set(key, list)
  }
  let ambiguous = 0
  let unattributedResults = 0
  let paired = 0
  const ambiguousCallSeqs = new Set()
  for (const event of ordered) {
    if (event.type !== 'tool/result') continue
    const data = event.data ?? {}
    const message = data.message ?? {}
    const topHas = Object.hasOwn(event, 'sourceEventSeqs')
    const dataHas = Object.hasOwn(data, 'sourceEventSeqs')
    const source = topHas ? event.sourceEventSeqs : dataHas ? data.sourceEventSeqs : undefined
    const modern = topHas || dataHas
    let matched
    if (modern) {
      if (!Array.isArray(source) || source.length === 0) { unattributedResults += 1; continue }
      const referenced = source.map(seq => callsBySeq.get(seq))
      const charterRefs = referenced.filter(call => call !== undefined)
      if (charterRefs.length === 0) continue
      if (referenced.length !== 1 || charterRefs.length !== 1) {
        for (const seq of source) if (callsBySeq.has(seq)) ambiguousCallSeqs.add(seq)
        ambiguous += 1
        continue
      }
      matched = charterRefs[0]
    } else {
      const key = `${data.turn}:${data.step}:${message.toolCallId ?? message.source?.callId}`
      const candidates = legacyKeys.get(key) ?? []
      if (candidates.length === 0) continue
      if (candidates.length > 1) {
        for (const candidate of candidates) ambiguousCallSeqs.add(candidate.seq)
        ambiguous += 1
        continue
      }
      if (candidates[0].resultBytes !== undefined) { ambiguousCallSeqs.add(candidates[0].seq); ambiguous += 1; continue }
      matched = candidates[0]
    }
    if (matched === undefined || matched.resultBytes !== undefined) {
      ambiguous += 1
      continue
    }
    const resultText = textOfContent(message.content)
    matched.resultBytes = Buffer.byteLength(resultText, 'utf8')
    matched.resultDigest = digest(resultText)
    const activeCharter = [...activeSnapshots]
      .filter(snapshot => snapshot.seq < matched.seq && snapshot.charterDigest !== undefined)
      .at(-1)
    matched.activeCharterBeforeCall = activeCharter !== undefined
    matched.activeCharterSeq = activeCharter?.seq ?? null
    matched.activeCharterDigest = activeCharter?.charterDigest ?? null
    matched.redundantReadCandidate = activeCharter !== undefined && matched.view === 'standing'
    paired += 1
  }
  const results = calls.filter(call => call.resultBytes !== undefined)
  return {
    calls: calls.length,
    redundantReads: calls.filter(call => call.redundantReadCandidate === true).length,
    paired,
    unpairedCalls: calls.filter(call => call.resultBytes === undefined && !ambiguousCallSeqs.has(call.seq)).length,
    unattributedResults,
    ambiguous,
    views: calls.map(call => call.view),
    resultBytes: results.reduce((sum, call) => sum + call.resultBytes, 0),
    callDetails: calls,
  }
}

/**
 * Parse a charter_propose tool result. Both tools render text as JSON, so classify
 * by the actual `{ok, message}` envelope instead of matching serialized text.
 * @param {string} text
 * @returns {{ outcome: 'accepted'|'rejected'|'unclassified', message: string }}
 */
export function parseCharterProposeResult(text) {
  let parsed
  try { parsed = JSON.parse(text) } catch { parsed = undefined }
  if (parsed !== null && typeof parsed === 'object') {
    if (parsed.ok === true) return { outcome: 'accepted', message: '' }
    if (parsed.ok === false) {
      return { outcome: 'rejected', message: typeof parsed.message === 'string' ? parsed.message : String(text) }
    }
  }
  // Backward-compatible fallback for an unenveloped rejection message.
  if (text.includes('charter_propose requires must reference current active deliverables:')) {
    return { outcome: 'rejected', message: text }
  }
  return { outcome: 'unclassified', message: text }
}

/** Strip JSON/message punctuation that older raw results may append after a value. */
function cleanRequirementValue(value) {
  return value.trim().replace(/["'}\]\s]+$/u, '')
}

/** Split the rejection values out of the actionable Host message. */
export function classifyRequireRejection(message) {
  const marker = 'charter_propose requires must reference current active deliverables:'
  const markerAt = message.indexOf(marker)
  if (markerAt < 0) return { displayKeyRejects: 0, unknownIdRejects: 0, values: [], other: true }
  const values = message.slice(markerAt + marker.length)
    .split(',')
    .map(cleanRequirementValue)
    .filter(Boolean)
  let displayKeyRejects = 0
  let unknownIdRejects = 0
  for (const value of values) {
    if (/^D\d+$/u.test(value)) displayKeyRejects += 1
    else unknownIdRejects += 1
  }
  return { displayKeyRejects, unknownIdRejects, values, other: false }
}

/**
 * Summarize charter_propose calls and results without runtime instrumentation.
 * @param {readonly any[]} events
 * @returns {any}
 */
export function summarizeCharterPropose(events) {
  const ordered = [...events].sort((left, right) => left.seq - right.seq)
  const calls = []
  const callsBySeq = new Map()
  for (const event of ordered) {
    if (event.type !== 'tool/call' || event.data?.name !== 'charter_propose') continue
    let parsed
    try {
      parsed = typeof event.data.arguments === 'string' ? JSON.parse(event.data.arguments) : event.data.arguments
    } catch { parsed = undefined }
    const call = {
      seq: event.seq,
      turn: event.data?.turn,
      step: event.data?.step,
      callId: event.data?.callId,
      items: Array.isArray(parsed?.items) ? parsed.items.length : 0,
      outcome: 'unclassified',
      message: '',
      rejected: false,
      resultBytes: undefined,
      displayKeyRejects: 0,
      unknownIdRejects: 0,
      rejectionValues: [],
    }
    calls.push(call)
    callsBySeq.set(call.seq, call)
  }
  const legacyKeys = new Map()
  for (const call of calls) {
    const key = `${call.turn}:${call.step}:${call.callId}`
    const list = legacyKeys.get(key) ?? []
    list.push(call)
    legacyKeys.set(key, list)
  }
  for (const event of ordered) {
    if (event.type !== 'tool/result') continue
    const data = event.data ?? {}
    const message = data.message ?? {}
    const source = Object.hasOwn(event, 'sourceEventSeqs') ? event.sourceEventSeqs : Object.hasOwn(data, 'sourceEventSeqs') ? data.sourceEventSeqs : undefined
    let matched
    if (Array.isArray(source) && source.length > 0) {
      const refs = source.map(seq => callsBySeq.get(seq)).filter(Boolean)
      if (refs.length !== 1 || source.length !== 1) continue
      matched = refs[0]
    } else {
      const key = `${data.turn}:${data.step}:${message.toolCallId ?? message.source?.callId}`
      const candidates = legacyKeys.get(key) ?? []
      if (candidates.length !== 1) continue
      matched = candidates[0]
    }
    if (matched === undefined || matched.resultBytes !== undefined) continue
    const resultText = textOfContent(message.content)
    matched.resultBytes = Buffer.byteLength(resultText, 'utf8')
    const result = parseCharterProposeResult(resultText)
    matched.outcome = result.outcome
    matched.message = result.message
    matched.rejected = result.outcome === 'rejected'
    if (matched.rejected) {
      const classified = classifyRequireRejection(result.message)
      matched.displayKeyRejects = classified.displayKeyRejects
      matched.unknownIdRejects = classified.unknownIdRejects
      matched.rejectionValues = classified.values
    }
  }
  const results = calls.filter(call => call.resultBytes !== undefined)
  const rejected = results.filter(call => call.rejected)
  return {
    calls: calls.length,
    paired: results.length,
    accepted: results.filter(call => call.outcome === 'accepted').length,
    rejected: rejected.length,
    displayKeyRejects: rejected.reduce((sum, call) => sum + call.displayKeyRejects, 0),
    unknownIdRejects: rejected.reduce((sum, call) => sum + call.unknownIdRejects, 0),
    otherRejects: rejected.filter(call => !call.message.includes('charter_propose requires must reference current active deliverables:')).length,
    unclassified: results.filter(call => call.outcome === 'unclassified').length,
    resultBytes: results.reduce((sum, call) => sum + call.resultBytes, 0),
    rejectionValues: [...new Set(rejected.flatMap(call => call.rejectionValues))].slice(0, 20),
    callDetails: calls,
  }
}

/** Summarize model attempts, usage, runtime snapshots, and charter_read traffic. */
export function summarizeTraffic(events) {
  const ordered = [...events].filter(event => event.type !== 'session').sort((left, right) => left.seq - right.seq)
  const runtime = summarizeRuntimeSnapshots(ordered)
  const read = summarizeCharterRead(ordered, runtime.active)
  const propose = summarizeCharterPropose(ordered)
  const attempts = []
  const groups = new Map()
  let stepCount = 0
  let turnCount = 0
  let provider
  let model
  let contextWindow
  let toolSchemaDigest
  let toolSchemaBytes
  let charterReadToolBytes
  let toolCount
  let latestRuntimeDigest
  let latestCharterDigest
  let compactionEpoch = 0

  for (const event of ordered) {
    if (event.type === 'step/start') stepCount += 1
    if (event.type === 'turn/start' || event.type === 'turn/begin') turnCount += 1
    if (event.type === 'compaction/end') compactionEpoch += 1
    if (event.type === 'request/context') {
      provider = event.data?.provider ?? provider
      model = event.data?.model ?? model
      contextWindow = finite(event.data?.contextWindow) ?? contextWindow
    }
    if (event.type === 'request/header') {
      const config = event.data?.header?.config
      provider = config?.provider ?? provider
      model = config?.model ?? model
      const tools = event.data?.header?.tools
      if (Array.isArray(tools)) {
        const serialized = JSON.stringify(tools)
        toolCount = tools.length
        toolSchemaDigest = digest(serialized)
        toolSchemaBytes = Buffer.byteLength(serialized, 'utf8')
        const charterTool = tools.find(tool => tool?.name === 'charter_read')
        charterReadToolBytes = charterTool === undefined ? 0 : Buffer.byteLength(JSON.stringify(charterTool), 'utf8')
      }
    }
    if (event.type === 'user/message' && event.data?.source?.kind === RUNTIME_CONTEXT) {
      const active = runtime.active.find(snapshot => snapshot.seq === event.seq)
      if (active !== undefined) {
        latestRuntimeDigest = active.digest
        latestCharterDigest = active.charterDigest ?? null
      }
    }
    if (event.type !== 'assistant/message' && event.type !== 'assistant/attempt') continue
    const attempt = event.type === 'assistant/attempt'
    const usage = usageFields(attempt ? usageFromChunks(event.data?.stream) : event.data?.usage)
    const kind = attempt ? 'failed' : 'message'
    const key = `${event.data?.turn}:${event.data?.step}`
    const group = groups.get(key) ?? []
    group.push(event.seq)
    groups.set(key, group)
    attempts.push({
      seq: event.seq,
      turn: event.data?.turn,
      step: event.data?.step,
      attempt: group.length,
      kind,
      provider: provider ?? null,
      model: model ?? null,
      contextWindow: contextWindow ?? null,
      toolCount: toolCount ?? null,
      toolSchemaDigest: toolSchemaDigest ?? null,
      toolSchemaBytes: toolSchemaBytes ?? null,
      charterReadToolBytes: charterReadToolBytes ?? null,
      runtimeDigest: latestRuntimeDigest ?? null,
      charterDigest: latestCharterDigest ?? null,
      compactionEpoch,
      usage: usage ?? null,
    })
  }

  const successfulMessages = attempts.filter(attempt => attempt.kind === 'message').length
  const failedAttempts = attempts.filter(attempt => attempt.kind === 'failed').length
  const retries = [...groups.values()].reduce((sum, group) => sum + Math.max(0, group.length - 1), 0)
  const usageRows = attempts.flatMap(attempt => attempt.usage === null ? [] : [attempt.usage])
  const unreportedAttempts = attempts.length - usageRows.length
  const cacheReportedAttempts = usageRows.filter(usage => usage.cacheReported).length
  const billedInputTokensComplete = attempts.length > 0 && cacheReportedAttempts === attempts.length
  const usageTotals = usageRows.reduce((total, usage) => {
    total.uncachedInputTokens += usage.uncachedInputTokens
    total.outputTokens += usage.outputTokens
    if (usage.totalTokens !== undefined) total.totalTokens += usage.totalTokens
    if (usage.reasoningTokens !== undefined) total.reasoningTokens += usage.reasoningTokens
    if (usage.cacheReported) {
      total.billedInputTokens = (total.billedInputTokens ?? 0) + usage.uncachedInputTokens + usage.cacheReadTokens + usage.cacheWriteTokens
      total.cacheReadTokens += usage.cacheReadTokens
      total.cacheWriteTokens += usage.cacheWriteTokens
      total.cacheReportedAttempts += 1
    }
    return total
  }, {
    uncachedInputTokens: 0,
    billedInputTokens: null,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    reasoningTokens: 0,
    cacheReportedAttempts: 0,
  })
  usageTotals.billedInputTokensComplete = billedInputTokensComplete
  const warnings = []
  const notes = []
  if (runtime.historical.length > runtime.active.length) {
    notes.push(`historical runtime snapshots shadowed by surface replacement: ${runtime.shadowedCount}`)
  }
  const activeCharterSnapshots = runtime.active.filter(snapshot => snapshot.charterDigest !== undefined)
  const activeCharterSurfaces = activeCharterSnapshots.map(snapshot => ({ seq: snapshot.seq, bytes: snapshot.charterBytes, digest: snapshot.charterDigest }))
  if (activeCharterSnapshots.length > 1) {
    const distinct = new Set(activeCharterSnapshots.map(snapshot => snapshot.charterDigest)).size
    warnings.push(`active-surface charter snapshots repeated: ${activeCharterSnapshots.length} (${distinct} distinct)`)
  }
  if (propose.rejected > 0) notes.push(`charter_propose rejected: ${propose.rejected}; display-key=${propose.displayKeyRejects}; unknown-id=${propose.unknownIdRejects}`)
  if (propose.displayKeyRejects > 0) warnings.push(`charter_propose used display keys as require references: ${propose.displayKeyRejects}`)
  const totalRuntimeBytes = runtime.active.reduce((sum, snapshot) => sum + snapshot.bytes, 0)
  const historicalRuntimeBytes = runtime.historical.reduce((sum, snapshot) => sum + snapshot.bytes, 0)
  const activeCharterBytes = runtime.active.reduce((sum, snapshot) => sum + snapshot.charterBytes, 0)
  if (read.calls > 0) notes.push(`charter_read calls: ${read.calls}; redundant candidates: ${read.redundantReads}`)
  if (read.redundantReads > 0) warnings.push(`charter_read ran while an active charter snapshot existed: ${read.redundantReads}`)
  if (read.unattributedResults > 0) warnings.push(`unattributed tool results: ${read.unattributedResults}`)
  if (read.ambiguous > 0) warnings.push(`ambiguous charter_read pairings: ${read.ambiguous}`)
  const missingUsage = attempts.filter(attempt => attempt.usage === null).length
  if (unreportedAttempts > 0) warnings.push(`model attempts without reported usage: ${unreportedAttempts}`)
  if (read.unpairedCalls > 0) warnings.push(`charter_read calls without a paired result: ${read.unpairedCalls}`)

  return {
    events: ordered.length,
    seqRange: ordered.length === 0 ? null : { from: ordered[0].seq, to: ordered.at(-1).seq },
    incomplete: false,
    turns: turnCount,
    steps: stepCount,
    runtime: {
      historical: summarizeSnapshotSet(runtime.historical),
      activeSurface: summarizeSnapshotSet(runtime.active),
      currentCompactionEpochAll: summarizeSnapshotSet(runtime.currentEpoch),
      currentCompactionEpochActive: summarizeSnapshotSet(runtime.currentEpoch.filter(snapshot => !snapshot.shadowed)),
      shadowed: runtime.shadowedCount,
      compactionEpoch: runtime.compactionEpoch,
      historicalPayloadBytes: historicalRuntimeBytes,
      activeSurfacePayloadBytes: totalRuntimeBytes,
      duplicateBytes: runtime.active.length === 0 ? 0 : totalRuntimeBytes - runtime.active.at(-1).bytes,
      duplicateRate: totalRuntimeBytes === 0 ? 0 : (totalRuntimeBytes - runtime.active.at(-1).bytes) / totalRuntimeBytes,
      activeCharterSurfaces,
      activeCharterPayloadBytes: activeCharterBytes,
      activeLatestCharterBytes: runtime.active.filter(snapshot => snapshot.charterDigest !== undefined).at(-1)?.charterBytes ?? 0,
      charterDuplicateBytes: activeCharterBytes - (runtime.active.filter(snapshot => snapshot.charterDigest !== undefined).at(-1)?.charterBytes ?? 0),
      sectionChurn: summarizeSectionChurn(runtime.active),
      sectionChurnAll: summarizeSectionChurn(runtime.historical),
    },
    toolSchema: {
      count: toolCount ?? null,
      bytes: toolSchemaBytes ?? null,
      digest: toolSchemaDigest ?? null,
      charterReadToolBytes: charterReadToolBytes ?? null,
    },
    modelAttempts: {
      total: attempts.length,
      successfulMessages,
      failedAttempts,
      retries,
      missingUsage,
      unreportedAttempts,
      usage: usageTotals,
      attempts,
    },
    charterRead: read,
    charterPropose: propose,
    warnings,
    notes,
  }
}
