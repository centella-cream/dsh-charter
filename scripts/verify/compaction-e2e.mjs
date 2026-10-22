#!/usr/bin/env node
/**
 * Verify the real-model compaction path for one live DSH Session.
 *
 * The plugin injects the user-authored charter as a user-role runtime context
 * (`charter:standing`), which DSH persists into the Session transcript as a
 * `user/message` event with `source.kind === "runtime-context"`. A compaction
 * replaces older transcript spans with a `compact-checkpoint` message, so the
 * decisive proof that a charter survived compaction is:
 *
 *   1. the latest runtime-context snapshot sits after the latest
 *      `compaction/end`;
 *   2. that snapshot still contains `charter:standing`;
 *   3. its text is byte-identical to the storage authority's `promptText`, and
 *      its SHA-256 equals the committed `promptDigest`.
 *
 * The same check also detects the failure mode "charter silently dropped by
 * compaction" and reports whether the compaction summary leaked the charter
 * text (which would make the test less conclusive, not necessarily wrong).
 *
 * Usage:
 *   node scripts/verify/compaction-e2e.mjs [--session <id>] [--home <dir>]
 *        [--marker <text>] [--json]
 *
 * Defaults to the current session (`DSH_SESSION_ID`) and `DSH_HOME`/`~/.dsh`.
 * Exit codes: 0 pass, 1 regression, 2 charter not established yet,
 * 3 waiting for a request after the compaction.
 *
 * Dev-only script: it reads the local DSH transcript and needs the `zstd`
 * binary for compressed session logs. It is not part of the npm package.
 */
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { compactStandingItem, evaluateCompactionEvidence } from './compaction-checks.mjs'

const CHARTER_CONTEXT_NAME = 'charter:standing'
const CHARTER_PROMPT_PREFIX = 'Current user-authored session charter.'
const MAX_BUFFER = 1024 * 1024 * 1024

function fail(message) {
  console.error(`compaction-e2e: ${message}`)
  process.exit(1)
}

function parseArgs(argv) {
  const args = { json: false }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--json') {
      args.json = true
      continue
    }
    if (arg === '--help' || arg === '-h') {
      console.log(readFileSync(new URL(import.meta.url), 'utf8').split('*/')[0])
      process.exit(0)
    }
    if (arg === '--session' || arg === '--home' || arg === '--marker' || arg === '--store') {
      const value = argv[index + 1]
      if (value === undefined) fail(`missing value for ${arg}`)
      args[arg.slice(2)] = value
      index += 1
      continue
    }
    fail(`unknown argument: ${arg}`)
  }
  return args
}

function sha256Text(value) {
  return `sha256:${createHash('sha256').update(value, 'utf8').digest('hex')}`
}

function findSessionLog(home, sessionId) {
  const sessionsRoot = join(home, 'sessions')
  if (!existsSync(sessionsRoot)) fail(`no sessions directory at ${sessionsRoot}`)
  for (const project of readdirSync(sessionsRoot)) {
    const directory = join(sessionsRoot, project, sessionId)
    if (!existsSync(directory)) continue
    for (const name of readdirSync(directory)) {
      if (name === 'session.v4.jsonl.zstd' || name === 'session.v4.jsonl') {
        return join(directory, name)
      }
    }
  }
  fail(`no session transcript found for ${sessionId} under ${sessionsRoot}`)
}

function assertCharterRecordShape(parsed, file) {
  const record = parsed?.record
  const current = record?.current
  const valid = parsed?.version === 1
    && record?.recordSchemaVersion === 1
    && typeof current === 'object' && current !== null
    && typeof current.revision === 'number'
    && typeof current.promptText === 'string'
    && typeof current.promptDigest === 'string'
    && Array.isArray(current.items)
    && Array.isArray(record.history)
  if (!valid) {
    fail(`unrecognized charter record shape in ${file}; refusing to infer evidence from it`)
  }
  return record
}

function readCharterRecord(file) {
  let parsed
  try {
    parsed = JSON.parse(readFileSync(file, 'utf8'))
  } catch (error) {
    fail(`cannot parse charter storage record ${file}: ${error instanceof Error ? error.message : String(error)}`)
  }
  return assertCharterRecordShape(parsed, file)
}

function findCharterRecord(home, sessionId, override) {
  if (override !== undefined) {
    if (!existsSync(override)) fail(`charter storage record not found at ${override}`)
    return { file: override, record: readCharterRecord(override) }
  }
  const storagesRoot = join(home, 'storages')
  if (!existsSync(storagesRoot)) {
    fail(`no storages directory at ${storagesRoot}; pass --store <record-file> for a non-default layout`)
  }
  const scanned = []
  for (const domain of readdirSync(storagesRoot)) {
    const candidate = join(storagesRoot, domain, 'sessions', `${sessionId}.json`)
    scanned.push(candidate)
    if (!existsSync(candidate)) continue
    return { file: candidate, record: readCharterRecord(candidate) }
  }
  fail(
    `no charter storage record for ${sessionId}.\n`
    + `This script supports the JSON storage backend layout `
    + `$DSH_HOME/storages/<domain>/sessions/<sessionId>.json (pass --store <file> otherwise).\n`
    + `Scanned:\n  ${scanned.join('\n  ')}`,
  )
}

function readTranscript(path) {
  if (path.endsWith('.jsonl')) {
    return readFileSync(path, 'utf8')
  }
  const binary = process.env.ZSTD ?? 'zstd'
  const result = spawnSync(binary, ['-dc', path], { maxBuffer: MAX_BUFFER })
  if (result.error !== undefined) {
    fail(`cannot run "${binary} -dc": ${result.error.message}. Install zstd or set ZSTD.`)
  }
  if (result.status !== 0) {
    fail(`"${binary} -dc" failed: ${result.stderr?.toString().trim() ?? 'unknown error'}`)
  }
  return result.stdout.toString('utf8')
}

function parseEvents(source) {
  const events = []
  for (const line of source.split('\n')) {
    if (line.trim() === '') continue
    try {
      events.push(JSON.parse(line))
    } catch {
      // A torn tail line is possible while the Session is being appended to.
    }
  }
  return events
}

function messageText(content) {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content
    .filter(part => part?.type === 'text' && typeof part.text === 'string')
    .map(part => part.text)
    .join('\n')
}

function preview(value, length = 88) {
  const text = value.replace(/\s+/gu, ' ').trim()
  return text.length > length ? `${text.slice(0, length)}...` : text
}

function formatBytes(value) {
  return `${Buffer.byteLength(value, 'utf8')} B`
}

function main() {
  const args = parseArgs(process.argv.slice(2))
  const sessionId = args.session ?? process.env.DSH_SESSION_ID
  if (sessionId === undefined) fail('no Session: pass --session <id> or set DSH_SESSION_ID')
  const home = args.home ?? process.env.DSH_HOME ?? join(homedir(), '.dsh')

  const logFile = findSessionLog(home, sessionId)
  const events = parseEvents(readTranscript(logFile))
  const charterRecord = findCharterRecord(home, sessionId, args.store)
  if (charterRecord === undefined) fail(`no charter storage record for ${sessionId} (was the plugin ever loaded?)`)
  const record = charterRecord.record
  const current = record.current
  const promptText = typeof current.promptText === 'string' ? current.promptText : ''
  const promptDigest = typeof current.promptDigest === 'string' ? current.promptDigest : ''
  const charterReady = current.revision > 0 && promptText !== ''
  // The decisive sequence is "charter committed, then compaction, then a
  // request". A charter applied after the compaction cannot prove survival.
  const latestCommit = Array.isArray(record.history) ? record.history.at(-1) : undefined
  const charterCommittedAt = typeof latestCommit?.at === 'number' ? latestCommit.at : undefined

  const compactions = events
    .filter(event => event.type === 'compaction/end')
    .map(event => ({
      seq: event.seq,
      time: event.time,
      id: event.data?.compactionId,
      sourceCommandId: event.data?.sourceCommandId,
    }))
  const latestCompaction = compactions.at(-1)

  const runtimeContexts = events
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
  const latestRuntime = runtimeContexts.at(-1)

  const checkpoints = events
    .filter(event => event.type === 'user/message' && event.data?.source?.kind === 'compact-checkpoint')
    .map(event => ({
      seq: event.seq,
      time: event.time,
      compactionId: event.data.source.compactionId,
      text: messageText(event.data.content),
    }))

  const toolHeaders = events
    .filter(event => event.type === 'request/header')
    .map(event => ({
      seq: event.seq,
      tools: Array.isArray(event.data?.header?.tools) ? event.data.header.tools.map(tool => tool?.name) : [],
    }))
  const latestHeader = toolHeaders.at(-1)

  const toolNames = new Map(
    events
      .filter(event => event.type === 'tool/call')
      .map(event => [event.data?.callId, event.data?.name]),
  )
  const standingItems = current.items
    .filter(item => item.review === 'accepted' && item.lifecycle === 'current')
    .map(item => compactStandingItem(item))
  const charterReadResults = events
    .filter(event => event.type === 'tool/result'
      && toolNames.get(event.data?.message?.toolCallId ?? event.data?.toolCallId) === 'charter_read')
    .map(event => {
      const text = messageText(event.data.message?.content)
      try {
        const view = JSON.parse(text)
        if (view === null || typeof view !== 'object' || !Array.isArray(view.items)) {
          return { seq: event.seq, invalid: true }
        }
        return {
          seq: event.seq,
          invalid: false,
          revision: view.revision,
          objective: view.objective,
          items: view.items,
        }
      } catch {
        return { seq: event.seq, invalid: true }
      }
    })
  const latestCharterRead = charterReadResults.at(-1)

  const promptSnapshots = events
    .filter(event => event.type === 'system/message')
    .map(event => messageText(event.data.message?.content))
  // The charter body must never enter a system-role prompt. Check the rendered
  // body plus each distinctive user-authored signal, so a split/encoded leak is
  // still caught while ordinary short words do not cause false positives.
  const systemPromptSignals = [
    promptText,
    ...(typeof current.objective?.current?.text === 'string' && current.objective.current.text.trim().length >= 8
      ? [current.objective.current.text]
      : []),
    ...standingItems
      .map(item => item.text)
      .filter(text => typeof text === 'string' && text.trim().length >= 16),
  ].filter(text => text !== '')
  const systemPromptClean = charterReady
    ? !promptSnapshots.some(text => text.includes(CHARTER_PROMPT_PREFIX)
      || systemPromptSignals.some(signal => text.includes(signal)))
    : undefined
  const charterReadCalled = [...toolNames.values()].includes('charter_read')
  const charterReadStanding = charterReady && charterReadResults.some(result =>
    result.invalid === false
    && result.revision === current.revision
    && result.objective === (current.objective?.current?.text ?? null)
    && JSON.stringify(result.items) === JSON.stringify(standingItems))
    ? true
    : undefined

  const injected = latestRuntime?.charterText !== undefined
  const digestMatch = injected
    && promptText !== ''
    && latestRuntime.charterText === promptText
    && sha256Text(latestRuntime.charterText) === promptDigest
  const injectedAfterCompaction = latestCompaction === undefined
    ? undefined
    : latestRuntime !== undefined && latestRuntime.seq > latestCompaction.seq
  const charterPredatesCompaction = latestCompaction === undefined || charterCommittedAt === undefined
    ? undefined
    : charterCommittedAt < latestCompaction.time
  const survivesCompaction = charterPredatesCompaction === true && injectedAfterCompaction === true
    && injected && digestMatch

  const latestCheckpoint = latestCompaction === undefined
    ? checkpoints.at(-1)
    : [...checkpoints].reverse().find(checkpoint => checkpoint.seq > latestCompaction.seq)
  const checkpointLeaksCharter = latestCheckpoint !== undefined && charterReady
    && (latestCheckpoint.text.includes(promptText)
      || (args.marker !== undefined && latestCheckpoint.text.includes(args.marker)))
  const markerPresent = args.marker === undefined ? undefined : promptText.includes(args.marker)

  const verification = evaluateCompactionEvidence({
    charterReady: charterReady === true,
    survivesCompaction,
    systemPromptClean: charterReady === true ? systemPromptClean : undefined,
    charterReadCalled,
    charterReadStanding,
    checkpointLeaksCharter,
  })

  const report = {
    sessionId,
    logFile,
    storageFile: charterRecord.file,
    events: events.length,
    charter: {
      revision: current.revision,
      committedAt: charterCommittedAt === undefined ? null : charterCommittedAt,
      bytes: formatBytes(promptText),
      promptDigest,
      objective: current.objective?.current?.text ?? null,
      pending: current.items?.filter(item => item.review === 'pending').length ?? 0,
    },
    compactions,
    runtimeContexts,
    checkpoints: checkpoints.map(checkpoint => ({
      seq: checkpoint.seq,
      time: checkpoint.time,
      compactionId: checkpoint.compactionId,
      bytes: formatBytes(checkpoint.text),
    })),
    requests: toolHeaders.length,
    charterReadTool: latestHeader?.tools.includes('charter_read') ?? false,
    charterRead: latestCharterRead ?? null,
    systemPromptClean,
    charterReadCalled,
    verification,
    verdicts: {
      charterReady,
      injected,
      digestMatch,
      injectedAfterCompaction,
      charterPredatesCompaction,
      survivesCompaction,
      checkpointLeaksCharter,
      markerPresent,
      charterReadStanding,
      systemPromptClean,
    },
  }

  if (args.json) {
    console.log(JSON.stringify(report, null, 2))
  } else {
    const stamp = time => new Date(time).toISOString()
    console.log('dsh-charter compaction end-to-end\n')
    console.log(`session        ${sessionId}`)
    console.log(`transcript     ${logFile} (${events.length} events)`)
    console.log(`storage        ${charterRecord.file}`)
    console.log(
      `charter        revision ${current.revision}, ${formatBytes(promptText)}, `
      + `committed ${charterCommittedAt === undefined ? '(unknown)' : new Date(charterCommittedAt).toISOString()}, `
      + `objective ${current.objective?.current?.text === undefined ? '(none)' : JSON.stringify(preview(current.objective.current.text))}`,
    )
    console.log(`promptDigest   ${promptDigest || '(empty)'}`)
    console.log(`compactions    ${compactions.length === 0 ? 'none' : ''}`)
    for (const compaction of compactions) {
      console.log(
        `  seq ${compaction.seq}  ${stamp(compaction.time)}  `
        + `source ${compaction.sourceCommandId === undefined ? 'automatic' : compaction.sourceCommandId}`,
      )
    }
    console.log(`requests       ${toolHeaders.length} logged request header(s)`
      + `; charter_read tool ${report.charterReadTool ? 'registered' : 'NOT registered'}`)
    console.log(`runtime ctx    ${runtimeContexts.length} snapshot(s)`)
    for (const snapshot of runtimeContexts) {
      const afterCompaction = latestCompaction !== undefined && snapshot.seq > latestCompaction.seq
      const charter = snapshot.charterText === undefined
        ? '-'
        : `charter ${formatBytes(snapshot.charterText)}${afterCompaction ? ', after latest compaction' : ''}`
      console.log(`  seq ${snapshot.seq}  ${stamp(snapshot.time)}  sections [${snapshot.sectionNames.join(', ')}]  ${charter}`)
    }
    console.log('')
    const verdict = (ok, label, detail) => {
      const state = ok === true ? 'PASS' : ok === false ? 'FAIL' : 'WAIT'
      console.log(`  ${state}  ${label}${detail === undefined ? '' : ` — ${detail}`}`)
    }
    verdict(charterReady, 'charter established',
      charterReady ? undefined : 'open the Charter tab and apply an objective or item first')
    if (charterReady) {
      verdict(injected, 'latest runtime context carries charter:standing',
        injected ? undefined : 'send a message, then run this check again')
      verdict(digestMatch, 'injected text matches storage authority and promptDigest',
        injected ? (digestMatch ? undefined : 'text/digest mismatch') : undefined)
    }
    if (args.marker !== undefined && charterReady) {
      verdict(markerPresent, `marker ${JSON.stringify(args.marker)} is part of the charter`)
    }
    if (charterReady) {
      verdict(systemPromptClean, 'system prompt carries no charter body',
        systemPromptClean ? undefined : 'a system-prompt snapshot contains the charter text')
      if (charterReadCalled) {
        verdict(charterReadStanding, 'charter_read standing view matches the storage revision/objective',
          charterReadStanding === true
            ? undefined
            : latestCharterRead === undefined || latestCharterRead.invalid === true
              ? 'no valid standing charter_read result in this transcript yet'
              : `latest read is revision ${latestCharterRead.revision} (${latestCharterRead.items?.length ?? 0} standing items); re-read after the final revision`)
      } else {
        console.log('  INFO  charter_read standing view was not called in this transcript; not required for PASS')
      }
    }
    if (charterReady && latestCompaction !== undefined && charterPredatesCompaction === false) {
      verdict(undefined, 'charter survives compaction',
        'the current charter was committed after the latest compaction; run /compact, then send a message')
    } else if (charterReady && latestCompaction !== undefined) {
      if (injectedAfterCompaction !== true) {
        verdict(undefined, 'charter survives compaction', 'waiting for a request after the latest compaction')
      } else if (survivesCompaction) {
        verdict(true, 'charter survives compaction',
          `snapshot seq ${latestRuntime.seq} > compaction seq ${latestCompaction.seq}`)
      } else {
        verdict(false, 'charter survives compaction',
          'post-compaction runtime context is missing the authoritative charter')
      }
    } else if (charterReady && latestCompaction === undefined) {
      verdict(undefined, 'charter survives compaction', 'no compaction recorded yet; run /compact')
    }
    if (charterReady) {
      const leaks = checkpointLeaksCharter === true
      verdict(true, 'compaction summary does not carry the charter text',
        leaks ? 'WARNING: summary contains the charter/marker; surviving text may come from the summary' : undefined)
    }
    console.log('')
    if (!charterReady) {
      console.log('result: BLOCKED — establish the charter first (Charter tab, then Apply).')
    } else if (latestCompaction === undefined) {
      console.log('result: WAIT — no compaction recorded yet; run /compact in the Session.')
    } else if (charterPredatesCompaction !== true) {
      console.log('result: WAIT — compact again now that the charter is committed, then send a message.')
    } else if (injectedAfterCompaction !== true) {
      console.log('result: WAIT — send a message after the compaction, then run this check again.')
    } else if (verification.ok) {
      console.log('result: PASS — the real compaction kept the charter in the next request and all evidence checks passed.')
      for (const warning of verification.warnings) console.log(`warning: ${warning}`)
    } else {
      console.log('result: FAIL — compaction evidence did not pass; see verdicts.')
      for (const failure of verification.failures) console.log(`  evidence: ${failure}`)
    }
  }

  if (!charterReady) process.exit(2)
  if (latestCompaction === undefined
    || charterPredatesCompaction !== true
    || injectedAfterCompaction !== true) process.exit(3)
  process.exit(verification.ok ? 0 : 1)
}

main()
