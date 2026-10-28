#!/usr/bin/env node
/**
 * Install the exact candidate artifact into a fresh DSH Web profile and fetch
 * the served page/client bundle. This is a real profile install gate, not a
 * plain npm consumer smoke; it needs network for the pinned DSH CLI.
 */
import { createHash, createHmac } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve, basename } from 'node:path'
import { spawn, spawnSync } from 'node:child_process'


function b64url(value) {
  return Buffer.from(value).toString('base64').replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/u, '')
}
function mintCookie(home, url) {
  const text = readFileSync(join(home, '.credentials.yaml'), 'utf8')
  const at = text.indexOf('client-connection/browser-session:')
  if (at < 0) throw new Error('no browser-session credential')
  const match = /secret:\s*(\S+)/u.exec(text.slice(at))
  if (match === null) throw new Error('no browser-session secret')
  const secret = Buffer.from(match[1].replaceAll('-', '+').replaceAll('_', '/'), 'base64')
  const authority = new URL(url).host
  const name = 'dsh-auth-' + createHash('sha256').update(authority).digest('base64url')
  const now = Date.now()
  const body = b64url(JSON.stringify({ version: 1, authority, issuedAt: now, expiresAt: now + 86_400_000 }))
  const sig = b64url(createHmac('sha256', secret).update(body).digest())
  return { name, value: `v1.${body}.${sig}` }
}

const args = process.argv.slice(2)
function value(flag, fallback) {
  const index = args.indexOf(flag)
  return index < 0 ? fallback : args[index + 1] ?? fallback
}
const artifact = value('--artifact')
const sums = value('--sha256')
const dshVersion = value('--dsh-version', '0.2.1-rc.4')
const port = Number(value('--port', '19444'))
if (artifact === undefined || sums === undefined) throw new Error('usage: profile-smoke.mjs --artifact <tgz> --sha256 <SHA256SUMS> [--dsh-version 0.2.1-rc.4] [--port 19444]')
const digest = createHash('sha256').update(readFileSync(artifact)).digest('hex')
const expected = readFileSync(sums, 'utf8').split('\n').find(row => row.trim().endsWith(`  ${basename(artifact)}`))
if (expected === undefined || digest !== expected.trim().split(/\s+/u)[0]) throw new Error('artifact digest mismatch')
const home = mkdtempSync(join(tmpdir(), 'dsh-charter-profile-'))
let child
const run = (command) => {
  const result = spawnSync('npx', ['--yes', `@deepseek-ai/dsh@${dshVersion}`, ...command], {
    cwd: home,
    encoding: 'utf8',
    env: { ...process.env, DSH_HOME: home, npm_config_cache: join(home, '.npm-cache'), DSH_PROFILE: 'web' },
    timeout: 180_000,
  })
  if (result.status !== 0) throw new Error(`DSH CLI failed (${result.status}): ${result.stdout}\n${result.stderr}`)
  return result
}
try {
  run(['plugin', '--profile', 'web', 'add', resolve(artifact)])
  child = spawn('npx', ['--yes', `@deepseek-ai/dsh@${dshVersion}`, '--profile', 'web', '--no-open', '--port', String(port)], {
    cwd: home,
    env: { ...process.env, DSH_HOME: home, npm_config_cache: join(home, '.npm-cache'), DSH_PROFILE: 'web' },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let output = ''
  child.stdout.on('data', chunk => { output += chunk })
  child.stderr.on('data', chunk => { output += chunk })
  const url = await new Promise((resolveUrl, reject) => {
    const timer = setTimeout(() => reject(new Error(`Web profile did not print a URL:\n${output}`)), 180_000)
    const poll = setInterval(() => {
      const match = /http:\/\/127\.0\.0\.1:\d+\/\?token=[A-Za-z0-9_-]+/u.exec(output)
      if (match !== null) { clearTimeout(timer); clearInterval(poll); resolveUrl(match[0]) }
    }, 200)
    child.on('close', code => { clearTimeout(timer); clearInterval(poll); reject(new Error(`Web profile exited ${code}:\n${output}`)) })
  })
  const cookie = mintCookie(home, url)
  const headers = { cookie: `${cookie.name}=${cookie.value}` }
  const page = await fetch(url, { headers })
  if (!page.ok) throw new Error(`Web page HTTP ${page.status}`)
  const html = await page.text()
  const bundleSrc = /src=["']([^"']*dsh-charter[^"']*\.js[^"']*)["']/u.exec(html)?.[1]
  if (bundleSrc !== undefined) {
    const bundle = await fetch(new URL(bundleSrc, url), { headers })
    if (!bundle.ok) throw new Error(`client bundle HTTP ${bundle.status}`)
    if (!(await bundle.text()).includes('dsh-charter')) throw new Error('client bundle missing plugin marker')
  } else if (!html.includes('dsh-charter')) {
    throw new Error('profile page has no dsh-charter bundle marker')
  }
  child.kill('SIGTERM')
  console.log(`profile-smoke: PASS — fresh DSH ${dshVersion} Web profile installed ${basename(artifact)} (${digest}) and served page/client bundle`)
} finally {
  child?.kill('SIGTERM')
  rmSync(home, { recursive: true, force: true })
}
