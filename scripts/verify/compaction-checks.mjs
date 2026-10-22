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
