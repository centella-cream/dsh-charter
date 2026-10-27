import { createHash } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { gzipSync } from 'node:zlib'
import { afterAll, describe, expect, it } from 'vitest'
import {
  parseArgs,
  parsePackOutput,
  parseSumsDigest,
  parseTarball,
  validatePackedManifest,
  verifyArtifactDigest,
} from '../../scripts/verify/package-smoke.mjs'

const roots: string[] = []

function workdir(): string {
  const root = mkdtempSync(join(tmpdir(), 'charter-package-smoke-'))
  roots.push(root)
  return root
}

afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true })
})



describe('published DSH compatibility metadata', () => {
  const expected = [
    '0.1.7-rc.2',
    '0.2.0-rc.1',
    '0.2.0-rc.2',
    '0.2.1-rc.1',
    '0.2.1-rc.2',
    '0.2.1-rc.3',
    '0.2.1-rc.4',
  ].join(' || ')

  it('keeps engines.dsh and every DSH peer range in sync with the verified matrix', () => {
    const pkg = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')) as {
      engines: Record<string, string>
      peerDependencies: Record<string, string>
      dsh?: { compatibility?: { dshReleases?: Record<string, string> } }
    }
    expect(pkg.engines.dsh).toBe(expected)
    const peers = Object.entries(pkg.peerDependencies).filter(([name]) => name.startsWith('@deepseek-ai/dsh-'))
    expect(peers.length).toBeGreaterThan(0)
    for (const [name, range] of peers) expect(range, name).toBe(expected)
    const releases = pkg.dsh?.compatibility?.dshReleases ?? {}
    expect(Object.keys(releases).sort()).toEqual(expected.split(' || ').sort())
    for (const [version, status] of Object.entries(releases)) expect(status, version).toBe('compatible')
  })
})

const ARTIFACT = 'dsh-charter-0.1.0-rc.1.tgz'

describe('npm pack JSON parsing', () => {
  it('parses the npm 10/11 object form and the npm 12 array form with trailing newlines', () => {
    const info = { name: 'dsh-charter', version: '0.1.0-rc.1', filename: ARTIFACT, files: [] }
    expect(parsePackOutput(JSON.stringify(info))).toMatchObject({ filename: ARTIFACT })
    // Array output must be parsed as a whole: slicing from the first `{` would
    // leave a trailing `]` and fail.
    expect(parsePackOutput(`${JSON.stringify([info])}\n`)).toMatchObject({ filename: ARTIFACT })
    expect(parsePackOutput(`  \n${JSON.stringify([info])}\n\n`)).toMatchObject({ filename: ARTIFACT })
    // This npm 12 emits an object keyed by package name.
    expect(parsePackOutput(JSON.stringify({ 'dsh-charter': info }))).toMatchObject({ filename: ARTIFACT })
  })

  it('rejects non-JSON, wrong shapes, and empty arrays', () => {
    expect(() => parsePackOutput('')).toThrow(/no JSON/)
    expect(() => parsePackOutput('npm notice something')).toThrow(/parseable JSON/)
    expect(() => parsePackOutput('[]')).toThrow(/exactly one/)
    expect(() => parsePackOutput(JSON.stringify([{ name: 'x' }]))).toThrow(/exactly one/)
  })
})

describe('SHA-256 sums parsing and artifact verification', () => {
  const digest = 'a'.repeat(64)

  it('resolves exactly one matching sums entry by basename', () => {
    expect(parseSumsDigest(`${digest}  dist/${ARTIFACT}\n`, ARTIFACT)).toBe(digest)
    expect(parseSumsDigest(`${'b'.repeat(64)}  other.tgz\n${digest} *${ARTIFACT}\n`, ARTIFACT)).toBe(digest)
    expect(() => parseSumsDigest(`${digest}  other.tgz\n`, ARTIFACT)).toThrow(/no SHA-256 entry/)
    expect(() => parseSumsDigest(`${digest}  ${ARTIFACT}\n${digest}  dist/${ARTIFACT}\n`, ARTIFACT))
      .toThrow(/more than one/)
  })

  it('accepts a matching artifact and rejects a SHA mismatch', () => {
    const root = workdir()
    const artifact = join(root, ARTIFACT)
    writeFileSync(artifact, 'exact artifact bytes')
    const actual = createHash('sha256').update('exact artifact bytes').digest('hex')
    const goodSums = join(root, 'SHA256SUMS')
    writeFileSync(goodSums, `${actual}  ${ARTIFACT}\n`)
    expect(verifyArtifactDigest(artifact, goodSums)).toEqual({ actual, expected: actual })

    const badSums = join(root, 'SHA256SUMS.bad')
    writeFileSync(badSums, `${'0'.repeat(64)}  ${ARTIFACT}\n`)
    expect(() => verifyArtifactDigest(artifact, badSums)).toThrow(/SHA-256 mismatch/)
    expect(() => verifyArtifactDigest(join(root, 'missing.tgz'), goodSums)).toThrow(/does not exist/)
  })
})

describe('artifact-mode argument parsing', () => {
  it('requires --artifact and --sha256 together and rejects unknown flags', () => {
    expect(parseArgs([])).toEqual({ artifact: undefined, sha256: undefined })
    expect(parseArgs(['--artifact', ARTIFACT, '--sha256', 'SHA256SUMS']))
      .toEqual({ artifact: ARTIFACT, sha256: 'SHA256SUMS' })
    expect(() => parseArgs(['--artifact', ARTIFACT])).toThrow(/together/)
    expect(() => parseArgs(['--sha256', 'SHA256SUMS'])).toThrow(/together/)
    expect(() => parseArgs(['--artifact'])).toThrow(/missing value/)
    expect(() => parseArgs(['--unknown'])).toThrow(/unknown argument/)
  })
})

const BLOCK = 512

function octal(value: number, length: number): Buffer {
  return Buffer.from(`${value.toString(8).padStart(length - 1, '0')}\0`, 'ascii')
}

function tarHeader(options: {
  readonly name: string
  readonly size?: number
  readonly mode?: number
  readonly typeflag?: string
  readonly linkname?: string
  readonly magic?: string
  readonly version?: string
  readonly prefix?: string
  readonly corruptChecksum?: boolean
}): Buffer {
  const header = Buffer.alloc(BLOCK)
  header.write(options.name.slice(0, 100), 0, 'utf8')
  octal(options.mode ?? 0o644, 8).copy(header, 100)
  octal(0, 8).copy(header, 108)
  octal(0, 8).copy(header, 116)
  octal(options.size ?? 0, 12).copy(header, 124)
  octal(0, 12).copy(header, 136)
  header.write('        ', 148, 'ascii')
  header.write(options.typeflag ?? '0', 156, 'ascii')
  header.write((options.linkname ?? '').slice(0, 100), 157, 'utf8')
  header.write(options.magic ?? 'ustar\0', 257, 'ascii')
  header.write(options.version ?? '00', 263, 'ascii')
  header.write('user', 265, 'ascii')
  header.write('group', 297, 'ascii')
  octal(0, 8).copy(header, 329)
  octal(0, 8).copy(header, 337)
  header.write((options.prefix ?? '').slice(0, 155), 345, 'utf8')
  let checksum = 0
  for (const byte of header) checksum += byte
  header.write(`${checksum.toString(8).padStart(6, '0')}\0 `, 148, 'ascii')
  if (options.corruptChecksum === true) header[0] = (header[0]! + 1) % 256
  return header
}

function tarEntry(options: Parameters<typeof tarHeader>[0] & { readonly data?: Buffer }): Buffer[] {
  const data = options.data ?? Buffer.alloc(0)
  const padding = Buffer.alloc((BLOCK - (data.length % BLOCK)) % BLOCK)
  return [tarHeader({ ...options, size: data.length }), data, padding]
}

function tarArchive(entries: Buffer[][]): Buffer {
  return gzipSync(Buffer.concat([...entries.flat(), Buffer.alloc(BLOCK * 2)]))
}

const MANIFEST = Buffer.from(JSON.stringify({
  name: 'dsh-charter',
  version: '0.1.0-rc.1',
  exports: { '.': './lib/index.js' },
  dependencies: {},
  files: ['lib'],
}))

function validArchive(): Buffer {
  return tarArchive([
    tarEntry({ name: 'package/', typeflag: '5', mode: 0o755 }),
    tarEntry({ name: 'package/package.json', data: MANIFEST }),
    tarEntry({ name: 'package/lib/index.js', data: Buffer.from('export {}') }),
  ])
}

describe('structured Node tar parsing for exact-artifact validation', () => {
  it('parses a standard ustar archive and exposes files, dirs and 0644 modes', () => {
    const parsed = parseTarball(validArchive())
    expect([...parsed.files.keys()].sort()).toEqual(['lib/index.js', 'package.json'])
    expect(parsed.directories.has('package')).toBe(true)
    expect(parsed.modes.get('package.json')).toBe(0o644)
    expect(JSON.parse(parsed.files.get('package.json')!.toString('utf8'))).toMatchObject({ name: 'dsh-charter' })
  })

  it('parses GNU-style ustar magic and PAX long paths', () => {
    const gnu = tarArchive([
      tarEntry({
        name: 'package/gnu.txt',
        magic: 'ustar ',
        version: ' \0',
        data: Buffer.from('gnu'),
      }),
    ])
    expect([...parseTarball(gnu).files.keys()]).toEqual(['gnu.txt'])

    const longPath = `package/${'deep/'.repeat(30)}file.txt`
    const paxRecord = (key: string, value: string): Buffer => {
      const body = `${key}=${value}\n`
      let length = body.length + 2
      while (`${length} ${body}`.length !== length) length = `${length} ${body}`.length
      return Buffer.from(`${length} ${body}`, 'utf8')
    }
    const pax = tarArchive([
      tarEntry({ name: 'PaxHeader', typeflag: 'x', data: Buffer.concat([paxRecord('path', longPath)]) }),
      tarEntry({ name: 'package/placeholder', data: Buffer.from('pax') }),
    ])
    const parsed = parseTarball(pax)
    expect(parsed.files.has(longPath.replace(/^package\//u, ''))).toBe(true)
  })

  it('parses GNU longname headers', () => {
    const longPath = `package/${'x'.repeat(140)}.txt`
    const archive = tarArchive([
      tarEntry({ name: '././@LongLink', typeflag: 'L', data: Buffer.from(`${longPath}\0`, 'utf8') }),
      tarEntry({ name: 'package/short', data: Buffer.from('long') }),
    ])
    const parsed = parseTarball(archive)
    expect([...parsed.files.keys()]).toEqual([longPath.replace(/^package\//u, '')])
  })

  it('rejects links, special members, duplicates, traversal, absolute and outside-package paths', () => {
    const reject = (archive: Buffer, pattern: RegExp) => {
      expect(() => parseTarball(archive)).toThrow(pattern)
    }
    reject(tarArchive([tarEntry({ name: 'package/link', typeflag: '2', linkname: 'package/package.json' })]), /link/)
    reject(tarArchive([tarEntry({ name: 'package/hard', typeflag: '1', linkname: 'package/package.json' })]), /link/)
    reject(tarArchive([tarEntry({ name: 'package/fifo', typeflag: '6' })]), /not a regular file or directory/)
    reject(tarArchive([
      tarEntry({ name: 'package/package.json', data: MANIFEST }),
      tarEntry({ name: 'package/package.json', data: MANIFEST }),
    ]), /more than once/)
    reject(tarArchive([tarEntry({ name: 'package/../evil', data: Buffer.from('x') })]), /traverses/)
    reject(tarArchive([tarEntry({ name: '/etc/passwd', data: Buffer.from('x') })]), /absolute/)
    reject(tarArchive([tarEntry({ name: 'other/file', data: Buffer.from('x') })]), /outside package/)
  })

  it('rejects corrupt checksums and truncated member data', () => {
    expect(() => parseTarball(tarArchive([
      tarEntry({ name: 'package/package.json', data: MANIFEST, corruptChecksum: true }),
    ]))).toThrow(/checksum/)
    // Declared size larger than the available data blocks.
    const header = tarHeader({ name: 'package/package.json', size: 4096 })
    expect(() => parseTarball(gzipSync(Buffer.concat([header, Buffer.alloc(BLOCK)]))))
      .toThrow(/truncated|out of bounds/)
  })
})

describe('packed manifest validation against the working tree', () => {
  const expected = {
    name: 'dsh-charter',
    version: '0.1.0-rc.1',
    exports: { '.': './lib/index.js' },
    dependencies: { zod: '^3.0.0' },
    peerDependencies: {},
    engines: { node: '>=22' },
    files: ['lib'],
  }

  it('accepts a matching packed manifest and rejects disagreements', () => {
    const packed = { ...expected, files: [...expected.files] }
    expect(validatePackedManifest(packed, expected)).toMatchObject({ name: 'dsh-charter' })
    expect(() => validatePackedManifest({ ...packed, name: 'other' }, expected)).toThrow(/identity/)
    expect(() => validatePackedManifest({ ...packed, files: ['other'] }, expected)).toThrow(/files whitelist/)
    expect(() => validatePackedManifest({ ...packed, exports: null }, expected)).toThrow(/exports/)
    expect(() => validatePackedManifest({ ...packed, dependencies: [] }, expected)).toThrow(/dependencies/)
    expect(() => validatePackedManifest({ ...packed, peerDependencies: { x: '1' } }, expected)).toThrow(/peerDependencies/)
    expect(() => validatePackedManifest(null as never, expected)).toThrow(/not an object/)
  })
})
