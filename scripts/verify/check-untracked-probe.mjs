#!/usr/bin/env node
/** Fail closed for a new untracked DSH probe: only a recorded incompatibility may fail. */
import { readFileSync } from 'node:fs'
const [version, evidencePath] = process.argv.slice(2)
if (version === undefined || evidencePath === undefined) throw new Error('usage: check-untracked-probe.mjs <version> <evidence.json>')
const evidence = JSON.parse(readFileSync(evidencePath, 'utf8')).versions?.[0]
if (evidence === undefined) throw new Error(`no evidence for ${version}`)
const expected = JSON.parse(readFileSync(new URL('./unsupported-dsh.json', import.meta.url), 'utf8'))
if (evidence.passed === true) {
  throw new Error(`DSH ${version} now passes; update declarations and compatibility docs instead of keeping it untracked`)
}
for (const phase of ['install', 'typecheck', 'build']) {
  if (evidence[phase]?.code !== 0) throw new Error(`DSH ${version} failed at ${phase}; this is an infrastructure/build blocker, not a recorded incompatibility`)
}
if (evidence.test?.code === 0) throw new Error(`DSH ${version} test result is inconsistent`)
if (expected[version] === undefined) throw new Error(`DSH ${version} failed tests but is not recorded as unsupported`)
console.log(`KNOWN UNSUPPORTED DSH ${version}: ${expected[version]}`)
