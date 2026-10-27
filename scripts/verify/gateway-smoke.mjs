#!/usr/bin/env node
/**
 * Real Gateway acceptance for the exact candidate tarball on two isolated DSH
 * dependency graphs. Each consumer installs the candidate package plus the
 * exact DSH packages for its version; the worker imports only bare specifiers,
 * so the checkout's node_modules cannot satisfy the runtime.
 */
import { createHash } from 'node:crypto'
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import assert from 'node:assert/strict'

const DSH_PACKAGES = [
  '@deepseek-ai/dsh-agent',
  '@deepseek-ai/dsh-api-gateway',
  '@deepseek-ai/dsh-api-remote-access',
  '@deepseek-ai/dsh-session',
  '@deepseek-ai/dsh-storage',
  '@deepseek-ai/dsh-storage-domain',
  '@deepseek-ai/dsh-storage-json',
  '@deepseek-ai/dsh-system-prompt',
  '@deepseek-ai/dsh-tools',
  '@deepseek-ai/dsh-typert-protocol',
  '@deepseek-ai/dsh-typert-registry',
]

function args(argv) {
  const out = { artifact: undefined, sha256: undefined, versions: '0.2.1-rc.3,0.2.1-rc.4', keep: false }
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i]
    if (flag === '--artifact') out.artifact = argv[++i]
    else if (flag === '--sha256') out.sha256 = argv[++i]
    else if (flag === '--versions') out.versions = argv[++i]
    else if (flag === '--keep') out.keep = true
    else if (flag === '--help' || flag === '-h') {
      console.log('usage: node scripts/verify/gateway-smoke.mjs --artifact <tgz> [--sha256 SHA256SUMS] [--versions v1,v2] [--keep]')
      process.exit(0)
    } else throw new Error(`unknown argument: ${flag}`)
  }
  if (out.artifact === undefined) throw new Error('--artifact is required')
  return out
}

function sha256(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex')
}

function verifySums(artifact, sumsPath) {
  const actual = sha256(artifact)
  if (sumsPath === undefined) return actual
  const name = basename(artifact)
  const line = readFileSync(sumsPath, 'utf8').split('\n').find(row => row.trim().endsWith(`  ${name}`))
  if (line === undefined) throw new Error(`no SHA-256 entry for ${name}`)
  assert.equal(actual, line.trim().split(/\s+/u)[0])
  return actual
}

function run(command, commandArgs, cwd, extraEnv = {}) {
  const result = spawnSync(command, commandArgs, { cwd, encoding: 'utf8', env: { ...process.env, ...extraEnv, npm_config_cache: join(cwd, '.npm-cache') } })
  if (result.status !== 0) throw new Error(`${command} failed in ${cwd}\n${result.stdout}\n${result.stderr}`)
  return result
}

function installConsumer(artifact, version, root) {
  const consumer = join(root, `consumer-${version}`)
  mkdirSync(consumer, { recursive: true })
  const dependencies = { 'dsh-charter': `file:${resolve(artifact)}` }
  for (const name of DSH_PACKAGES) dependencies[name] = version
  dependencies['@deepseek-ai/cordis'] = '4.0.5'
  writeFileSync(join(consumer, 'package.json'), JSON.stringify({ name: `gateway-consumer-${version}`, private: true, type: 'module', dependencies }, null, 2) + '\n')
  run('npm', ['install', '--ignore-scripts', '--no-audit', '--no-fund'], consumer)
  copyFileSync(join(import.meta.dirname, 'gateway-worker.mjs'), join(consumer, 'gateway-worker.mjs'))
  const worker = run(process.execPath, ['gateway-worker.mjs'], consumer, { DSH_VERSION: version })
  const evidence = JSON.parse(readFileSync(join(consumer, 'gateway-worker-evidence.json'), 'utf8'))
  evidence.stdout = worker.stdout.trim()
  return evidence
}

const parsed = args(process.argv.slice(2))
const artifact = resolve(parsed.artifact)
const sha = verifySums(artifact, parsed.sha256 === undefined ? undefined : resolve(parsed.sha256))
const versions = parsed.versions.split(',').map(value => value.trim()).filter(Boolean)
assert.ok(versions.length > 0, 'at least one DSH version is required')
const root = mkdtempSync(join(tmpdir(), 'dsh-charter-gateway-matrix-'))
const results = []
try {
  for (const version of versions) {
    console.log(`gateway-smoke: installing exact artifact with DSH ${version}`)
    const evidence = installConsumer(artifact, version, root)
    assert.equal(evidence.dshVersion, version)
    results.push(evidence)
    console.log(`PASS DSH ${version}: ${evidence.checks.length} authorization checks`)
  }
  mkdirSync(join(import.meta.dirname, '..', '..', '.tmp'), { recursive: true })
  writeFileSync(join(import.meta.dirname, '..', '..', '.tmp', 'gateway-smoke.json'), JSON.stringify({ artifact: basename(artifact), sha256: sha, versions: results }, null, 2) + '\n')
  console.log(`gateway-smoke: PASS — exact artifact ${basename(artifact)} (${sha}) on ${versions.join(', ')}`)
} catch (error) {
  mkdirSync(join(import.meta.dirname, '..', '..', '.tmp'), { recursive: true })
  writeFileSync(join(import.meta.dirname, '..', '..', '.tmp', 'gateway-smoke.json'), JSON.stringify({ artifact: basename(artifact), sha256: sha, versions: results, error: String(error) }, null, 2) + '\n')
  throw error
} finally {
  if (!parsed.keep) rmSync(root, { recursive: true, force: true })
}
