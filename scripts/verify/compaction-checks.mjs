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
  // Only truly missing arguments mean "default". null, arrays, primitives,
  // {"view":42}, {"view":null} and parse failures are malformed, not default.
  if (rawArguments === undefined) return undefined
  let parsed = rawArguments
  if (typeof parsed === 'string') {
    try {
      parsed = JSON.parse(parsed)
    } catch {
      return 'invalid-arguments'
    }
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return 'invalid-arguments'
  const view = parsed.view
  if (view === undefined) return undefined
  return typeof view === 'string' ? view : 'invalid-arguments'
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
  return { ok: failures.length === 0, evaluated: true, failures, warnings }
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
 * Compaction evidence requires a single seq-ordered attempt state machine:
 * a start opens an attempt, a summary only attaches to the current open
 * attempt, and an end closes only the current attempt when the id matches.
 * An attempt is successful only when start.seq < summary.seq < end.seq, all
 * three share the compactionId, and the end carries no error. Same-id retries
 * are independent attempts; end-before-start / out-of-order events can never
 * produce a successful compaction.
 */
export function readCompactionLifecycles(events) {
  const ordered = [...events].sort((left, right) => left.seq - right.seq)
  const attempts = []
  let open
  const close = (attempt, end) => {
    attempt.endSeq = end.seq
    attempt.endTime = end.time
    const error = end.data?.error ?? end.data?.failure
    attempt.error = error === undefined ? undefined : String(error)
    const badEnd = error !== undefined || end.data?.ok === false || end.data?.failed === true
    attempt.ok = attempt.startSeq !== undefined
      && attempt.summarySeq !== undefined
      && attempt.startSeq < attempt.summarySeq
      && attempt.summarySeq < attempt.endSeq
      && !badEnd
  }
  for (const event of ordered) {
    const id = event.data?.compactionId
    if (typeof id !== 'string') continue
    if (event.type === 'compaction/start') {
      open = {
        id,
        sortSeq: event.seq,
        startSeq: event.seq,
        startTime: event.time,
        summarySeq: undefined,
        endSeq: undefined,
        endTime: undefined,
        sourceCommandId: event.data?.sourceCommandId,
        error: undefined,
        ok: false,
      }
      attempts.push(open)
      continue
    }
    if (event.type === 'compaction/summary') {
      // Only the current open attempt may take a summary. A stray summary for
      // an older/other id never rewrites history.
      if (open !== undefined && open.id === id && open.summarySeq === undefined) {
        open.summarySeq = event.seq
        open.sortSeq = open.sortSeq
      }
      continue
    }
    if (event.type === 'compaction/end' && open !== undefined && open.id === id) {
      close(open, event)
      open = undefined
    }
    // An end without a matching open attempt is ignored: it cannot close a
    // future attempt, so end-before-start can never become PASS evidence.
  }
  const successful = attempts.filter(attempt => attempt.ok)
  return { compactions: attempts, successful, latestSuccessful: successful.at(-1) }
}

/**
 * Pair every `tool/result` with the `tool/call` that produced it. A modern
 * result must authenticate exactly one producing call through top-level
 * `sourceEventSeqs`; a legacy result (no such field) falls back to
 * (turn, step, callId) plus event order. Failed authentications stay in the
 * returned results for diagnostics but carry `authenticated: false`.
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
    // Preserve the distinction between "absent" (legacy transcript) and
    // "present but malformed" (a modern transcript we must not silently read
    // through the legacy path). Object.hasOwn sees arrays/null/undefined values.
    const topHas = Object.hasOwn(event, 'sourceEventSeqs')
    const dataHas = Object.hasOwn(data, 'sourceEventSeqs')
    const topValue = topHas ? event.sourceEventSeqs : undefined
    const dataValue = dataHas ? data.sourceEventSeqs : undefined
    const modern = topHas || dataHas
    let shapeError
    if (modern && topHas && dataHas) {
      const identical = Array.isArray(topValue) && Array.isArray(dataValue)
        && topValue.length === dataValue.length
        && topValue.every((value, index) => value === dataValue[index])
      if (!identical) shapeError = 'source-event-seqs-mismatch'
    }
    const sourceEventSeqs = topHas ? topValue : dataValue
    if (modern && shapeError === undefined && !Array.isArray(sourceEventSeqs)) {
      shapeError = 'invalid-source-seqs'
    }
    let call
    let resolution
    let authError = shapeError
    if (modern && shapeError === undefined) {
      const validSeqs = sourceEventSeqs.length > 0
        && sourceEventSeqs.every(seq => Number.isInteger(seq) && Number.isFinite(seq) && seq < event.seq)
      const referenced = sourceEventSeqs.map(seq => bySeq.get(seq))
      const rejectedOther = referenced.some(candidate => candidate !== undefined
        && candidate.name !== 'charter_read')
      const charterCalls = referenced.filter(candidate => candidate?.name === 'charter_read')
      const uniqueCharterCalls = [...new Set(charterCalls)]
      if (!validSeqs) {
        authError = 'invalid-source-seqs'
      } else if (referenced.some(candidate => candidate === undefined)) {
        authError = 'source-seqs-missing-call'
      } else if (rejectedOther) {
        authError = 'source-seqs-reference-other-tool'
      } else if (uniqueCharterCalls.length !== 1) {
        authError = uniqueCharterCalls.length === 0 ? 'source-seqs-no-charter-read' : 'source-seqs-ambiguous'
      } else {
        // Modern references are authenticated by identity: every field must be
        // PRESENT and exactly equal; a wildcard match is not evidence.
        const producing = uniqueCharterCalls[0]
        if (producing.callId === undefined || producing.turn === undefined || producing.step === undefined) {
          authError = 'call-identity-missing'
        } else if (message.toolCallId === undefined) {
          authError = 'tool-call-id-missing'
        } else if (message.toolCallId !== producing.callId) {
          authError = 'tool-call-id-mismatch'
        } else if (data.turn === undefined) {
          authError = 'turn-missing'
        } else if (data.turn !== producing.turn) {
          authError = 'turn-mismatch'
        } else if (data.step === undefined) {
          authError = 'step-missing'
        } else if (data.step !== producing.step) {
          authError = 'step-mismatch'
        } else {
          call = producing
          resolution = 'sourceEventSeqs'
        }
      }
    } else if (!modern) {
      // Legacy transcript without the field: pair by identity + event order.
      const callId = message.toolCallId ?? data.toolCallId
      const turn = data.turn
      const step = data.step
      const sameIdentity = candidate => candidate.callId === callId
        && candidate.seq < event.seq
        && (turn === undefined || candidate.turn === undefined || candidate.turn === turn)
        && (step === undefined || candidate.step === undefined || candidate.step === step)
      call = calls.filter(sameIdentity).at(-1)
      if (call?.name !== 'charter_read') call = undefined
      resolution = call === undefined
        ? 'callId-no-charter-read'
        : call.turn === turn && call.step === step ? 'callId-turn-step' : 'callId-seq'
      if (call === undefined) authError = 'no-producing-call'
    }
    if (call === undefined && authError === undefined) continue
    const base = {
      seq: event.seq,
      callSeq: call?.seq,
      callId: call?.callId,
      resolution,
      authenticated: authError === undefined,
      ...(authError === undefined ? {} : { authError }),
      argumentsView: call === undefined ? undefined : charterReadArgumentsView(call.arguments),
      isError: message.isError === true,
    }
    const text = messageText(message.content)
    let view
    try {
      view = JSON.parse(text)
    } catch {
      results.push({ ...base, invalid: true })
      continue
    }
    if (view === null || typeof view !== 'object' || !Array.isArray(view.items)) {
      results.push({ ...base, invalid: true })
      continue
    }
    results.push({
      ...base,
      invalid: false,
      revision: view.revision,
      objective: view.objective,
      items: view.items,
    })
  }
  return { calls, results }
}

/**
 * Parse a JSONL transcript without silently skipping corruption. Only the last
 * non-empty line may be torn, and only when the source does not end with a
 * complete newline (an append was interrupted). Any malformed middle line or a
 * malformed complete final line is a hard error with its line number, so the
 * checker can never PASS on a transcript whose dropped lines might hide the
 * evidence it is looking for.
 */
function plainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

/**
 * Validate the transcript event envelope. A JSON-parseable line is not enough:
 * a non-object, missing/garbage identity fields, an envelope mutation between
 * lines, or a duplicate/out-of-order seq would make the evaluation unsound.
 * The one recognized non-event line is the session metadata header stored as
 * `{"type":"session", ...}` (it has no seq/time/data).
 */
export function eventEnvelopeError(event, previousSeq) {
  if (!plainObject(event)) return 'event is not a JSON object'
  if (typeof event.type !== 'string' || event.type === '') return 'event type is not a non-empty string'
  if (event.type === 'session' && event.seq === undefined) return undefined
  if (!Number.isSafeInteger(event.seq) || event.seq < 0) {
    return 'event seq is not a non-negative safe integer'
  }
  if (previousSeq !== undefined && event.seq <= previousSeq) {
    return 'event seq is not strictly increasing (duplicate or out-of-order)'
  }
  if (typeof event.time !== 'number' || !Number.isFinite(event.time)) {
    return 'event time is not a finite number'
  }
  if (!plainObject(event.data)) return 'event data is not an object'
  return undefined
}

export function parseTranscript(source) {
  const lines = source.split('\n')
  const events = []
  const errors = []
  let finalNonEmpty = -1
  for (let index = 0; index < lines.length; index += 1) {
    if (lines[index].trim() !== '') finalNonEmpty = index
  }
  const endsWithNewline = source.endsWith('\n')
  let tornTailLine
  let previousSeq
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]
    if (line.trim() === '') continue
    let event
    try {
      event = JSON.parse(line)
    } catch (error) {
      const tornAllowed = index === finalNonEmpty && !endsWithNewline
      if (tornAllowed) {
        tornTailLine = index + 1
        continue
      }
      errors.push({
        line: index + 1,
        message: error instanceof Error ? error.message : String(error),
      })
      continue
    }
    const envelopeError = eventEnvelopeError(event, previousSeq)
    if (envelopeError !== undefined) {
      errors.push({ line: index + 1, message: envelopeError })
      continue
    }
    if (event.type !== 'session' || event.seq !== undefined) previousSeq = event.seq
    events.push(event)
  }
  return {
    events,
    errors,
    tornTailLine,
    complete: errors.length === 0,
  }
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
  // Associate the checkpoint by compactionId. A positional fallback is only
  // for legacy transcripts whose checkpoint carries no id at all; a checkpoint
  // explicitly belonging to another (e.g. failed) compaction is never used.
  // Associate checkpoints by the attempt's seq interval, not a global id set:
  // a same-id retry must not inherit an older attempt's checkpoint.
  const checkpointWithin = (checkpoint, attempt) => checkpoint.seq > attempt.startSeq
    && (attempt.endSeq === undefined || checkpoint.seq <= attempt.endSeq)
    && (checkpoint.compactionId === undefined || checkpoint.compactionId === attempt.id)
  const latestCheckpoint = latestCompaction === undefined
    ? [...checkpoints].reverse().find(checkpoint => checkpoint.compactionId === undefined)
    : [...checkpoints].reverse().find(checkpoint => checkpointWithin(checkpoint, latestCompaction))
      ?? [...checkpoints].reverse().find(checkpoint => checkpoint.compactionId === undefined
        && checkpoint.seq > latestCompaction.endSeq)
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
  const authenticatedReads = charterReadResults.filter(result => result.authenticated === true
    && isValidCharterReadEvidence({
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

  // "No request activity after the compaction" is not a failure mode: there is
  // simply nothing to judge yet. Only an executed request without a runtime
  // snapshot is a FAIL.
  const activity = latestCompaction === undefined
    ? []
    : countedRequestActivity(order, latestCompaction.endSeq)
  const noPostCompactionActivity = latestCompaction !== undefined && activity.length === 0
  const postCompactionExecutionWithoutSnapshot = latestCompaction !== undefined
    && activity.length > 0
    && latestRuntime === undefined

  const injected = latestRuntime?.charterText !== undefined
  const digestMatch = injected
    && promptText !== ''
    && latestRuntime.charterText === promptText
    && sha256Text(latestRuntime.charterText) === promptDigest
  const injectedAfterCompaction = noPostCompactionActivity || latestCompaction === undefined
    ? undefined
    : latestRuntime !== undefined && latestRuntime.seq > latestCompaction.endSeq
  // The charter must predate the compaction START: a commit between start and
  // end (or after the end) cannot prove the compaction preserved it.
  const charterPredatesCompaction = latestCompaction === undefined || committedAt === undefined
    ? undefined
    : committedAt < latestCompaction.startTime
  const survivesCompaction = noPostCompactionActivity
    ? undefined
    : charterPredatesCompaction === true && injectedAfterCompaction === true
      && injected && digestMatch
  const effectiveSystemPromptClean = noPostCompactionActivity ? undefined : systemPromptClean

  // A later attempt after the successful evidence must be accounted for: an
  // open attempt means wait; a failed attempt that still landed a checkpoint
  // (summary message) replaced the surface and invalidates the earlier PASS.
  const latestSuccessfulIndex = latestCompaction === undefined
    ? -1
    : compactions.indexOf(latestCompaction)
  const laterAttempts = latestSuccessfulIndex >= 0 ? compactions.slice(latestSuccessfulIndex + 1) : []
  // EVERY later attempt matters: an earlier landed-failed one still replaced the
  // surface even when a newer unlanded/open attempt follows it.
  const attemptLandedCheckpoint = attempt => checkpoints.some(checkpoint => checkpointWithin(checkpoint, attempt))
  let laterOpen = false
  let laterLandedFailed = false
  for (const attempt of laterAttempts) {
    if (attempt.endSeq === undefined) laterOpen = true
    else if (!attempt.ok && attemptLandedCheckpoint(attempt)) laterLandedFailed = true
  }
  const laterCompactionAttempt = laterLandedFailed
    ? 'landed-failed'
    : laterOpen ? 'open' : undefined

  // Pending gates only defer judgment: they must not be reported as evidence
  // failures. Only an evaluated active-evidence check may produce a FAIL.
  const pendingGate = !charterReady
    ? 'blocked'
    : latestCompaction === undefined
      ? 'no-compaction'
      : charterPredatesCompaction !== true
        ? 'charter-not-before-start'
        : laterCompactionAttempt === 'open'
          ? 'open-attempt'
          : noPostCompactionActivity
            ? 'no-activity'
            : undefined
  const gated = pendingGate !== undefined && pendingGate !== 'blocked'
  const charterReadCalled = postCompactionCalls.length > 0
  const charterReadStanding = charterReady && matchedReads.length > 0 ? true : undefined

  const rawVerification = evaluateCompactionEvidence({
    charterReady,
    survivesCompaction: gated ? undefined : survivesCompaction,
    systemPromptClean: gated ? undefined : effectiveSystemPromptClean,
    charterReadStanding: gated ? undefined : charterReadStanding,
    checkpointLeaksCharter,
  })
  let verification
  if (gated) {
    verification = { ok: true, evaluated: false, failures: [], warnings: rawVerification.warnings }
  } else {
    verification = { ...rawVerification, evaluated: true }
    if (postCompactionExecutionWithoutSnapshot) {
      verification.ok = false
      verification.failures = [
        ...verification.failures,
        'a post-compaction request executed without a new runtime-context snapshot',
      ]
    }
    if (laterCompactionAttempt === 'landed-failed') {
      verification.ok = false
      verification.failures = [
        ...verification.failures,
        'a later failed compaction landed a checkpoint after the evidence; re-compact and re-read before claiming survival',
      ]
    }
  }

  const verdicts = {
    charterReady,
    injected: gated ? undefined : injected,
    digestMatch: gated ? undefined : digestMatch,
    injectedAfterCompaction: gated ? undefined : injectedAfterCompaction,
    charterPredatesCompaction,
    survivesCompaction: gated ? undefined : survivesCompaction,
    checkpointLeaksCharter,
    markerPresent: marker === undefined ? undefined : promptText.includes(marker),
    charterReadStanding: gated ? undefined : charterReadStanding,
    systemPromptClean: gated ? undefined : effectiveSystemPromptClean,
    noPostCompactionActivity,
    laterCompactionAttempt,
    pendingGate,
    postCompactionExecutionWithoutSnapshot,
    pendingGate,
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
        : laterCompactionAttempt === 'open'
          ? {
              state: 'WAIT',
              label: 'charter survives compaction',
              detail: 'a later compaction attempt is still open; wait for it to finish and re-check',
            }
          : laterCompactionAttempt === 'landed-failed'
            ? {
                state: 'FAIL',
                label: 'charter survives compaction',
                detail: 'a later failed compaction landed a checkpoint after the evidence; re-compact and re-read',
              }
            : noPostCompactionActivity
              ? {
                  state: 'WAIT',
                  label: 'charter survives compaction',
                  detail: 'no post-compaction request activity yet; send a message',
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
    verdict(verdicts.injected, 'latest runtime context carries charter:standing',
      verdicts.injected === true ? undefined : 'send a message, then run this check again')
    verdict(verdicts.digestMatch, 'injected text matches storage authority and promptDigest',
      verdicts.injected === true
        ? (verdicts.digestMatch === true ? undefined : 'text/digest mismatch')
        : undefined)
    if (marker !== undefined) {
      verdict(verdicts.markerPresent, `marker ${JSON.stringify(marker)} is part of the charter`)
    }
    verdict(verdicts.systemPromptClean, 'system prompt carries no charter body',
      verdicts.systemPromptClean === true ? undefined : 'a system-prompt snapshot contains the charter text')
    verdict(verdicts.charterReadStanding, 'authenticated post-compaction charter_read standing view matches the storage revision/objective',
      verdicts.charterReadStanding === true
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
  if (pendingGate === 'blocked') {
    status = 'blocked'
    statusReason = 'establish the charter first (Charter tab, then Apply)'
  } else if (pendingGate !== undefined) {
    status = 'wait'
    statusReason = pendingGate === 'no-compaction'
      ? 'no successful compaction lifecycle recorded yet; run /compact in the Session'
      : pendingGate === 'charter-not-before-start'
        ? 'the charter was not committed before the latest successful compaction started; run /compact again'
        : pendingGate === 'open-attempt'
          ? 'a later compaction attempt is still open; wait for it to finish and re-check'
          : 'no post-compaction request activity yet; send a message after the compaction'
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
    noPostCompactionActivity,
    laterCompactionAttempt,
    pendingGate,
    postCompactionExecutionWithoutSnapshot,
    verdicts,
    verification,
    verdictLines,
  }
}
