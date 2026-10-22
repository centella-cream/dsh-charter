// Verify the packed tarball as a real consumer would: pack it, assert its
// contents/modes, install it into an empty project, and load its Runtime entry.
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '../..')
const work = mkdtempSync(join(tmpdir(), 'dsh-charter-pack-'))
const packDir = join(work, 'pack')
const consumer = join(work, 'consumer')
const emptyNpmrc = join(work, 'empty.npmrc')
// Developer npm config may include project-scoped options that npm rejects in
// a temporary consumer (for example allow-scripts). Isolate the smoke.
const cleanEnv = { ...process.env, NO_COLOR: '1' }
for (const key of Object.keys(cleanEnv)) {
  if (/^npm_config_(userconfig|allow_scripts)$/iu.test(key)) delete cleanEnv[key]
}
cleanEnv.NPM_CONFIG_USERCONFIG = emptyNpmrc
cleanEnv.NPM_CONFIG_ALLOW_SCRIPTS = ''
writeFileSync(emptyNpmrc, '')

function run(command, args, options = {}) {
  const output = execFileSync(command, args, {
    cwd: root,
    encoding: 'utf8',
    env: cleanEnv,
    ...options,
  })
  return typeof output === 'string' ? output.trim() : ''
}

try {
  run('mkdir', ['-p', packDir, consumer])
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

  // Public files must not carry a 0600 mode from a local checkout.
  const listing = run('tar', ['-tvzf', artifact]).split('\n')
  for (const path of ['package.json', 'README.md', 'README.zh.md', 'LICENSE', 'lib/client.js']) {
    const line = listing.find(entry => entry.endsWith(` package/${path}`))
    if (line === undefined) throw new Error(`no tar listing for ${path}`)
    if (!line.startsWith('-rw-r--r--')) throw new Error(`${path} is not 0644 in the tarball: ${line.slice(0, 10)}`)
  }

  // A real empty consumer install: dependencies must resolve from the registry
  // (or cache), not from this workspace's node_modules.
  writeFileSync(join(consumer, 'package.json'), JSON.stringify({ private: true, type: 'module' }, null, 2))
  run('npm', [
    'install', artifact,
    '--no-audit', '--no-fund', '--ignore-scripts', '--prefer-offline',
    '--legacy-peer-deps',
    `--userconfig=${emptyNpmrc}`,
  ], { cwd: consumer })
  const installed = join(consumer, 'node_modules/dsh-charter')
  if (!existsSync(join(installed, 'lib/client.js'))) throw new Error('consumer install is missing the client bundle')
  for (const dependency of Object.keys(manifest.dependencies ?? {})) {
    if (!existsSync(join(consumer, 'node_modules', dependency, 'package.json'))) {
      throw new Error(`consumer install did not install runtime dependency ${dependency}`)
    }
  }
  run(process.execPath, ['--check', join(installed, 'lib/client.js')])
  const client = readFileSync(join(installed, 'lib/client.js'), 'utf8')
  if (!client.includes('__ModuleLoader__.load')) throw new Error('client bundle is not a module-loader factory')
  if (!client.includes('会话契约') || !client.includes('Charter')) throw new Error('client bundle lost the bilingual tab label')
  const coreImport = `import('dsh-charter/core').then(m => { if (!m.CHARTER_PROMPT_PREFIX?.startsWith('Current user-authored session charter.')) throw new Error('unexpected core export'); }).catch(e => { console.error(e); process.exit(1) })`
  run(process.execPath, ['--input-type=module', '-e', coreImport], { cwd: consumer })

  console.log(`package-smoke: ${artifactInfo.filename} (${files.size} files) installs in an empty consumer, dependencies resolve, packed Runtime entry loads`)
} finally {
  rmSync(work, { recursive: true, force: true })
}
