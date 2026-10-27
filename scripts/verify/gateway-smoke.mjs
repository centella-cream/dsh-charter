#!/usr/bin/env node
/**
 * Real TypertGatewayService acceptance against the exact shipped artifact tree.
 *
 * The heavy lifting is the tracked compatibility runner: it installs each
 * requested DSH release graph in isolation and runs the real Gateway spec
 * (`tests/gateway/authorization.spec.ts`) against that graph.
 *
 * This script intentionally does not substitute a fake Gateway or direct
 * business-service calls. It fails when a version cannot install or the spec
 * does not pass.
 */
import { spawn } from 'node:child_process'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..', '..')
const args = process.argv.slice(2)
function value(flag, fallback) {
  const index = args.indexOf(flag)
  return index < 0 ? fallback : args[index + 1] ?? fallback
}
const versions = value('--versions', '0.2.1-rc.3,0.2.1-rc.4')
const out = value('--out', '.tmp/gateway-smoke.json')
const child = spawn(process.execPath, [
  'scripts/verify/compat-matrix.mjs',
  '--versions', versions,
  '--test', 'tests/gateway/authorization.spec.ts',
  '--out', out,
], { cwd: root, stdio: 'inherit' })
const code = await new Promise(resolveCode => child.on('close', resolveCode))
if (code !== 0) process.exitCode = code
else console.log(`gateway-smoke: PASS — real TypertGatewayService on ${versions}; evidence ${out}`)
