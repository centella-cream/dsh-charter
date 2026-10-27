#!/usr/bin/env node
/**
 * Tracked compatibility runner for rc.5.
 *
 * Creates one isolated npm project per DSH version, installs that exact DSH
 * peer graph, then runs typecheck, build, and Vitest. Evidence is JSON so CI
 * and release jobs consume facts instead of prose.
 *
 * This runner is intentionally explicit about network/tool requirements: it
 * needs npm registry access and a full checkout. It is not a substitute for the
 * real Gateway/browser acceptance jobs.
 */
import { mkdir, mkdtemp, readFile, rm, writeFile, cp } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const SENTINELS = {
  minimum: '0.1.7-rc.2',
  'old-boundary': '0.2.1-rc.2',
  current: '0.2.1-rc.4',
  all: [
    '0.1.7-rc.2',
    '0.2.0-rc.1',
    '0.2.0-rc.2',
    '0.2.1-rc.1',
    '0.2.1-rc.2',
    '0.2.1-rc.3',
    '0.2.1-rc.4',
  ],
}

function parseArgs(argv) {
  const args = { versions: 'minimum,old-boundary,current', out: '.tmp/compat-matrix.json', dryRun: false, keep: false, test: null }
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i]
    if (flag === '--dry-run') args.dryRun = true
    else if (flag === '--keep') args.keep = true
    else if (flag === '--versions') args.versions = argv[++i] ?? ''
    else if (flag === '--out') args.out = argv[++i] ?? args.out
    else if (flag === '--test') args.test = argv[++i] ?? null
    else if (flag === '--help' || flag === '-h') {
      console.log('usage: node scripts/verify/compat-matrix.mjs [--versions minimum,old-boundary,current|all|0.2.1-rc.3,...] [--test tests/foo.spec.ts] [--out file] [--dry-run] [--keep]')
      process.exit(0)
    } else throw new Error(`unknown argument: ${flag}`)
  }
  const versions = []
  for (const token of args.versions.split(',').map(token => token.trim()).filter(Boolean)) {
    const value = SENTINELS[token] ?? token
    if (Array.isArray(value)) versions.push(...value)
    else versions.push(value)
  }
  args.versions = [...new Set(versions)]
  if (args.versions.length === 0) throw new Error('no versions selected')
  return args
}

async function run(command, args, cwd, env = process.env) {
  const started = Date.now()
  const child = spawn(command, args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] })
  let stdout = ''
  let stderr = ''
  child.stdout.on('data', chunk => { stdout += chunk })
  child.stderr.on('data', chunk => { stderr += chunk })
  const code = await new Promise(resolveCode => child.on('close', resolveCode))
  return {
    command: [command, ...args].join(' '),
    code,
    durationMs: Date.now() - started,
    stdoutTail: stdout.slice(-8_000),
    stderrTail: stderr.slice(-8_000),
  }
}

const EXCLUDES = new Set(['node_modules', '.git', '.tmp', 'dist', 'lib', '.build-ts', 'docs/archive'])
async function copyTree(source, target) {
  await cp(source, target, {
    recursive: true,
    filter: candidate => {
      const relative = candidate.slice(source.length).replace(/^[/\\]/, '').split(/[/\\]/)[0]
      return !EXCLUDES.has(relative)
    },
  })
}

async function prepareProject(version, workRoot) {
  const dir = join(workRoot, version)
  if (existsSync(dir)) await rm(dir, { recursive: true, force: true })
  await mkdir(dir, { recursive: true })
  await copyTree(ROOT, dir)
  if (version.localeCompare('0.2.1-rc.3', undefined, { numeric: true }) < 0) {
    await rm(join(dir, 'tests/gateway'), { recursive: true, force: true })
  }
  const pkg = JSON.parse(await readFile(join(dir, 'package.json'), 'utf8'))
  for (const name of Object.keys(pkg.devDependencies ?? {})) {
    if (!name.startsWith('@deepseek-ai/dsh-')) continue
    const cache = join(dir, '.npm-cache')
    const lookup = await run('npm', [
      'view', `${name}@${version}`, 'version', '--json', '--cache', cache,
    ], dir)
    if (lookup.code !== 0 || lookup.stdoutTail.trim() === '') delete pkg.devDependencies[name]
    else pkg.devDependencies[name] = version
  }
  await writeFile(join(dir, 'package.json'), JSON.stringify(pkg, null, 2) + '\n')
  return dir
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const startedAt = new Date().toISOString()
  const evidence = { schemaVersion: 1, runner: 'compat-matrix', startedAt, versions: [] }
  console.log(`compat-matrix: ${args.versions.join(', ')}`)
  if (args.dryRun) {
    for (const version of args.versions) console.log(`would verify DSH ${version} in .tmp/compat-matrix/${version}`)
    console.log(`would write ${resolve(ROOT, args.out)}`)
    return
  }
  const workRoot = await mkdtemp(join(tmpdir(), 'dsh-charter-compat-'))
  try {
  for (const version of args.versions) {
    const dir = await prepareProject(version, workRoot)
    const install = await run('npm', [
      'install', '--ignore-scripts', '--legacy-peer-deps', '--no-audit', '--no-fund',
      '--cache', join(dir, '.npm-cache'),
    ], dir)
    let resolvedAgent = null
    try {
      resolvedAgent = JSON.parse(await readFile(join(dir, 'node_modules/@deepseek-ai/dsh-agent/package.json'), 'utf8')).version
    } catch { /* install failed; the record captures that */ }
    const result = { version, installedAgent: resolvedAgent, install, typecheck: null, build: null, test: null, passed: false }
    if (install.code === 0) {
      result.typecheck = await run(join(dir, 'node_modules/.bin/tsc'), ['--noEmit'], dir)
      result.build = await run('npm', ['run', 'build'], dir)
      const needsGateway = version.localeCompare('0.2.1-rc.3', undefined, { numeric: true }) >= 0
      const testArgs = ['run']
      if (args.test !== null) testArgs.push(args.test)
      if (!needsGateway) testArgs.push('--exclude', 'tests/gateway/**')
      result.test = await run(join(dir, 'node_modules/.bin/vitest'), testArgs, dir)
    }
    result.passed = install.code === 0 && result.typecheck?.code === 0 && result.build?.code === 0 && result.test?.code === 0
    evidence.versions.push(result)
    console.log(`${result.passed ? 'PASS' : 'FAIL'} DSH ${version} (agent ${resolvedAgent ?? 'missing'})`)
    if (!result.passed) process.exitCode = 1
    if (!result.passed) break
    if (!args.keep) await rm(dir, { recursive: true, force: true })
  }
  evidence.finishedAt = new Date().toISOString()
  } finally {
    await rm(workRoot, { recursive: true, force: true })
  }
  const out = resolve(ROOT, args.out)
  await mkdir(dirname(out), { recursive: true })
  await writeFile(out, JSON.stringify(evidence, null, 2) + '\n')
  console.log(`compat-matrix: evidence ${out}`)
}

await main()
