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
import { cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { existsSync, readFileSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const PACKAGE = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'))
const DECLARED = Object.keys(PACKAGE.dsh?.compatibility?.dshReleases ?? {})
if (DECLARED.length < 2) throw new Error('package.json has no dsh.compatibility.dshReleases declaration')
const declaredRange = DECLARED.join(' || ')
const peers = Object.entries(PACKAGE.peerDependencies ?? {})
  .filter(([name]) => name.startsWith('@deepseek-ai/dsh-'))
if (peers.some(([, range]) => range !== declaredRange)) {
  throw new Error('DSH peer ranges disagree with dsh.compatibility.dshReleases')
}
if (PACKAGE.engines?.dsh !== declaredRange) {
  throw new Error('engines.dsh disagrees with dsh.compatibility.dshReleases')
}
const SENTINELS = {
  minimum: DECLARED[0],
  'old-boundary': DECLARED.find(version => version === '0.2.1-rc.2') ?? DECLARED[0],
  current: DECLARED.at(-1),
  all: DECLARED,
}
function parseArgs(argv) {
  const args = { versions: 'minimum,old-boundary,current', out: '.tmp/compat-matrix.json', dryRun: false, keep: false, test: null, discover: false }
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i]
    if (flag === '--dry-run') args.dryRun = true
    else if (flag === '--discover') args.discover = true
    else if (flag === '--keep') args.keep = true
    else if (flag === '--versions') args.versions = argv[++i] ?? ''
    else if (flag === '--out') args.out = argv[++i] ?? args.out
    else if (flag === '--test') args.test = argv[++i] ?? null
    else if (flag === '--help' || flag === '-h') {
      console.log('usage: node scripts/verify/compat-matrix.mjs [--versions minimum,old-boundary,current|all|0.2.1-rc.3,...] [--test tests/foo.spec.ts] [--out file] [--dry-run] [--discover] [--keep]')
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
    stdout,
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
  const pkg = JSON.parse(await readFile(join(dir, 'package.json'), 'utf8'))
  const dshPackages = {
    '@deepseek-ai/dsh-agent': version,
    '@deepseek-ai/dsh-api-gateway': version,
    '@deepseek-ai/dsh-client-locale': version,
    '@deepseek-ai/dsh-client-ui-conversation': version,
    '@deepseek-ai/dsh-client-ui-renderer': version,
    '@deepseek-ai/dsh-client-ui-session': version,
    '@deepseek-ai/dsh-client-ui-slots': version,
    '@deepseek-ai/dsh-session': version,
    '@deepseek-ai/dsh-storage': version,
    '@deepseek-ai/dsh-storage-domain': version,
    '@deepseek-ai/dsh-storage-json': version,
    '@deepseek-ai/dsh-system-prompt': version,
    '@deepseek-ai/dsh-tools': version,
    '@deepseek-ai/dsh-typert-protocol': version,
  }
  const tools = {
    '@types/node': '22.20.5',
    '@types/react': '18.3.31',
    '@types/react-dom': '18.3.7',
    '@types/react-test-renderer': '18.3.1',
    '@tsdown/css': '0.22.2',
    react: '18.3.1',
    'react-dom': '18.3.1',
    'react-test-renderer': '18.3.1',
    tsdown: '0.22.2',
    typescript: '5.9.3',
    vitest: '4.1.12',
  }
  for (const name of Object.keys(pkg.devDependencies ?? {})) {
    if (name.startsWith('@deepseek-ai/')) delete pkg.devDependencies[name]
  }
  pkg.devDependencies = { ...pkg.devDependencies, ...dshPackages, ...tools }
  delete pkg.overrides
  delete pkg.pnpm
  await writeFile(join(dir, 'package.json'), JSON.stringify(pkg, null, 2) + '\n')
  await rm(join(dir, 'package-lock.json'), { force: true })
  await rm(join(dir, 'pnpm-lock.yaml'), { force: true })
  // The plugin and DSH 0.2.1 packages pin different zod patch lines. Resolve
  // them to one graph before installation; never rewrite the virtual store.
  await writeFile(join(dir, 'pnpm-workspace.yaml'), "packages:\n  - .\nstrictPeerDependencies: true\noverrides:\n  zod: 4.6.7\n")
  const pnpm = process.env.COMPAT_PNPM ?? 'pnpm'
  const install = await run(pnpm, ['install', '--ignore-scripts', '--no-frozen-lockfile'], dir)
  return { dir, install }
}

async function collectResolution(dir, version) {
  const pnpm = process.env.COMPAT_PNPM ?? 'pnpm'
  const listed = await run(pnpm, ['list', '--depth', 'Infinity', '--json', '--silent'], dir)
  const root = join(dir, 'node_modules', '@deepseek-ai')
  const packages = {}
  const resolved = {}
  let graphMismatch = listed.code === 0 ? null : `pnpm list failed: ${listed.code}`
  if (listed.code === 0) {
    try {
      const parsed = JSON.parse(listed.stdout)
      const walk = (node) => {
        for (const key of ['dependencies', 'devDependencies', 'optionalDependencies']) {
          for (const [name, entry] of Object.entries(node?.[key] ?? {})) {
            if (typeof entry?.version === 'string') {
              resolved[name] = entry.version
              if (name.startsWith('@deepseek-ai/dsh-')) {
                const previous = packages[name]
                if (previous !== undefined && previous !== entry.version) graphMismatch = `${name}: mixed ${previous} and ${entry.version}`
                else packages[name] = entry.version
              }
            }
            walk(entry)
          }
        }
      }
      for (const node of parsed) walk(node)
    } catch (error) {
      graphMismatch = `pnpm list JSON parse failed: ${error.message}`
    }
  }
  const zodDirs = existsSync(join(dir, 'node_modules', '.pnpm'))
    ? (await readdir(join(dir, 'node_modules', '.pnpm'))).filter(name => /^zod@/u.test(name))
    : []
  if (zodDirs.join(',') !== 'zod@4.6.7') graphMismatch ??= `unexpected zod graph: ${zodDirs.join(',')}`
  const mismatches = Object.entries(packages).filter(([, installed]) => installed !== version)
  if (mismatches.length > 0) graphMismatch ??= mismatches.map(([name, installed]) => `${name}: ${installed} != ${version}`).join(', ')
  const lockPath = join(dir, 'pnpm-lock.yaml')
  const lockSha = existsSync(lockPath) ? createHash('sha256').update(await readFile(lockPath)).digest('hex') : null
  return {
    packages,
    resolved,
    toolVersions: Object.fromEntries(Object.entries(resolved).filter(([name]) => !name.startsWith('@deepseek-ai/dsh-'))),
    graphMismatch,
    zodDirs,
    lockfileSha256: lockSha,
    agent: packages['@deepseek-ai/dsh-agent'] ?? null,
  }
}
async function main() {
  const args = parseArgs(process.argv.slice(2))
  const startedAt = new Date().toISOString()
  const pnpmVersion = await run('pnpm', ['--version'], ROOT)
  const evidence = {
    schemaVersion: 2,
    runner: 'compat-matrix',
    startedAt,
    node: process.version,
    pnpm: pnpmVersion.stdoutTail.trim(),
    versions: [],
  }
  if (args.discover) {
    const cache = join(ROOT, '.tmp', 'npm-cache')
    const tags = await run('npm', ['view', '@deepseek-ai/dsh', 'dist-tags', '--json', '--cache', cache], ROOT)
    const versions = await run('npm', ['view', '@deepseek-ai/dsh', 'versions', '--json', '--cache', cache], ROOT)
    if (tags.code !== 0 || versions.code !== 0) throw new Error('npm discovery failed')
    const untracked = new Set()
    const tagMap = JSON.parse(tags.stdout)
    for (const value of Object.values(tagMap)) if (typeof value === 'string' && !DECLARED.includes(value)) untracked.add(value)
    const published = JSON.parse(versions.stdout)
    for (const value of published) if (typeof value === 'string' && !DECLARED.includes(value)) untracked.add(value)
    const newer = [...untracked].filter(value => {
      const parse = version => version.split('-')[0].split('.').map(Number)
      const [aMaj, aMin, aPatch] = parse(value)
      const [bMaj, bMin, bPatch] = parse(DECLARED.at(-1))
      return [aMaj - bMaj, aMin - bMin, aPatch - bPatch].find(delta => delta !== 0) > 0
    }).sort()
    console.log(JSON.stringify({ declared: DECLARED, tags: tagMap, untracked: [...untracked], newer }, null, 2))
    return
  }
  console.log(`compat-matrix: ${args.versions.join(', ')}`)
  if (args.dryRun) {
    for (const version of args.versions) console.log(`would verify DSH ${version} in .tmp/compat-matrix/${version}`)
    console.log(`would write ${resolve(ROOT, args.out)}`)
    return
  }
  const workRoot = await mkdtemp(join(tmpdir(), 'dsh-charter-compat-'))
  try {
  for (const version of args.versions) {
    const { dir, install } = await prepareProject(version, workRoot)
    const resolution = await collectResolution(dir, version)
    const peers = Object.keys(JSON.parse(await readFile(join(dir, 'package.json'), 'utf8')).peerDependencies ?? {})
      .filter(name => name.startsWith('@deepseek-ai/dsh-'))
    let peerMismatch = resolution.graphMismatch
    if (install.code === 0 && peerMismatch === null) {
      for (const name of peers) {
        try {
          const installed = JSON.parse(await readFile(join(dir, 'node_modules', name, 'package.json'), 'utf8')).version
          if (installed !== version) peerMismatch = `${name}: ${installed} != ${version}`
        } catch {
          peerMismatch = `${name}: missing`
        }
        if (peerMismatch !== null) break
      }
    }
    const result = {
      version,
      installedAgent: resolution.agent,
      peerMismatch,
      install,
      resolution,
      typecheck: null,
      build: null,
      test: null,
      passed: false,
    }
    if (install.code === 0 && peerMismatch === null) {
      result.typecheck = await run(join(dir, 'node_modules/.bin/tsc'), ['--noEmit'], dir)
      result.build = await run('npm', ['run', 'build'], dir)
      const needsGateway = version.localeCompare('0.2.1-rc.3', undefined, { numeric: true }) >= 0
      const testArgs = ['run']
      if (args.test !== null) testArgs.push(args.test)
      if (!needsGateway) testArgs.push('--exclude', 'tests/gateway/**')
      result.test = await run(join(dir, 'node_modules/.bin/vitest'), testArgs, dir)
    }
    result.passed = install.code === 0 && peerMismatch === null
      && result.typecheck?.code === 0 && result.build?.code === 0 && result.test?.code === 0
    evidence.versions.push(result)
    console.log(`${result.passed ? 'PASS' : 'FAIL'} DSH ${version} (agent ${resolution.agent ?? 'missing'})`)
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
