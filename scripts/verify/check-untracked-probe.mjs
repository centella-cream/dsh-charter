#!/usr/bin/env node
/** Fail closed for a new untracked DSH probe: only a recorded incompatibility may fail. */
import { readFileSync } from 'node:fs'
const [version, evidencePath] = process.argv.slice(2)
if (version === undefined || evidencePath === undefined) throw new Error('usage: check-untracked-probe.mjs <version> <evidence.json>')
const evidence = JSON.parse(readFileSync(evidencePath, 'utf8')).versions?.[0]
if (evidence === undefined) throw new Error(`no evidence for ${version}`)
if (evidence.version !== version) throw new Error(`evidence version ${evidence.version} != ${version}`)
const expected = JSON.parse(readFileSync(new URL('./unsupported-dsh.json', import.meta.url), 'utf8'))[version]
if (expected === undefined) throw new Error(`DSH ${version} is not recorded as unsupported`)
if (evidence.passed === true) throw new Error(`DSH ${version} now passes; update declarations and compatibility docs`)
if (expected.phase === 'install') {
  const output = `${evidence.install?.stdoutTail ?? ''}\n${evidence.install?.stderrTail ?? ''}`
  if (evidence.install?.code === 0) throw new Error(`DSH ${version} install unexpectedly succeeded; probe again`)
  if (!output.includes('ERR_PNPM_PEER_DEP_ISSUES')) throw new Error(`DSH ${version} install failed without strict-peer evidence`)
  if (!output.includes(expected.peer)) throw new Error(`DSH ${version} install did not fail on ${expected.peer}`)
  console.log(`KNOWN UNSUPPORTED DSH ${version}: ${expected.reason}`)
  process.exit(0)
}
for (const phase of ['install', 'typecheck', 'build']) {
  if (evidence[phase]?.code !== 0) throw new Error(`DSH ${version} failed at ${phase}; expected phase is ${expected.phase}`)
}
if (evidence.test?.code === 0) throw new Error(`DSH ${version} test result is inconsistent`)
console.log(`KNOWN UNSUPPORTED DSH ${version}: ${expected.reason}`)
