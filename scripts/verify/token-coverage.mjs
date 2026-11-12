#!/usr/bin/env node
/**
 * W0 token coverage gate.
 *
 * The Pane may only consume host design tokens that are actually defined by
 * every declared DSH version. `token-coverage.inventory.json` records the
 * audited static token set and the dynamic variables that need a CSS fallback.
 * Adding a new `var(--dsw-* / --ds-* / --dsh-*)` without re-auditing fails here.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const ROOT = resolve(import.meta.dirname, '../..')
const CSS_PATH = resolve(ROOT, 'src/client/charter.css')
const INVENTORY_PATH = resolve(ROOT, 'scripts/verify/token-coverage.inventory.json')
const JSON_OUT = process.argv.includes('--json')

const css = readFileSync(CSS_PATH, 'utf8')
const inventory = JSON.parse(readFileSync(INVENTORY_PATH, 'utf8'))
const used = [...new Set(
  [...css.matchAll(/var\((--(?:dsw|ds|dsh)-[a-z0-9-]+)(?=\s*[,)])/gu)].map(match => match[1]),
)].sort()
const staticVars = new Set(inventory.staticVars)
const dynamic = inventory.dynamicVars ?? {}
const problems = []

const unknown = used.filter(variable => !staticVars.has(variable) && dynamic[variable] === undefined)
if (unknown.length > 0) {
  problems.push(`un-audited host token(s): ${unknown.join(', ')} — add to the inventory after auditing all declared versions`)
}
const unused = [...staticVars].filter(variable => !used.includes(variable))
if (unused.length > 0) {
  problems.push(`audited token(s) no longer used: ${unused.join(', ')} — remove from the inventory`)
}
for (const [version, missing] of Object.entries(inventory.missingByVersion ?? {})) {
  if (missing.length > 0) problems.push(`${version}: missing ${missing.join(', ')}`)
}
for (const [variable, spec] of Object.entries(dynamic)) {
  if (typeof spec?.fallback !== 'string') {
    problems.push(`${variable}: dynamic entry needs a fallback string`)
    continue
  }
  const pattern = new RegExp(`var\\(${variable.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')}\\s*,\\s*[^)]+\\)`, 'u')
  if (!pattern.test(css)) problems.push(`${variable}: used without a CSS fallback`)
}

const result = {
  auditDate: inventory.auditDate,
  versions: inventory.source?.versions ?? [],
  staticVars: used.filter(variable => staticVars.has(variable)).length,
  dynamicVars: Object.keys(dynamic).length,
  problems,
}
if (JSON_OUT) {
  console.log(JSON.stringify(result, null, 2))
} else {
  console.log(`token coverage: ${result.staticVars} static host vars, ${result.dynamicVars} dynamic vars, ${result.versions.length} declared DSH versions (audit ${result.auditDate})`)
  for (const problem of problems) console.error(`FAIL: ${problem}`)
  if (problems.length === 0) console.log('PASS: every declared DSH version defines every static Pane token; dynamic vars have fallbacks')
}
process.exit(problems.length === 0 ? 0 : 1)
