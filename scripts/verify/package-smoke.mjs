// Verify the packed tarball as a real consumer would: pack it (or, in artifact
// mode, reuse an already-built exact tarball), assert its contents/modes,
// install it into an empty project, load the pure `core` entry, and check the
// client bundle. Importing the Host/Remote Runtime entries needs the Host peer
// graph, so that is covered by the workspace build's remote-smoke/client-smoke,
// not by this empty consumer.
//
// Normal mode (`npm run smoke:package`) builds and packs.
// Artifact mode (`npm run smoke:package -- --artifact <tgz> --sha256 <sums>`)
// never builds or packs: it validates the supplied archive against the supplied
// SHA-256 sums file and runs the same consumer checks on those exact bytes, so
// release docs, the GitHub release asset, and `npm publish` can reuse the very
// file that passed this check.
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import { gunzipSync } from 'node:zlib'
import { tmpdir } from 'node:os'
import { basename, join, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '../..')

/**
 * Parse `npm pack --json` output. npm 10/11/12 emit either a single object or a
 * one-element array, with trailing whitespace/newlines; the full trimmed output
 * is parsed as JSON (never sliced from the first brace, which would turn a
 * valid array into an invalid fragment).
 */
export function parsePackOutput(packOutput) {
  const trimmed = String(packOutput).trim()
  if (trimmed === '') throw new Error('npm pack returned no JSON output')
  let parsed
  try {
    parsed = JSON.parse(trimmed)
  } catch (error) {
    throw new Error(
      `npm pack did not return parseable JSON; full output starts with ${JSON.stringify(trimmed.slice(0, 200))}: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
  // npm 10/11 may emit one object; this npm 12 emits an object keyed by package
  // name; other versions emit a one-element array. Accept each shape.
  let entries
  if (Array.isArray(parsed)) entries = parsed
  else if (parsed !== null && typeof parsed === 'object' && Object.hasOwn(parsed, 'filename')) entries = [parsed]
  else if (parsed !== null && typeof parsed === 'object') entries = Object.values(parsed)
  else throw new Error(`npm pack JSON is not an object or array: ${trimmed.slice(0, 120)}`)
  const artifacts = entries.filter(entry => entry !== null
    && typeof entry === 'object'
    && typeof entry.filename === 'string')
  if (artifacts.length !== 1) throw new Error(`expected exactly one packed artifact, got ${artifacts.length}`)
  return artifacts[0]
}

/**
 * Resolve the expected SHA-256 for `filename` from `sums` (the tracked
 * `sha256sum`-style file). Exactly one matching entry is required.
 */
export function parseSumsDigest(sums, filename) {
  const expected = basename(filename)
  const matches = []
  for (const line of String(sums).split('\n')) {
    const trimmed = line.trim()
    if (trimmed === '') continue
    const match = /^([a-f0-9]{64})\s+\*?(.+)$/u.exec(trimmed)
    if (match === null) continue
    if (basename(match[2].trim()) === expected) matches.push(match[1])
  }
  if (matches.length === 0) throw new Error(`no SHA-256 entry for ${expected} in the supplied sums file`)
  if (matches.length > 1) throw new Error(`more than one SHA-256 entry for ${expected} in the supplied sums file`)
  return matches[0]
}

/** Validate an existing artifact against the supplied sums file; no build/pack. */
export function verifyArtifactDigest(artifact, sumsFile) {
  if (!existsSync(artifact)) throw new Error(`artifact does not exist: ${artifact}`)
  const expected = parseSumsDigest(readFileSync(sumsFile, 'utf8'), artifact)
  const actual = createHash('sha256').update(readFileSync(artifact)).digest('hex')
  if (actual !== expected) {
    throw new Error(`artifact SHA-256 mismatch: sums file says ${expected}, actual bytes hash to ${actual}`)
  }
  return { actual, expected }
}

/** Parse `--artifact <tgz>` / `--sha256 <sums>` (both or neither). */
export function parseArgs(argv) {
  const args = { artifact: undefined, sha256: undefined }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg !== '--artifact' && arg !== '--sha256') throw new Error(`unknown argument: ${arg}`)
    const value = argv[index + 1]
    if (value === undefined) throw new Error(`missing value for ${arg}`)
    if (arg === '--artifact') args.artifact = value
    else args.sha256 = value
    index += 1
  }
  if ((args.artifact === undefined) !== (args.sha256 === undefined)) {
    throw new Error('--artifact and --sha256 must be passed together')
  }
  return args
}

const TAR_BLOCK = 512

function tarString(bytes, offset, length) {
  let end = offset
  const limit = offset + length
  while (end < limit && bytes[end] !== 0) end += 1
  return bytes.toString('utf8', offset, end)
}

function tarNumber(bytes, offset, length) {
  // Octal field, optionally base-256 (GNU extension used for large sizes).
  if ((bytes[offset] & 0x80) !== 0) {
    let value = 0n
    for (let index = offset + 1; index < offset + length; index += 1) {
      value = (value << 8n) | BigInt(bytes[index])
    }
    return Number(value)
  }
  const text = tarString(bytes, offset, length).replace(/\0.*$/u, '').trim()
  if (text === '') return 0
  if (!/^[0-7]+$/u.test(text)) throw new Error(`invalid tar numeric field ${JSON.stringify(text)}`)
  return Number.parseInt(text, 8)
}

function tarChecksumOk(header) {
  const stored = tarNumber(header, 148, 8)
  let unsigned = 0
  let signed = 0
  for (let index = 0; index < TAR_BLOCK; index += 1) {
    const byte = index >= 148 && index < 156 ? 32 : header[index]
    unsigned += byte
    signed += byte > 127 ? byte - 256 : byte
  }
  return stored === unsigned || stored === signed
}

function parsePaxRecords(buffer) {
  const fields = {}
  let offset = 0
  while (offset < buffer.length) {
    const space = buffer.indexOf(0x20, offset)
    if (space < 0) break
    const length = Number.parseInt(buffer.toString('utf8', offset, space), 10)
    if (!Number.isFinite(length) || length <= 0) throw new Error('invalid PAX record length')
    const end = offset + length
    if (end > buffer.length) throw new Error('truncated PAX record')
    const record = buffer.toString('utf8', space + 1, end - 1)
    const equals = record.indexOf('=')
    if (equals < 0) throw new Error('invalid PAX record')
    fields[record.slice(0, equals)] = record.slice(equals + 1)
    offset = end
  }
  return fields
}

function normalizeMemberPath(path) {
  if (typeof path !== 'string' || path === '') throw new Error('tar member has an empty path')
  if (path.startsWith('/') || /^[A-Za-z]:/u.test(path)) throw new Error(`tar member has an absolute path: ${path}`)
  if (path.includes('\\')) throw new Error(`tar member contains a backslash: ${path}`)
  const segments = path.split('/').filter(segment => segment !== '')
  if (segments.some(segment => segment === '..' || segment === '.')) {
    throw new Error(`tar member traverses directories: ${path}`)
  }
  if (!(path === 'package' || path.startsWith('package/'))) {
    throw new Error(`tar member is outside package/: ${path}`)
  }
  return path.endsWith('/') ? path.slice(0, -1) : path
}

/**
 * Parse a gzipped tarball with a structured Node reader (no shelling out to a
 * platform `tar`): 512-byte ustar/PAX headers, checksum verification, GNU
 * longname/longlink and PAX path handling. Only regular files and directories
 * under `package/` are accepted; links, special files, traversal/absolute
 * paths, duplicates, truncation/out-of-bounds data and corrupt checksums are
 * rejected. All file bytes are held in memory so `package/package.json` can be
 * validated before anything is installed.
 */
export function parseTarball(tarball) {
  const bytes = gunzipSync(tarball)
  const files = new Map()
  const directories = new Set()
  const modes = new Map()
  const seen = new Set()
  let offset = 0
  let longName
  let longLink
  let pax = {}
  let nextPax = {}
  while (offset < bytes.length) {
    if (offset + TAR_BLOCK > bytes.length) throw new Error('truncated tar header')
    const header = bytes.subarray(offset, offset + TAR_BLOCK)
    if (header.every(byte => byte === 0)) break
    if (!tarChecksumOk(header)) throw new Error('tar header checksum mismatch')
    const typeflag = String.fromCharCode(header[156] === 0 ? 48 : header[156])
    const size = tarNumber(header, 124, 12)
    if (!Number.isSafeInteger(size) || size < 0) throw new Error('tar member has an invalid size')
    const dataOffset = offset + TAR_BLOCK
    const dataEnd = dataOffset + size
    const nextOffset = dataOffset + Math.ceil(size / TAR_BLOCK) * TAR_BLOCK
    if (dataEnd > bytes.length || nextOffset > bytes.length) {
      throw new Error('tar member data is truncated/out of bounds')
    }
    const data = bytes.subarray(dataOffset, dataEnd)
    if (typeflag === 'x') {
      nextPax = parsePaxRecords(data)
      offset = nextOffset
      continue
    }
    if (typeflag === 'g') {
      // Global PAX headers are not emitted by our packer; their content is not
      // security-relevant for member names/sizes, so they advance the stream.
      offset = nextOffset
      continue
    }
    if (typeflag === 'L') {
      longName = tarString(data, 0, data.length)
      offset = nextOffset
      continue
    }
    if (typeflag === 'K') {
      longLink = tarString(data, 0, data.length)
      offset = nextOffset
      continue
    }
    const nameField = tarString(header, 0, 100)
    const prefix = tarString(header, 345, 155)
    const name = longName
      ?? nextPax.path
      ?? (prefix === '' ? nameField : `${prefix}/${nameField}`)
    const linkname = longLink ?? nextPax.linkpath ?? tarString(header, 157, 100)
    longName = undefined
    longLink = undefined
    pax = nextPax
    nextPax = {}
    const path = normalizeMemberPath(name)
    if (seen.has(path)) throw new Error(`tar member appears more than once: ${path}`)
    seen.add(path)
    const mode = tarNumber(header, 100, 8)
    if (typeflag === '1' || typeflag === '2') {
      throw new Error(`tar member is a link, not a regular file: ${path} -> ${linkname}`)
    }
    if (typeflag !== '0' && typeflag !== '5') {
      throw new Error(`tar member is not a regular file or directory: ${path} (type ${typeflag})`)
    }
    if (typeflag === '5') {
      directories.add(path)
    } else {
      files.set(path.replace(/^package\//u, ''), data)
      modes.set(path.replace(/^package\//u, ''), mode & 0o777)
    }
    pax = {}
    offset = nextOffset
  }
  return { files, directories, modes, members: seen.size }
}

/**
 * Validate the manifest STORED IN THE TARBALL: it is the authoritative source
 * for exports/dependencies, and its identity/files/metadata must match the
 * working tree that produced it (the working-tree manifest is only the expected
 * identity for the artifact name/version).
 */
export function validatePackedManifest(packed, expected) {
  if (packed === null || typeof packed !== 'object' || Array.isArray(packed)) {
    throw new Error('packed package/package.json is not an object')
  }
  if (packed.name !== expected.name || packed.version !== expected.version) {
    throw new Error(`packed manifest identity ${packed.name}@${packed.version} does not match ${expected.name}@${expected.version}`)
  }
  if (typeof packed.exports !== 'object' || packed.exports === null || Array.isArray(packed.exports)) {
    throw new Error('packed manifest has no exports object')
  }
  if (packed.dependencies !== undefined
    && (typeof packed.dependencies !== 'object' || packed.dependencies === null || Array.isArray(packed.dependencies))) {
    throw new Error('packed manifest dependencies is not an object')
  }
  if (!Array.isArray(packed.files) || packed.files.some(entry => typeof entry !== 'string')) {
    throw new Error('packed manifest has no files whitelist array')
  }
  const expectedFiles = Array.isArray(expected.files) ? expected.files : []
  if (JSON.stringify(packed.files) !== JSON.stringify(expectedFiles)) {
    throw new Error('packed manifest files whitelist differs from the working tree')
  }
  for (const key of ['exports', 'peerDependencies', 'engines', 'dependencies']) {
    if (JSON.stringify(packed[key] ?? null) !== JSON.stringify(expected[key] ?? null)) {
      throw new Error(`packed manifest ${key} differs from the working tree`)
    }
  }
  return packed
}

function verifyArtifactContents({ artifact, consumer, emptyNpmrc, run }) {
  const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
  const expectedFilename = `${manifest.name}-${manifest.version}.tgz`
  if (basename(artifact) !== expectedFilename) {
    throw new Error(`artifact name ${basename(artifact)} does not match ${expectedFilename}`)
  }

  // Security validation before any extraction/install: structured Node tar
  // parsing (headers/checksums/PAX) yields a pure `package/` file+dir tree and
  // the packed manifest bytes in memory. No platform `tar` is involved.
  const archive = parseTarball(readFileSync(artifact))
  const files = new Set(archive.files.keys())
  const packedManifestBytes = archive.files.get('package.json')
  if (packedManifestBytes === undefined) throw new Error('packed artifact is missing package.json')
  const packedManifest = validatePackedManifest(
    JSON.parse(packedManifestBytes.toString('utf8')),
    manifest,
  )
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
  for (const [subpath, target] of Object.entries(packedManifest.exports)) {
    const targets = typeof target === 'string' ? [target] : Object.values(target)
    for (const value of targets) {
      if (typeof value !== 'string') continue
      const path = value.replace(/^\.\//u, '')
      if (!files.has(path)) throw new Error(`export ${subpath} points at missing ${path}`)
    }
  }
  const forbidden = [...files].filter(path => /^(src|tests|scripts|\.tmp)\//u.test(path))
  if (forbidden.length > 0) throw new Error(`packed artifact leaks workspace files: ${forbidden.join(', ')}`)

  // Public files must be 0644 in the archive (checked from parsed header modes).
  for (const path of ['package.json', 'README.md', 'README.zh.md', 'LICENSE', 'lib/client.js']) {
    if (!files.has(path)) throw new Error(`packed artifact is missing ${path}`)
    const mode = archive.modes.get(path)
    if (mode === undefined || mode !== 0o644) {
      throw new Error(`${path} is not 0644 in the tarball: ${mode === undefined ? 'no file mode' : `0${mode.toString(8)}`}`)
    }
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
  for (const dependency of Object.keys(packedManifest.dependencies ?? {})) {
    if (!existsSync(join(consumer, 'node_modules', dependency, 'package.json'))) {
      throw new Error(`consumer install did not install runtime dependency ${dependency}`)
    }
  }
  run(process.execPath, ['--check', join(installed, 'lib/client.js')])
  const client = readFileSync(join(installed, 'lib/client.js'), 'utf8')
  if (!client.includes('__ModuleLoader__.load')) throw new Error('client bundle is not a module-loader factory')
  if (!client.includes('会话契约') || !client.includes('Charter')) throw new Error('client bundle lost the bilingual tab label')
  // The pure core entry has no Host peer imports, so an empty consumer can
  // load it. Root/Remote runtime imports are asserted structurally above
  // (export targets + files) and exercised by the workspace smoke scripts.
  const coreImport = `import('dsh-charter/core').then(m => { if (!m.CHARTER_PROMPT_PREFIX?.startsWith('Current user-authored session charter.')) throw new Error('unexpected core export'); }).catch(e => { console.error(e); process.exit(1) })`
  run(process.execPath, ['--input-type=module', '-e', coreImport], { cwd: consumer })
  for (const path of ['lib/index.js', 'lib/remote.js', 'lib/index.d.ts', 'lib/remote.d.ts']) {
    if (!existsSync(join(installed, path))) throw new Error(`consumer install is missing ${path}`)
  }
  return files
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
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
  const run = (command, runArgs, options = {}) => {
    const output = execFileSync(command, runArgs, {
      cwd: root,
      encoding: 'utf8',
      env: cleanEnv,
      ...options,
    })
    return typeof output === 'string' ? output.trim() : ''
  }

  try {
    run('mkdir', ['-p', packDir, consumer])
    let artifact
    let digestNote
    if (args.artifact !== undefined) {
      // Exact-artifact mode: never build or pack; validate these exact bytes.
      artifact = resolve(args.artifact)
      const { actual } = verifyArtifactDigest(artifact, resolve(args.sha256))
      digestNote = `sha256 ${actual} matched ${basename(resolve(args.sha256))}`
    } else {
      // Build first so pack can skip prepack and keep --json machine-readable.
      run('npm', ['run', 'build'], { stdio: 'ignore' })
      const artifactInfo = parsePackOutput(
        run('npm', ['pack', '--json', '--ignore-scripts', '--pack-destination', packDir]),
      )
      artifact = join(packDir, artifactInfo.filename)
      const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
      if (artifactInfo.name !== manifest.name || artifactInfo.version !== manifest.version) {
        throw new Error(`packed identity mismatch: ${artifactInfo.name}@${artifactInfo.version}`)
      }
      digestNote = 'freshly packed'
    }
    const files = verifyArtifactContents({ artifact, consumer, emptyNpmrc, run })
    const mode = args.artifact === undefined ? '' : ' (exact existing artifact; no build/pack)'
    console.log(
      `package-smoke: ${basename(artifact)} (${files.size} files, ${digestNote})${mode} installs in an empty consumer, `
      + 'dependencies resolve, root/remote exports and files exist, packed core import loads, client bundle is valid',
    )
  } finally {
    rmSync(work, { recursive: true, force: true })
  }
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === resolve(import.meta.filename)) {
  await main()
}
