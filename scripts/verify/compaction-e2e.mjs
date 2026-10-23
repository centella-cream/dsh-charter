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
 * The check also requires a matching `charter_read` standing result recorded
 * after the latest compaction: a tool read from before the compaction cannot
 * witness the post-compaction request, so it is not evidence for the PASS. It
 * also detects the failure mode "charter silently dropped by compaction" and
 * reports whether the compaction summary leaked the charter text (which would
 * make the test less conclusive, not necessarily wrong).
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
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { evaluateCompactionTranscript, parseTranscript } from './compaction-checks.mjs'

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

function formatBytes(value) {
  return `${Buffer.byteLength(value, 'utf8')} B`
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
  const parsed = parseTranscript(source)
  if (!parsed.complete) {
    const details = parsed.errors
      .map(error => `line ${error.line}: ${error.message}`)
      .join('\n')
    fail(`transcript is corrupt; refusing to evaluate skipped lines:\n${details}`)
  }
  if (parsed.tornTailLine !== undefined) {
    console.error(`compaction-e2e: ignoring torn tail line ${parsed.tornTailLine} (incomplete append)`)
  }
  return parsed.events
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
  // The decisive sequence is "charter committed, then compaction START, then a
  // request". A charter applied after the start cannot prove survival.
  const latestCommit = Array.isArray(record.history) ? record.history.at(-1) : undefined
  const committedAt = typeof latestCommit?.at === 'number' ? latestCommit.at : undefined

  const report = evaluateCompactionTranscript({
    events,
    current: { ...current, committedAt },
    marker: args.marker,
    promptPrefix: CHARTER_PROMPT_PREFIX,
  })
  const { promptText, ...charterReport } = report.charter
  const compactReport = {
    sessionId,
    logFile,
    storageFile: charterRecord.file,
    events: events.length,
    charter: charterReport,
    ...report,
    charter: {
      ...charterReport,
      bytes: report.charter.bytes,
      promptText,
    },
  }

  if (args.json) {
    console.log(JSON.stringify(compactReport, null, 2))
  } else {
    const stamp = time => new Date(time).toISOString()
    const latestCompaction = report.latestCompaction
    console.log('dsh-charter compaction end-to-end\n')
    console.log(`session        ${sessionId}`)
    console.log(`transcript     ${logFile} (${events.length} events)`)
    console.log(`storage        ${charterRecord.file}`)
    console.log(
      `charter        revision ${report.charter.revision}, ${formatBytes(promptText)}, `
      + `committed ${committedAt === undefined ? '(unknown)' : new Date(committedAt).toISOString()}, `
      + `objective ${report.charter.objective === null ? '(none)' : JSON.stringify(preview(report.charter.objective))}`,
    )
    console.log(`promptDigest   ${report.charter.promptDigest || '(empty)'}`)
    console.log(`compactions    ${report.compactions.length === 0 ? 'none' : ''}`)
    for (const compaction of report.compactions) {
      console.log(
        `  seq ${compaction.endSeq}  ${stamp(compaction.time)}  `
        + `source ${compaction.sourceCommandId === undefined ? 'automatic' : compaction.sourceCommandId}`
        + `${compaction.ok ? '' : `  INVALID/FAILED (${compaction.error ?? 'missing start/summary'})`}`,
      )
    }
    console.log(`requests       ${report.requests} logged request header(s)`
      + `; charter_read tool ${report.charterReadTool ? 'registered' : 'NOT registered'}`)
    console.log(`runtime ctx    ${report.runtimeContexts.length} snapshot(s)`)
    for (const snapshot of report.runtimeContexts) {
      const afterCompaction = latestCompaction !== null && snapshot.seq > latestCompaction.endSeq
      const charter = snapshot.charterText === undefined
        ? '-'
        : `charter ${formatBytes(snapshot.charterText)}${afterCompaction ? ', after latest compaction' : ''}`
      console.log(`  seq ${snapshot.seq}  ${stamp(snapshot.time)}  sections [${snapshot.sectionNames.join(', ')}]  ${charter}`)
    }
    console.log('')
    for (const line of report.verdictLines) {
      console.log(`  ${line.state}  ${line.label}${line.detail === undefined ? '' : ` — ${line.detail}`}`)
    }
    console.log('')
    const prefix = report.status === 'pass'
      ? 'PASS'
      : report.status === 'blocked' ? 'BLOCKED' : report.status === 'wait' ? 'WAIT' : 'FAIL'
    console.log(`result: ${prefix} — ${report.statusReason}.`)
    if (report.status === 'pass') {
      for (const warning of report.verification.warnings) console.log(`warning: ${warning}`)
    }
    if (report.status === 'fail') {
      for (const failure of report.verification.failures) console.log(`  evidence: ${failure}`)
    }
  }

  process.exit(report.exitCode)
}

main()
