import { createHash } from 'node:crypto'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import {
  parseArgs,
  parsePackOutput,
  parseSumsDigest,
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
