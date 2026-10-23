import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'

const SCRIPT = join(process.cwd(), 'scripts', 'verify', 'compaction-e2e.mjs')
const SESSION = 'session-cli-fixture'
const roots: string[] = []

function fixtureHome(): { home: string; store: string } {
  const root = mkdtempSync(join(tmpdir(), 'charter-transcript-'))
  roots.push(root)
  const directory = join(root, 'sessions', 'project', SESSION)
  mkdirSync(directory, { recursive: true })
  const store = join(root, 'record.json')
  writeFileSync(store, JSON.stringify({
    version: 1,
    record: {
      recordSchemaVersion: 1,
      identity: { createdAt: 0 },
      current: { revision: 0, items: [], promptText: '', promptDigest: '' },
      history: [],
      recentMutations: [],
    },
  }))
  return { home: root, store }
}

function runChecker(home: string, store: string) {
  return spawnSync(process.execPath, [
    SCRIPT,
    '--session', SESSION,
    '--home', home,
    '--store', store,
    '--json',
  ], { encoding: 'utf8' })
}

function runCheckerText(home: string, store: string) {
  return spawnSync(process.execPath, [
    SCRIPT,
    '--session', SESSION,
    '--home', home,
    '--store', store,
  ], { encoding: 'utf8' })
}

const VALID_LINE = '{"type":"turn/start","seq":1,"time":1,"data":{"turn":1}}'

afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true })
})

describe('transcript parsing refuses silent corruption', () => {
  it('ignores only a torn final line (incomplete append)', () => {
    const { home, store } = fixtureHome()
    writeFileSync(
      join(home, 'sessions', 'project', SESSION, 'session.v4.jsonl'),
      `${VALID_LINE}\n${VALID_LINE.replace('"seq":1', '"seq":2')}\n{"type":"turn/sta`,
    )
    const result = runChecker(home, store)
    expect(result.status).toBe(2) // charter not established: parsing succeeded
    expect(result.stderr).toContain('torn tail line')
    expect(result.stderr).not.toContain('transcript is corrupt')
  })

  it('rejects a malformed middle line with its line number', () => {
    const { home, store } = fixtureHome()
    writeFileSync(
      join(home, 'sessions', 'project', SESSION, 'session.v4.jsonl'),
      `${VALID_LINE}\n{"broken":\n${VALID_LINE.replace('"seq":1', '"seq":3')}\n`,
    )
    const result = runChecker(home, store)
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('transcript is corrupt')
    expect(result.stderr).toContain('line 2')
  })

  it('rejects a malformed complete final line', () => {
    const { home, store } = fixtureHome()
    writeFileSync(
      join(home, 'sessions', 'project', SESSION, 'session.v4.jsonl'),
      `${VALID_LINE}\n{"type":"turn/start","seq":2,\n`,
    )
    const result = runChecker(home, store)
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('transcript is corrupt')
    expect(result.stderr).toContain('line 2')
  })

  it('renders an OPEN compaction attempt without RangeError and waits', () => {
    const { home, store } = fixtureHome()
    writeFileSync(store, JSON.stringify({
      version: 1,
      record: {
        recordSchemaVersion: 1,
        identity: { createdAt: 0 },
        current: {
          revision: 1,
          items: [],
          promptText: 'x',
          promptDigest: `sha256:${'0'.repeat(64)}`,
        },
        history: [],
        recentMutations: [],
      },
    }))
    writeFileSync(
      join(home, 'sessions', 'project', SESSION, 'session.v4.jsonl'),
      '{"type":"compaction/start","seq":10,"time":1000,"data":{"compactionId":"open-1"}}\n',
    )
    const result = runCheckerText(home, store)
    expect(result.status).toBe(3)
    expect(result.stdout).toContain('OPEN')
    expect(result.stderr).not.toContain('RangeError')
    expect(result.stdout).toContain('WAIT')
  })
})
