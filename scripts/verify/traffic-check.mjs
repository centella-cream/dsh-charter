#!/usr/bin/env node
/**
 * Read-only traffic/cache observation for one DSH Session.
 *
 * Reports model attempts (including assistant/attempt usage), active-surface
 * runtime snapshots, current compaction epoch, token usage attribution, and
 * charter_read traffic. It never writes to DSH state and is not a release
 * pass/fail gate. Requires `zstd` for compressed logs (override with ZSTD).
 *
 * Usage:
 *   node scripts/verify/traffic-check.mjs --session <id> [--home <DSH_HOME>] [--project <dir>] [--json]
 *   node scripts/verify/traffic-check.mjs --log <session.jsonl[.zstd]> [--session <id>] [--json]
 */
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { parseTranscript } from './compaction-checks.mjs'
import { summarizeTraffic } from './traffic-checks.mjs'

const MAX_BUFFER = 512 * 1024 * 1024
const SESSION_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u
const LOG_NAMES = new Set(['session.v4.jsonl.zstd', 'session.v4.jsonl'])

function fail(message) {
  console.error(`traffic-check: ${message}`)
  process.exit(1)
}

function parseArgs(argv) {
  const args = { json: false }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--json') { args.json = true; continue }
    if (arg === '--help' || arg === '-h') {
      console.log(readFileSync(new URL(import.meta.url), 'utf8').split('*/')[0])
      process.exit(0)
    }
    if (arg === '--session' || arg === '--home' || arg === '--project' || arg === '--log') {
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

function readTranscript(path) {
  if (path.endsWith('.jsonl')) return readFileSync(path, 'utf8')
  const binary = process.env.ZSTD ?? 'zstd'
  const result = spawnSync(binary, ['-dc', path], { maxBuffer: MAX_BUFFER })
  if (result.error !== undefined) fail(`cannot run "${binary} -dc": ${result.error.message}. Install zstd or set ZSTD.`)
  if (result.status !== 0) fail(`"${binary} -dc" failed: ${result.stderr?.toString().trim() ?? 'unknown error'}`)
  return result.stdout.toString('utf8')
}

function findSessionLog(home, sessionId, project) {
  if (!SESSION_ID.test(sessionId)) fail(`unsafe Session id: ${JSON.stringify(sessionId)}`)
  const root = join(home, 'sessions')
  if (!existsSync(root)) fail(`no sessions directory at ${root}`)
  const projects = project === undefined ? readdirSync(root).sort() : [project]
  const matches = []
  for (const name of projects) {
    const candidates = sessionId.startsWith('session-') ? [sessionId] : [sessionId, `session-${sessionId}`]
    for (const candidate of candidates) {
      const directory = join(root, name, candidate)
      if (!existsSync(directory)) continue
      const files = readdirSync(directory).filter(file => LOG_NAMES.has(file))
      if (files.length === 0) continue
      if (files.length > 1) fail(`multiple session logs found for ${candidate}; pass --log`)
      matches.push(join(directory, files[0]))
    }
  }
  if (matches.length === 0) fail(`no session transcript found for ${sessionId} under ${root}`)
  if (matches.length > 1) fail(`session id ${sessionId} appears in multiple projects; pass --project or --log`)
  return matches[0]
}

function main() {
  const args = parseArgs(process.argv.slice(2))
  const home = args.home ?? process.env.DSH_HOME ?? join(homedir(), '.dsh')
  const requestedSession = args.session ?? process.env.DSH_SESSION_ID
  const logFile = args.log ?? (requestedSession === undefined
    ? fail('no Session: pass --session <id>, --log <file>, or set DSH_SESSION_ID')
    : findSessionLog(home, requestedSession, args.project))
  if (!existsSync(logFile)) fail(`session log not found: ${logFile}`)
  const source = readTranscript(logFile)
  const parsed = parseTranscript(source)
  if (!parsed.complete) {
    fail(`transcript is corrupt; refusing to summarize skipped lines: ${JSON.stringify(parsed.errors)}`)
  }
  const header = parsed.events.find(event => event.type === 'session' && typeof event.id === 'string')
  const sessionId = header?.id ?? requestedSession
  if (sessionId === undefined || !SESSION_ID.test(sessionId)) {
    fail(`transcript has no valid Session header id; pass --session only with a matching log`)
  }
  const report = {
    ...summarizeTraffic(parsed.events),
    sessionId,
    logFile,
    transcriptSha256: createHash('sha256').update(source, 'utf8').digest('hex'),
    node: process.version,
    packageVersion: JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')).version,
    incomplete: parsed.tornTailLine !== undefined,
  }
  if (parsed.tornTailLine !== undefined) {
    report.warnings = [...report.warnings, `torn tail at line ${parsed.tornTailLine}; totals may omit the latest append`]
  }
  if (args.json) {
    console.log(JSON.stringify(report, null, 2))
    return
  }
  console.log(`traffic-check: ${sessionId}`)
  console.log(`  log: ${logFile}`)
  console.log(`  transcript: sha256:${report.transcriptSha256}${report.incomplete ? ' (incomplete: torn tail)' : ''}`)
  console.log(`  events: ${report.events}, turns: ${report.turns}, steps: ${report.steps}`)
  console.log(`  model attempts: ${report.modelAttempts.total} requests, ${report.modelAttempts.successfulMessages} messages, ${report.modelAttempts.failedAttempts} failed/aborted, ${report.modelAttempts.retries} retries`)
  console.log(`  usage: ${report.modelAttempts.unreportedAttempts} unreported, uncached input ${report.modelAttempts.usage.uncachedInputTokens}, billed input ${report.modelAttempts.usage.billedInputTokens ?? 'n/a'}, output ${report.modelAttempts.usage.outputTokens}`)
  console.log(`  runtime snapshots: historical ${report.runtime.historical.snapshots}, active ${report.runtime.activeSurface.snapshots}, current epoch all ${report.runtime.currentCompactionEpochAll.snapshots} / active ${report.runtime.currentCompactionEpochActive.snapshots}, shadowed ${report.runtime.shadowed}`)
  console.log(`  runtime bytes: active ${report.runtime.activeSurfacePayloadBytes}, duplicate ${report.runtime.duplicateBytes}, latest ${report.runtime.activeSurface.latest?.bytes ?? 0}`)
  console.log(`  charter bytes: active ${report.runtime.activeCharterPayloadBytes}, latest ${report.runtime.activeLatestCharterBytes}, duplicate ${report.runtime.charterDuplicateBytes}`)
  console.log(`  section churn active: ${report.runtime.sectionChurn.events} changes${report.runtime.sectionChurn.sections.length === 0 ? '' : ` (${report.runtime.sectionChurn.sections.map(entry => `${entry.name}:${entry.changes}`).join(', ')})`}`)
  console.log(`  section churn all: ${report.runtime.sectionChurnAll.events} changes`)
  console.log(`  tool schema: ${report.toolSchema.count ?? 'n/a'} tools, ${report.toolSchema.bytes ?? 'n/a'} B, charter_read ${report.toolSchema.charterReadToolBytes ?? 'n/a'} B`)
  console.log(`  cache: read ${report.modelAttempts.usage.cacheReadTokens}, write ${report.modelAttempts.usage.cacheWriteTokens}, reported attempts ${report.modelAttempts.usage.cacheReportedAttempts}`)
  console.log(`  charter_read: ${report.charterRead.calls} calls, ${report.charterRead.paired} paired, ${report.charterRead.resultBytes} B results, ${report.charterRead.redundantReads} redundant candidates, ${report.charterRead.ambiguous} ambiguous`)
  for (const note of report.notes ?? []) console.log(`  NOTE: ${note}`)
  for (const warning of report.warnings) console.log(`  WARN: ${warning}`)
}

main()
