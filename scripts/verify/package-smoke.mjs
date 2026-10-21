// Verify the packed tarball, not just the workspace checkout: CI must catch a
// green build that produces an uninstallable or incomplete release artifact.
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, symlinkSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '../..')
const work = mkdtempSync(join(tmpdir(), 'dsh-charter-pack-'))
const packDir = join(work, 'pack')
const extractDir = join(work, 'extract')

function run(command, args, options = {}) {
  const output = execFileSync(command, args, { cwd: root, encoding: 'utf8', ...options })
  return typeof output === 'string' ? output.trim() : ''
}

try {
  run('mkdir', ['-p', packDir, extractDir])
  // Build first so pack can skip prepack and keep --json machine-readable.
  run('npm', ['run', 'build'], { stdio: 'ignore' })
  const packOutput = run('npm', ['pack', '--json', '--ignore-scripts', '--pack-destination', packDir])
  const start = packOutput.indexOf('{')
  if (start < 0) throw new Error(`npm pack did not return JSON: ${packOutput.slice(0, 200)}`)
  const parsed = JSON.parse(packOutput.slice(start))
  const packed = Array.isArray(parsed) ? parsed : Object.values(parsed)
  if (packed.length !== 1) throw new Error('expected exactly one packed artifact')
  const artifactInfo = packed[0]
  const artifact = join(packDir, artifactInfo.filename)
  const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
  if (artifactInfo.name !== manifest.name || artifactInfo.version !== manifest.version) {
    throw new Error(`packed identity mismatch: ${artifactInfo.name}@${artifactInfo.version}`)
  }

  const entries = run('tar', ['-tzf', artifact]).split('\n').filter(Boolean)
  const files = new Set(entries.filter(entry => !entry.endsWith('/')).map(entry => entry.replace(/^package\//u, '')))
  const required = new Set([
    'package.json',
    'README.md',
    'README.zh.md',
    'CHANGELOG.md',
    'CHANGELOG.zh.md',
    'LICENSE',
    'icon.svg',
    'cordis.patch.yml',
    'lib/index.js',
    'lib/index.d.ts',
    'lib/remote.js',
    'lib/remote.d.ts',
    'lib/core.js',
    'lib/core.d.ts',
    'lib/client.js',
  ])
  for (const path of required) {
    if (!files.has(path)) throw new Error(`packed artifact is missing ${path}`)
  }

  for (const [subpath, target] of Object.entries(manifest.exports)) {
    const targets = typeof target === 'string' ? [target] : Object.values(target)
    for (const value of targets) {
      if (typeof value !== 'string') continue
      const path = value.replace(/^\.\//u, '')
      if (!files.has(path)) throw new Error(`export ${subpath} points at missing ${path}`)
    }
  }

  const forbidden = [...files].filter(path => /^(src|tests|scripts|\.tmp)\//u.test(path))
  if (forbidden.length > 0) throw new Error(`packed artifact leaks workspace files: ${forbidden.join(', ')}`)

  run('tar', ['-xzf', artifact, '-C', extractDir])
  const extracted = join(extractDir, 'package')
  // Host entries are ESM and must import against the real dependency tree.
  symlinkSync(join(root, 'node_modules'), join(extractDir, 'node_modules'), 'dir')
  const indexPath = join(extracted, 'lib/index.js')
  if (existsSync(indexPath)) {
    await import(new URL(`file://${indexPath}`).href)
  }
  run(process.execPath, ['--check', join(extracted, 'lib/client.js')])
  const client = readFileSync(join(extracted, 'lib/client.js'), 'utf8')
  if (!client.includes('__ModuleLoader__.load')) throw new Error('client bundle is not a module-loader factory')
  if (!client.includes('会话契约') || !client.includes('Charter')) throw new Error('client bundle lost the bilingual tab label')
  console.log(`package-smoke: ${artifactInfo.filename} (${files.size} files) installs, exports resolve, client bundle loads`)
} finally {
  rmSync(work, { recursive: true, force: true })
}
