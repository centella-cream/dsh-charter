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
  return {
    kind: item.kind,
    text: item.text,
    verification: item.verification?.state,
    progress: item.kind === 'deliverable' ? item.progress : null,
  }
}

/**
 * @param {{
 *   charterReady: boolean | undefined,
 *   survivesCompaction: boolean | undefined,
 *   systemPromptClean: boolean | undefined,
 *   charterReadCalled: boolean,
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
    if (evidence.charterReadCalled && evidence.charterReadStanding !== true) {
      failures.push('charter_read was called but its standing result does not match the current revision/objective')
    }
  }
  if (evidence.checkpointLeaksCharter === true) {
    warnings.push('the compaction summary carries the charter or marker text; survival evidence is weaker')
  }
  return { ok: failures.length === 0, failures, warnings }
}
