#!/usr/bin/env node
/**
 * Compare two read-only traffic-check reports. This is a local diagnostic for
 * before/after release baselines; it never reads live Host state and never
 * reports data anywhere.
 *
 * Usage: node scripts/verify/traffic-diff.mjs --before a.json --after b.json [--json]
 */
import { readFileSync } from 'node:fs'

function metric(report, path) {
  let value = report
  for (const key of path.split('.')) value = value?.[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

export function compareTrafficReports(before, after) {
  const paths = [
    'modelAttempts.total',
    'modelAttempts.usage.uncachedInputTokens',
    'modelAttempts.usage.outputTokens',
    'runtime.activeSurface.snapshots',
    'runtime.activeSurfacePayloadBytes',
    'runtime.duplicateRate',
    'runtime.activeCharterPayloadBytes',
    'runtime.charterDuplicateBytes',
    'charterRead.calls',
    'charterRead.resultBytes',
    'charterPropose.calls',
    'charterPropose.rejected',
    'charterPropose.displayKeyRejects',
    'charterPropose.unknownIdRejects',
  ]
  return paths.map(path => {
    const a = metric(before, path)
    const b = metric(after, path)
    return {
      metric: path,
      before: a,
      after: b,
      delta: a === null || b === null ? null : b - a,
      percent: a === null || b === null || a === 0 ? null : ((b - a) / a) * 100,
    }
  })
}

export function formatTrafficDiff(rows) {
  return rows.map(row => {
    const delta = row.delta === null ? 'n/a' : `${row.delta >= 0 ? '+' : ''}${row.delta}`
    const percent = row.percent === null ? '' : ` (${row.percent >= 0 ? '+' : ''}${row.percent.toFixed(1)}%)`
    return `${row.metric}: ${row.before ?? 'n/a'} → ${row.after ?? 'n/a'}  ${delta}${percent}`
  }).join('\n')
}

function parseArgs(argv) {
  const args = { json: false }
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--json') args.json = true
    else if (arg === '--before' || arg === '--after') { args[arg.slice(2)] = argv[++i]; }
    else if (arg === '--help' || arg === '-h') {
      console.log('usage: node scripts/verify/traffic-diff.mjs --before <report.json> --after <report.json> [--json]')
      process.exit(0)
    } else throw new Error(`unknown argument: ${arg}`)
  }
  if (!args.before || !args.after) throw new Error('--before and --after are required')
  return args
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = parseArgs(process.argv.slice(2))
  const before = JSON.parse(readFileSync(args.before, 'utf8'))
  const after = JSON.parse(readFileSync(args.after, 'utf8'))
  const rows = compareTrafficReports(before, after)
  console.log(args.json ? JSON.stringify(rows, null, 2) : formatTrafficDiff(rows))
}
