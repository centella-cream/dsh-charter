#!/usr/bin/env node
/**
 * Read-only traffic/cache observation for one DSH Session.
 *
 * Reports step count, runtime-context snapshot accumulation, charter snapshot
 * bytes, per-assistant-message token usage, and charter_read tool traffic. It
 * never reads the charter storage authority or changes the Host; it exists to
 * make context growth and cache behavior measurable before changing the prompt
 * delivery model.
 *
 * Usage:
 *   node scripts/verify/traffic-check.mjs --session <id> [--home <DSH_HOME>] [--json]
 *
 * Requires the `zstd` binary for compressed session logs (`ZSTD` override).
 * Dev-only: this script is not part of the npm package.
 */
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { parseTranscript } from './compaction-checks.mjs'

const MAX_BUFFER = 1024 * 1024 * 1024
const CHARTER_SECTION = 'charter:standing'

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
    if (arg === '--session' || arg === '--home') {
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

function findSessionLog(home, sessionId) {
  const root = join(home, 'sessions')
  if (!existsSync(root)) fail(`no sessions directory at ${root}`)
  for (const project of readdirSync(root)) {
    const directory = join(root, project, sessionId)
    if (!existsSync(directory)) continue
    for (const name of readdirSync(directory)) {
      if (name === 'session.v4.jsonl.zstd' || name === 'session.v4.jsonl') return join(directory, name)
    }
  }
  fail(`no session transcript found for ${sessionId} under ${root}`)
}

function readTranscript(path) {
  if (path.endsWith('.jsonl')) return readFileSync(path, 'utf8')
  const binary = process.env.ZSTD ?? 'zstd'
  const result = spawnSync(binary, ['-dc', path], { maxBuffer: MAX_BUFFER })
  if (result.error !== undefined) fail(`cannot run "${binary} -dc": ${result.error.message}. Install zstd or set ZSTD.`)
  if (result.status !== 0) fail(`"${binary} -dc" failed: ${result.stderr?.toString().trim() ?? 'unknown error'}`)
  return result.stdout.toString('utf8')
}

function textOfContent(content) {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content.filter(part => part?.type === 'text' && typeof part.text === 'string').map(part => part.text).join('\n')
}

function digest(value) {
  return createHash('sha256').update(value, 'utf8').digest('hex')
}

/** Pure event summary; exported for fixture tests. */
export function summarizeTraffic(events) {
  const ordered = [...events].sort((left, right) => left.seq - right.seq)
  const runtime = []
  const charterSnapshots = []
  const usage = []
  const charterReadCalls = new Map()
  let toolCalls = 0
  let steps = 0
  let turns = 0
  let assistantMessages = 0
  let assistantWithoutUsage = 0

  for (const event of ordered) {
    if (event.type === 'step/start') steps += 1
    if (event.type === 'turn/start' || event.type === 'turn/begin') turns += 1
    if (event.type === 'assistant/message') {
      assistantMessages += 1
      const u = event.data?.usage
      if (u !== undefined) {
        usage.push({
          seq: event.seq,
          turn: event.data?.turn,
          step: event.data?.step,
          inputTokens: u.inputTokens ?? 0,
          cacheReadTokens: u.cacheReadTokens ?? 0,
          cacheWriteTokens: u.cacheWriteTokens ?? 0,
        })
      } else {
        assistantWithoutUsage += 1
      }
    }
    if (event.type === 'tool/call') {
      toolCalls += 1
      if (event.data?.name === 'charter_read') {
        let view = 'standing'
        try {
          const parsed = typeof event.data.arguments === 'string' ? JSON.parse(event.data.arguments) : event.data.arguments
          if (parsed?.view === 'all') view = 'all'
          else if (parsed?.view !== undefined && parsed?.view !== 'standing') view = String(parsed.view)
        } catch { view = 'invalid-arguments' }
        charterReadCalls.set(event.data.callId, { seq: event.seq, view, resultBytes: 0 })
      }
    }
    if (event.type === 'tool/result') {
      const callId = event.data?.message?.toolCallId ?? event.data?.message?.source?.callId
      const call = charterReadCalls.get(callId)
      if (call !== undefined) call.resultBytes = Buffer.byteLength(textOfContent(event.data?.message?.content), 'utf8')
    }
    if (event.type === 'user/message' && event.data?.source?.kind === 'runtime-context') {
      const text = textOfContent(event.data?.content)
      const sections = Array.isArray(event.data?.source?.sections) ? event.data.source.sections : []
      const charter = sections.find(section => section?.name === CHARTER_SECTION)
      const entry = {
        seq: event.seq,
        bytes: Buffer.byteLength(text, 'utf8'),
        digest: digest(text),
        sections: sections.map(section => section?.name).filter(name => typeof name === 'string'),
        charterBytes: charter === undefined ? 0 : Buffer.byteLength(String(charter.text ?? ''), 'utf8'),
      }
      runtime.push(entry)
      if (charter !== undefined) charterSnapshots.push({ ...entry, charterDigest: digest(String(charter.text ?? '')) })
    }
  }

  const uniqueRuntime = new Set(runtime.map(snapshot => snapshot.digest))
  const uniqueCharter = new Set(charterSnapshots.map(snapshot => snapshot.charterDigest))
  const usageTotals = usage.reduce((total, row) => ({
    inputTokens: total.inputTokens + row.inputTokens,
    cacheReadTokens: total.cacheReadTokens + row.cacheReadTokens,
    cacheWriteTokens: total.cacheWriteTokens + row.cacheWriteTokens,
  }), { inputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 })
  const warnings = []
  if (charterSnapshots.length > 1 && uniqueCharter.size > 1) {
    warnings.push('charter runtime snapshots accumulate: multiple distinct charter snapshots remain in the transcript until compaction')
  }
  if (charterReadCalls.size > 0) {
    warnings.push('charter_read was called; the standing charter is normally present in runtime context already')
  }
  if (runtime.length > 0 && uniqueRuntime.size < runtime.length) {
    warnings.push('duplicate runtime-context snapshots observed')
  }
  if (assistantWithoutUsage > 0) warnings.push('some assistant messages have no token usage record')

  return {
    events: ordered.length,
    seqRange: ordered.length === 0 ? null : { from: ordered[0].seq, to: ordered.at(-1).seq },
    turns,
    steps,
    assistantMessages,
    assistantWithoutUsage,
    runtime: {
      snapshots: runtime.length,
      distinct: uniqueRuntime.size,
      totalBytes: runtime.reduce((sum, row) => sum + row.bytes, 0),
      maxBytes: runtime.reduce((max, row) => Math.max(max, row.bytes), 0),
      latest: runtime.at(-1) ?? null,
    },
    charter: {
      snapshots: charterSnapshots.length,
      distinct: uniqueCharter.size,
      totalBytes: charterSnapshots.reduce((sum, row) => sum + row.charterBytes, 0),
      maxBytes: charterSnapshots.reduce((max, row) => Math.max(max, row.charterBytes), 0),
      latest: charterSnapshots.at(-1) ?? null,
    },
    toolCalls,
    charterRead: {
      calls: charterReadCalls.size,
      views: [...charterReadCalls.values()].map(call => call.view),
      resultBytes: [...charterReadCalls.values()].reduce((sum, call) => sum + call.resultBytes, 0),
    },
    usage: { records: usage.length, ...usageTotals },
    warnings,
  }
}

function main() {
  const args = parseArgs(process.argv.slice(2))
  const sessionId = args.session ?? process.env.DSH_SESSION_ID
  if (sessionId === undefined) fail('no Session: pass --session <id> or set DSH_SESSION_ID')
  const home = args.home ?? process.env.DSH_HOME ?? join(homedir(), '.dsh')
  const logFile = findSessionLog(home, sessionId)
  const parsed = parseTranscript(readTranscript(logFile))
  if (!parsed.complete) {
    fail('transcript is corrupt; refuse to summarize skipped lines')
  }
  const report = { sessionId, logFile, ...summarizeTraffic(parsed.events) }
  if (args.json) {
    console.log(JSON.stringify(report, null, 2))
    return
  }
  console.log(`traffic-check: ${sessionId}`)
  console.log(`  log: ${logFile}`)
  console.log(`  events: ${report.events}, turns: ${report.turns}, steps: ${report.steps}, assistant messages: ${report.assistantMessages}`)
  console.log(`  runtime snapshots: ${report.runtime.snapshots} (${report.runtime.distinct} distinct), total ${report.runtime.totalBytes} B, max ${report.runtime.maxBytes} B`)
  console.log(`  charter snapshots: ${report.charter.snapshots} (${report.charter.distinct} distinct), total ${report.charter.totalBytes} B, max ${report.charter.maxBytes} B`)
  console.log(`  usage: ${report.usage.records} records, input ${report.usage.inputTokens}, cacheRead ${report.usage.cacheReadTokens}, cacheWrite ${report.usage.cacheWriteTokens}`)
  console.log(`  charter_read: ${report.charterRead.calls} calls, ${report.charterRead.resultBytes} B results`)
  for (const warning of report.warnings) console.log(`  WARN: ${warning}`)
}

if (process.argv[1] !== undefined && import.meta.url.endsWith(process.argv[1].split('/').at(-1))) main()
