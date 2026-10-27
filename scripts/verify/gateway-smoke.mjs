#!/usr/bin/env node
/**
 * Real TypertGatewayService acceptance against the exact released tarball.
 *
 * This script extracts the artifact into an isolated directory, imports the
 * production Host service, production @Remote service, and production Remote
 * contribution from the package itself, mounts the real Typert registry,
 * RemoteAccessService, and TypertGatewayService, then exercises owner/guest
 * calls and Session resource authorization. It never rebuilds from source.
 */
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, rmSync, symlinkSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'
import assert from 'node:assert/strict'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import Storage from '@deepseek-ai/dsh-storage'
import * as StorageDomain from '@deepseek-ai/dsh-storage-domain'
import * as StorageJson from '@deepseek-ai/dsh-storage-json'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import TypertRegistry from '@deepseek-ai/dsh-typert-registry'
import RemoteAccessService from '@deepseek-ai/dsh-api-remote-access'
import TypertGatewayService from '@deepseek-ai/dsh-api-gateway'

function parseArgs(argv) {
  const args = { artifact: undefined, sha256: undefined, keep: false }
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i]
    if (flag === '--artifact') args.artifact = argv[++i]
    else if (flag === '--sha256') args.sha256 = argv[++i]
    else if (flag === '--keep') args.keep = true
    else if (flag === '--help' || flag === '-h') {
      console.log('usage: node scripts/verify/gateway-smoke.mjs --artifact <tgz> [--sha256 SHA256SUMS] [--keep]')
      process.exit(0)
    } else throw new Error(`unknown argument: ${flag}`)
  }
  if (args.artifact === undefined) throw new Error('--artifact is required')
  return args
}

function digest(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex')
}

function verifySums(artifact, sumsPath) {
  if (sumsPath === undefined) return digest(artifact)
  const sums = readFileSync(sumsPath, 'utf8')
  const name = basename(artifact)
  const line = sums.split('\n').find(candidate => candidate.trim().endsWith(`  ${name}`) || candidate.trim().endsWith(` *${name}`))
  if (line === undefined) throw new Error(`no SHA-256 entry for ${name} in ${sumsPath}`)
  const expected = line.trim().split(/\s+/u)[0]
  const actual = digest(artifact)
  assert.match(expected, /^[0-9a-f]{64}$/u)
  if (actual !== expected) throw new Error(`SHA-256 mismatch: artifact ${actual}, sums ${expected}`)
  return actual
}

function extractArtifact(artifact) {
  const root = mkdtempSync(join(tmpdir(), 'dsh-charter-gateway-'))
  const result = spawnSync('tar', ['-xzf', resolve(artifact), '-C', root], { encoding: 'utf8' })
  if (result.status !== 0) throw new Error(`tar failed: ${result.stderr}`)
  const pkg = join(root, 'package')
  if (!existsSync(join(pkg, 'package.json'))) throw new Error('artifact has no package/package.json')
  symlinkSync(join(resolve(import.meta.dirname), '..', '..', 'node_modules'), join(pkg, 'node_modules'), 'dir')
  return { root, pkg }
}

function identityMeta(createdAt) {
  return { meta: { cwd: '/work', createdAt } }
}

async function mount(pkg, root) {
  const host = await import(pathToFileURL(join(pkg, 'lib/index.js')).href)
  const remote = await import(pathToFileURL(join(pkg, 'lib/remote.js')).href)
  const ctx = new Context()
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(SessionStore)
  await ctx.plugin(Storage)
  await ctx.plugin(StorageJson, { root: join(root, 'storage') })
  await ctx.plugin(StorageDomain, { backend: 'json' })
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(host.CharterService)
  await ctx.plugin(TypertRegistry)
  await ctx.plugin(RemoteAccessService)
  await ctx.plugin(remote.CharterRemoteService)
  ctx.typert.register({
    package: 'dsh-charter',
    face: 'host',
    schemas: [],
    model: { services: [], events: [], objects: [] },
    invocations: remote.charterRemoteContribution.descriptors,
  })
  await ctx.plugin(TypertGatewayService)
  const service = ctx.charter
  const sessionA = ctx.sessions.create(SessionId('gateway-a'), identityMeta(1_700_000_020_000))
  const sessionB = ctx.sessions.create(SessionId('gateway-b'), identityMeta(1_700_000_020_001))
  for (const session of [sessionA, sessionB]) {
    ctx.emit('agent/created', {
      agent: { id: session.id, session },
      source: 'startup',
      signal: new AbortController().signal,
    })
  }
  const started = Date.now()
  while (service.view(sessionA).status !== 'ready' || service.view(sessionB).status !== 'ready') {
    if (Date.now() - started > 2_000) throw new Error('timeout waiting for Sessions')
    await new Promise(resolveWait => setTimeout(resolveWait, 5))
  }
  return { ctx, service, sessionA, sessionB }
}

function peer(ctx, principal) {
  return {
    id: 'gateway-peer',
    ctx,
    principal,
    signal: new AbortController().signal,
    interactions: 'answer',
    dispose: async () => undefined,
  }
}

function editRequest(sessionId, revision, text, mutationId) {
  return {
    sessionId,
    mutationId,
    baseRevision: revision,
    ops: [{ type: 'item.add', item: { clientRef: mutationId, kind: 'invariant', text, order: revision } }],
  }
}

const args = parseArgs(process.argv.slice(2))
const artifact = resolve(args.artifact)
const sha = verifySums(artifact, args.sha256 === undefined ? undefined : resolve(args.sha256))
const { root, pkg } = extractArtifact(artifact)
const evidence = { artifact: basename(artifact), sha256: sha, checks: [] }
const check = (name, condition) => {
  assert.ok(condition, name)
  evidence.checks.push(name)
}
try {
  const pkgJson = JSON.parse(readFileSync(join(pkg, 'package.json'), 'utf8'))
  check('artifact identity', pkgJson.name === 'dsh-charter' && /^0\.1\.0-rc\.5$/u.test(pkgJson.version))
  check('artifact contains lib/remote.js', existsSync(join(pkg, 'lib/remote.js')) && existsSync(join(pkg, 'lib/index.js')))
  const { ctx, service, sessionA, sessionB } = await mount(pkg, root)
  const owner = peer(ctx, { kind: 'owner' })
  const guest = peer(ctx, { kind: 'guest' })
  const endpoint = (method, argsValue, peerValue = owner) =>
    ctx.typertGateway.invoke({ namespace: 'charter', method, args: argsValue, peer: peerValue })

  const ownerEdit = await endpoint('edit', { request: editRequest(sessionA.id, 0, 'Owner invariant', 'gw-owner') })
  check('owner edit through Gateway', ownerEdit?.ok === true && service.view(sessionA).revision === 1)

  const guestPolicy = {
    bindings: () => [
      {
        role: {
          name: 'session-editor',
          resource: 'session',
          actions: ['charter/edit', 'charter/exportRecord', 'charter/initializeRecord', 'charter/restoreRecord'],
        },
        resource: { kind: 'session', id: sessionA.id },
      },
    ],
    explain: () => 'session-a-only',
  }
  ctx.remoteAccess.registerPolicy('guest', guestPolicy)

  const guestA = await endpoint('edit', { request: editRequest(sessionA.id, 1, 'Guest A invariant', 'gw-guest-a') }, guest)
  check('guest edit on authorized Session resource', guestA?.ok === true && service.view(sessionA).revision === 2)
  const guestB = await endpoint('edit', { request: editRequest(sessionB.id, 0, 'Guest B invariant', 'gw-guest-b') }, guest).then(
    () => undefined,
    error => error,
  )
  check('guest cross-Session denial before dispatch', guestB?.code === 'remote-access/denied')
  check('guest B did not mutate', service.view(sessionB).revision === 0)

  const guestExport = await endpoint('exportRecord', { sessionId: sessionA.id }, guest)
  check('guest maintenance denial at business layer', guestExport?.ok === false && guestExport.code === 'FORBIDDEN')
  const ownerExport = await endpoint('exportRecord', { sessionId: sessionA.id }, owner)
  check('owner diagnostic export', ownerExport?.ok === true && ownerExport.archive?.source?.health === 'healthy')

  const missing = await endpoint('edit', { request: editRequest(sessionA.id, 2, 'Missing principal', 'gw-missing') }, peer(ctx, {}))
    .then(result => result, error => error)
  check('missing principal fails closed', missing?.ok === false || missing?.code !== undefined)
  check('missing principal did not mutate', service.view(sessionA).revision === 2)

  const evidencePath = join(resolve(import.meta.dirname), '..', '..', '.tmp', 'gateway-smoke.json')
  await (await import('node:fs/promises')).mkdir(join(resolve(import.meta.dirname), '..', '..', '.tmp'), { recursive: true })
  await (await import('node:fs/promises')).writeFile(evidencePath, JSON.stringify(evidence, null, 2) + '\n')
  console.log(`gateway-smoke: PASS — exact artifact ${basename(artifact)} (${sha}); real production Remote/Gateway, Session resource authorization; evidence ${evidencePath}`)
} finally {
  if (!args.keep) rmSync(root, { recursive: true, force: true })
}
