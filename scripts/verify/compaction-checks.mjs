import { createHash } from 'node:crypto'

/**
 * Pure success/failure evaluation for the real-model compaction checker.
 *
 * Kept separate from the transcript reader so fixtures can exercise the exact
 * exit criteria without a live Session.
 */

/**
 * Mirror the Host `charter_read standing` projection exactly. The Host returns
 * only kind/text/verification/progress for standing items; using full debug
 * fields here would make the checker reject a correct implementation.
 */
export function compactStandingItem(item) {
  // Accept both the current compact tool result (`verification` is a state
  // string) and an older Host's debug-shaped result (`verification` is an
  // object). Extra debug fields never change the working-set semantics.
  const verification = typeof item.verification === 'string'
    ? item.verification
    : item.verification?.state
  return {
    kind: item.kind,
    text: item.text,
    verification,
    progress: item.kind === 'deliverable' ? (item.progress ?? null) : null,
  }
}

/**
 * Parse the `arguments` payload of a `tool/call` event into the requested
 * presentation view. A missing/empty argument object means the tool default
 * (`standing`); an explicit non-standing view such as `all` is not valid
 * evidence for the compaction check.
 *
 * @param {string | object | undefined | null} rawArguments
 * @returns {string | undefined}
 */
export function charterReadArgumentsView(rawArguments) {
  if (rawArguments === undefined || rawArguments === null || rawArguments === '') return undefined
  let parsed = rawArguments
  if (typeof parsed === 'string') {
    try {
      parsed = JSON.parse(parsed)
    } catch {
      return 'invalid-arguments'
    }
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return undefined
  const view = parsed.view
  return typeof view === 'string' ? view : undefined
}

/**
 * Authored evidence for one charter_read result: the tool call that produced it
 * must itself be authenticated, ordered after the compaction and the latest
 * runtime-context snapshot, and must request the default/standing view from a
 * non-error result.
 *
 * @param {{
 *   callSeq: number | undefined,
 *   resultSeq: number | undefined,
 *   compactionSeq: number | undefined,
 *   runtimeSeq: number | undefined,
 *   argumentsView: string | undefined,
 *   isError: boolean | undefined,
 * }} evidence
 */
export function isValidCharterReadEvidence(evidence) {
  if (!Number.isFinite(evidence.callSeq) || !Number.isFinite(evidence.resultSeq)) return false
  if (evidence.resultSeq <= evidence.callSeq) return false
  if (evidence.isError === true) return false
  if (evidence.argumentsView !== undefined && evidence.argumentsView !== 'standing') return false
  if (evidence.compactionSeq !== undefined && !(evidence.callSeq > evidence.compactionSeq)) return false
  if (evidence.runtimeSeq !== undefined && !(evidence.callSeq > evidence.runtimeSeq)) return false
  return true
}

/**
 * Keep only charter_read results that were recorded after the latest
 * compaction. A read from before the compaction cannot prove what the
 * post-compaction request carried, so it is not evidence for the PASS.
 *
 * @param {readonly { seq: number }[]} results
 * @param {number | undefined} latestCompactionSeq
 */
export function postCompactionCharterReads(results, latestCompactionSeq) {
  if (latestCompactionSeq === undefined) return [...results]
  return results.filter(result => typeof result.seq === 'number' && result.seq > latestCompactionSeq)
}

/**
 * @param {{
 *   charterReady: boolean | undefined,
 *   survivesCompaction: boolean | undefined,
 *   systemPromptClean: boolean | undefined,
 *   charterReadStanding: boolean | undefined,
 *   checkpointLeaksCharter: boolean | undefined,
 * }} evidence
 */
export function evaluateCompactionEvidence(evidence) {
  const failures = []
  const warnings = []
  if (evidence.charterReady !== true) {
    failures.push('charter is not established')
  } else {
    if (evidence.survivesCompaction !== true) {
      failures.push('the post-compaction request does not carry the authoritative charter')
    }
    if (evidence.systemPromptClean !== true) {
      failures.push('a system-role prompt snapshot carries the charter body')
    }
    // Required: a matching charter_read standing result recorded after the
    // latest compaction. The post-compaction transcript is the only place that
    // can show the tool read the current revision together with the surviving
    // request; a missing read is a failure, not an informational note.
    if (evidence.charterReadStanding !== true) {
      failures.push(
        'a post-compaction charter_read standing result is required and must match the current revision/objective',
      )
    }
  }
  if (evidence.checkpointLeaksCharter === true) {
    warnings.push('the compaction summary carries the charter or marker text; survival evidence is weaker')
  }
  return { ok: failures.length === 0, failures, warnings }
}

// ---------------------------------------------------------------------------
// Pure transcript evaluation
//
// The CLI wrapper only does I/O and formatting. Everything that decides
// PASS/FAIL/WAIT is computed here from a plain event array plus the storage
// authority, so fixtures can exercise the exact exit criteria offline.
// ---------------------------------------------------------------------------

const CHARTER_CONTEXT_NAME = 'charter:standing'

/** Extract text from a message content payload (string or text parts). */
export function messageText(content) {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content
    .filter(part => part?.type === 'text' && typeof part.text === 'string')
    .map(part => part.text)
    .join('\n')
}

/** `sha256:<hex>` digest of a UTF-8 string. */
export function sha256Text(value) {
  // `node:crypto` is fine here: this module only runs in the verification
  // scripts and Vitest, never in the browser bundle.
  return `sha256:${createHash('sha256').update(value, 'utf8').digest('hex')}`
}

/**
 * A compaction lifecycle is only evidence when the same id has a start, a
 * summary, and an end without an error. A failed end is recorded for display
 * but never selected as the latest successful compaction.
 */
export function readCompactionLifecycles(events) {
  const ordered = [...events].sort((left, right) => left.seq - right.seq)
  const starts = new Map()
  const summaries = new Map()
  const ends = []
  for (const event of ordered) {
    const id = event.data?.compactionId
    if (typeof id !== 'string') continue
    if (event.type === 'compaction/start') starts.set(id, event)
    else if (event.type === 'compaction/summary') summaries.set(id, event)
    else if (event.type === 'compaction/end') ends.push(event)
  }
  const compactions = ends.map(end => {
    const id = end.data.compactionId
    const start = starts.get(id)
    const summary = summaries.get(id)
    const error = end.data?.error ?? end.data?.failure
    const ok = start !== undefined && summary !== undefined && error === undefined
      && end.data?.ok !== false && end.data?.failed !== true
    return {
      id,
      sortSeq: start?.seq ?? end.seq,
      startSeq: start?.seq,
      startTime: start?.time,
      summarySeq: summary?.seq,
      endSeq: end.seq,
      endTime: end.time,
      sourceCommandId: start?.data?.sourceCommandId ?? end.data?.sourceCommandId,
      ok,
      error: error === undefined ? undefined : String(error),
    }
  })
  const successful = compactions.filter(compaction => compaction.ok)
  return { compactions, successful, latestSuccessful: successful.at(-1) }
}

/**
 * Pair every `tool/result` with the `tool/call` that produced it. Modern
 * transcripts expose top-level `sourceEventSeqs`; legacy transcripts fall back
 * to (turn, step, callId) plus event order — never to the last same callId
 * globally, which breaks when an id repeats across turns.
 */
export function resolveCharterReadCalls(events) {
  const ordered = [...events].sort((left, right) => left.seq - right.seq)
  const calls = ordered
    .filter(event => event.type === 'tool/call')
    .map(event => ({
      seq: event.seq,
      turn: event.data?.turn,
      step: event.data?.step,
      callId: event.data?.callId,
      name: event.data?.name,
      arguments: event.data?.arguments,
    }))
  const bySeq = new Map(calls.map(call => [call.seq, call]))
  const results = []
  for (const event of ordered) {
    if (event.type !== 'tool/result') continue
    const data = event.data ?? {}
    const message = data.message ?? {}
    const sourceEventSeqs = Array.isArray(event.sourceEventSeqs)
      ? event.sourceEventSeqs
      : Array.isArray(data.sourceEventSeqs)
        ? data.sourceEventSeqs
        : undefined
    let call
    let resolution
    if (sourceEventSeqs !== undefined) {
      const matches = sourceEventSeqs
        .map(seq => bySeq.get(seq))
        .filter(candidate => candidate?.name === 'charter_read')
      call = matches.length === 1 ? matches[0] : undefined
      resolution = matches.length === 1
        ? 'sourceEventSeqs'
        : matches.length === 0 ? 'sourceEventSeqs-no-charter-read' : 'sourceEventSeqs-ambiguous'
    } else {
      const callId = message.toolCallId ?? data.toolCallId
      const turn = data.turn
      const step = data.step
      const sameIdentity = candidate => candidate.callId === callId
        && candidate.seq < event.seq
        && (turn === undefined || candidate.turn === undefined || candidate.turn === turn)
        && (step === undefined || candidate.step === undefined || candidate.step === step)
      call = calls.filter(sameIdentity).at(-1)
      resolution = call === undefined
        ? 'callId-no-charter-read'
        : call.turn === turn && call.step === step ? 'callId-turn-step' : 'callId-seq'
    }
    if (call?.name !== 'charter_read') continue
    const base = {
      seq: event.seq,
      callSeq: call.seq,
      callId: call.callId,
      resolution,
      argumentsView: charterReadArgumentsView(call.arguments),
      isError: message.isError === true,
    }
    const text = messageText(message.content)
    try {
      const view = JSON.parse(text)
      if (view === null || typeof view !== 'object' || !Array.isArray(view.items)) {
        results.push({ ...base, invalid: true })
      } else {
        results.push({
          ...base,
          invalid: false,
          revision: view.revision,
          objective: view.objective,
          items: view.items,
        })
      }
    } catch {
      results.push({ ...base, invalid: true })
    }
  }
  return { calls, results }
}

function countedRequestActivity(events, seq) {
  return events.filter(event => event.seq > seq
    && (event.type === 'step/start'
      || event.type === 'assistant/message'
      || event.type === 'tool/call'
      || (event.type === 'user/message' && event.data?.source?.kind === 'runtime-context')))
}

/**
 * Decide the compaction outcome from a plain event array plus the storage
 * authority. Returns the complete JSON report, human verdict lines, exit code,
 * and separate failures/warnings.
 *
 * Requirements enforced here:
 * - only a start+summary+no-error-end lifecycle is compaction evidence;
 * - the charter must be committed before the compaction START (not its end);
 * - the checkpoint is associated by compactionId and leaks warn regardless of
 *   its position relative to the end;
 * - post-compaction request execution without a runtime-context snapshot is a
 *   FAIL, while no post-compaction activity at all is a WAIT;
 * - the charter_read call itself is authenticated and ordered after the
 *   successful compaction and the latest post-compaction runtime snapshot.
 */
export function evaluateCompactionTranscript({ events, current, marker, promptPrefix }) {
  const order = [...events].sort((left, right) => left.seq - right.seq)
  const revision = typeof current?.revision === 'number' ? current.revision : 0
  const promptText = typeof current?.promptText === 'string' ? current.promptText : ''
  const promptDigest = typeof current?.promptDigest === 'string' ? current.promptDigest : ''
  const charterReady = revision > 0 && promptText !== ''
  const standingItems = Array.isArray(current?.items)
    ? current.items
      .filter(item => item.review === 'accepted' && item.lifecycle === 'current')
      .map(item => compactStandingItem(item))
    : []
  const committedAt = typeof current?.committedAt === 'number' ? current.committedAt : undefined

  const { compactions, latestSuccessful } = readCompactionLifecycles(order)
  const latestCompaction = latestSuccessful

  const runtimeContexts = order
    .filter(event => event.type === 'user/message' && event.data?.source?.kind === 'runtime-context')
    .map(event => {
      const sections = Array.isArray(event.data.source.sections) ? event.data.source.sections : []
      const charter = sections.find(section => section?.name === CHARTER_CONTEXT_NAME)
      return {
        seq: event.seq,
        time: event.time,
        sectionNames: sections.map(section => section?.name ?? '?'),
        charterText: typeof charter?.text === 'string' ? charter.text : undefined,
      }
    })
  const latestRuntime = latestCompaction === undefined
    ? runtimeContexts.at(-1)
    : [...runtimeContexts].reverse().find(snapshot => snapshot.seq > latestCompaction.endSeq)

  const checkpoints = order
    .filter(event => event.type === 'user/message' && event.data?.source?.kind === 'compact-checkpoint')
    .map(event => ({
      seq: event.seq,
      time: event.time,
      compactionId: event.data.source.compactionId,
      text: messageText(event.data.content),
    }))
  const latestCheckpoint = latestCompaction === undefined
    ? checkpoints.at(-1)
    : checkpoints.filter(checkpoint => checkpoint.compactionId === latestCompaction.id).at(-1)
    ?? [...checkpoints].reverse().find(checkpoint => checkpoint.seq > latestCompaction.endSeq)
  const checkpointLeaksCharter = latestCheckpoint !== undefined && charterReady
    && (latestCheckpoint.text.includes(promptText)
      || (marker !== undefined && latestCheckpoint.text.includes(marker)))

  const prompts = order
    .filter(event => event.type === 'request/header')
    .map(event => ({
      seq: event.seq,
      tools: Array.isArray(event.data?.header?.tools)
        ? event.data.header.tools.map(tool => tool?.name)
        : [],
    }))
  const latestHeader = prompts.at(-1)

  const { calls, results: charterReadResults } = resolveCharterReadCalls(order)
  const charterReadCalls = calls.filter(call => call.name === 'charter_read')
  const latestRuntimeSeq = latestRuntime?.seq
  const postCompactionCalls = latestCompaction === undefined
    ? charterReadCalls
    : charterReadCalls.filter(call => call.seq > latestCompaction.endSeq)
  const authenticatedReads = charterReadResults.filter(result => isValidCharterReadEvidence({
    callSeq: result.callSeq,
    resultSeq: result.seq,
    compactionSeq: latestCompaction?.endSeq,
    runtimeSeq: latestRuntimeSeq,
    argumentsView: result.argumentsView,
    isError: result.isError,
  }))
  const matchedReads = charterReady
    ? authenticatedReads.filter(result =>
        result.invalid === false
        && result.revision === revision
        && result.objective === (current.objective?.current?.text ?? null)
        && JSON.stringify(result.items.map(item => compactStandingItem(item)))
          === JSON.stringify(standingItems))
    : []
  const latestCharterRead = authenticatedReads.at(-1)
  const latestMatchedRead = matchedReads.at(-1)

  const systemPromptSignals = [
    promptText,
    ...(typeof current?.objective?.current?.text === 'string'
      && current.objective.current.text.trim().length >= 8
      ? [current.objective.current.text]
      : []),
    ...standingItems
      .map(item => item.text)
      .filter(text => typeof text === 'string' && text.trim().length >= 16),
  ].filter(text => text !== '')
  const systemPrompts = order
    .filter(event => event.type === 'system/message')
    .map(event => messageText(event.data.message?.content))
  const systemPromptClean = charterReady
    ? !systemPrompts.some(text => text.includes(promptPrefix ?? '')
      || systemPromptSignals.some(signal => text.includes(signal)))
    : undefined

  const injected = latestRuntime?.charterText !== undefined
  const digestMatch = injected
    && promptText !== ''
    && latestRuntime.charterText === promptText
    && sha256Text(latestRuntime.charterText) === promptDigest
  const injectedAfterCompaction = latestCompaction === undefined
    ? undefined
    : latestRuntime !== undefined && latestRuntime.seq > latestCompaction.endSeq
  // The charter must predate the compaction START: a commit between start and
  // end (or after the end) cannot prove the compaction preserved it.
  const charterPredatesCompaction = latestCompaction === undefined || committedAt === undefined
    ? undefined
    : committedAt < latestCompaction.startTime
  const survivesCompaction = charterPredatesCompaction === true
    && injectedAfterCompaction === true
    && injected && digestMatch

  const activity = latestCompaction === undefined
    ? []
    : countedRequestActivity(order, latestCompaction.endSeq)
  const postCompactionExecutionWithoutSnapshot = latestCompaction !== undefined
    && activity.length > 0
    && latestRuntime === undefined

  const charterReadCalled = postCompactionCalls.length > 0
  const charterReadStanding = charterReady && matchedReads.length > 0 ? true : undefined

  const verification = evaluateCompactionEvidence({
    charterReady,
    survivesCompaction,
    systemPromptClean,
    charterReadStanding,
    checkpointLeaksCharter,
  })
  if (postCompactionExecutionWithoutSnapshot) {
    verification.ok = false
    verification.failures = [
      ...verification.failures,
      'a post-compaction request executed without a new runtime-context snapshot',
    ]
  }

  const verdicts = {
    charterReady,
    injected,
    digestMatch,
    injectedAfterCompaction,
    charterPredatesCompaction,
    survivesCompaction,
    checkpointLeaksCharter,
    markerPresent: marker === undefined ? undefined : promptText.includes(marker),
    charterReadStanding,
    systemPromptClean,
    postCompactionExecutionWithoutSnapshot,
  }

  const verdictLines = []
  const verdict = (ok, label, detail) => {
    const state = ok === true ? 'PASS' : ok === false ? 'FAIL' : 'WAIT'
    verdictLines.push({ state, label, detail })
  }
  verdict(charterReady, 'charter established',
    charterReady ? undefined : 'open the Charter tab and apply an objective or item first')
  if (charterReady) {
    const one = latestCompaction === undefined
      ? { state: 'WAIT', label: 'charter survives compaction', detail: 'no successful compaction recorded yet; run /compact' }
      : charterPredatesCompaction !== true
        ? {
            state: 'WAIT',
            label: 'charter survives compaction',
            detail: 'the current charter was not committed before the latest successful compaction started; run /compact again',
          }
        : postCompactionExecutionWithoutSnapshot
          ? {
              state: 'FAIL',
              label: 'charter survives compaction',
              detail: 'a request executed after the compaction without a runtime-context snapshot',
            }
          : injectedAfterCompaction !== true
            ? {
                state: 'WAIT',
                label: 'charter survives compaction',
                detail: 'no post-compaction runtime-context snapshot yet; send a message',
              }
            : survivesCompaction
              ? {
                  state: 'PASS',
                  label: 'charter survives compaction',
                  detail: `snapshot seq ${latestRuntime.seq} > compaction end seq ${latestCompaction.endSeq}`,
                }
              : {
                  state: 'FAIL',
                  label: 'charter survives compaction',
                  detail: 'post-compaction runtime context is missing the authoritative charter',
                }
    verdictLines.push(one)
    verdict(injected, 'latest runtime context carries charter:standing',
      injected ? undefined : 'send a message, then run this check again')
    verdict(digestMatch, 'injected text matches storage authority and promptDigest',
      injected ? (digestMatch ? undefined : 'text/digest mismatch') : undefined)
    if (marker !== undefined) {
      verdict(verdicts.markerPresent, `marker ${JSON.stringify(marker)} is part of the charter`)
    }
    verdict(systemPromptClean, 'system prompt carries no charter body',
      systemPromptClean ? undefined : 'a system-prompt snapshot contains the charter text')
    verdict(charterReadStanding, 'authenticated post-compaction charter_read standing view matches the storage revision/objective',
      charterReadStanding === true
        ? undefined
        : latestCompaction === undefined
          ? 'run /compact, then call charter_read to record post-compaction evidence'
          : !charterReadCalled
            ? 'call charter_read after the latest successful compaction; no post-compaction call is recorded'
            : latestCharterRead === undefined
              ? 'no authenticated post-compaction charter_read result: its unique call (via sourceEventSeqs or turn/step/callId) must follow the successful compaction and the latest runtime-context snapshot, request standing/default, and return a non-error result'
              : latestMatchedRead === undefined
                ? `latest authenticated read is revision ${latestCharterRead.revision} (${latestCharterRead.items?.length ?? 0} standing items); re-read after the final revision`
                : undefined)
    const leaks = checkpointLeaksCharter === true
    verdict(true, 'compaction summary does not carry the charter text',
      leaks ? 'WARNING: summary contains the charter/marker; surviving text may come from the summary' : undefined)
  }

  let status
  let statusReason
  if (!charterReady) {
    status = 'blocked'
    statusReason = 'establish the charter first (Charter tab, then Apply)'
  } else if (latestCompaction === undefined) {
    status = 'wait'
    statusReason = 'no successful compaction lifecycle recorded yet; run /compact in the Session'
  } else if (charterPredatesCompaction !== true) {
    status = 'wait'
    statusReason = 'the charter was not committed before the latest successful compaction started; run /compact again'
  } else if (verification.ok) {
    status = 'pass'
    statusReason = 'the real compaction kept the charter in the next request and all evidence checks passed'
  } else {
    status = 'fail'
    statusReason = 'compaction evidence did not pass; see verdicts'
  }
  const exitCode = status === 'blocked' ? 2 : status === 'wait' ? 3 : status === 'pass' ? 0 : 1

  return {
    status,
    statusReason,
    exitCode,
    charter: {
      revision,
      committedAt: committedAt ?? null,
      promptText,
      bytes: new TextEncoder().encode(promptText).byteLength,
      promptDigest,
      objective: current?.objective?.current?.text ?? null,
      pending: Array.isArray(current?.items)
        ? current.items.filter(item => item.review === 'pending').length
        : 0,
    },
    compactions: compactions.map(compaction => ({
      id: compaction.id,
      seq: compaction.endSeq,
      time: compaction.endTime,
      startSeq: compaction.startSeq,
      startTime: compaction.startTime,
      summarySeq: compaction.summarySeq,
      endSeq: compaction.endSeq,
      ok: compaction.ok,
      error: compaction.error,
      sourceCommandId: compaction.sourceCommandId,
    })),
    latestCompaction: latestCompaction === undefined
      ? null
      : {
          id: latestCompaction.id,
          startSeq: latestCompaction.startSeq,
          startTime: latestCompaction.startTime,
          summarySeq: latestCompaction.summarySeq,
          endSeq: latestCompaction.endSeq,
          endTime: latestCompaction.endTime,
        },
    runtimeContexts,
    checkpoints: checkpoints.map(checkpoint => ({
      seq: checkpoint.seq,
      time: checkpoint.time,
      compactionId: checkpoint.compactionId,
      bytes: new TextEncoder().encode(checkpoint.text).byteLength,
      leaksCharter: latestCheckpoint !== undefined && checkpoint.seq === latestCheckpoint.seq
        && checkpointLeaksCharter === true,
    })),
    requests: prompts.length,
    charterReadTool: latestHeader?.tools.includes('charter_read') ?? false,
    charterRead: latestCharterRead ?? null,
    postCompactionCharterReads: latestCompaction === undefined
      ? charterReadResults.length
      : charterReadResults.filter(result => result.seq > latestCompaction.endSeq).length,
    authenticatedCharterReads: authenticatedReads.length,
    systemPromptClean,
    charterReadCalled,
    postCompactionActivity: activity.length,
    postCompactionExecutionWithoutSnapshot,
    verdicts,
    verification,
    verdictLines,
  }
}
