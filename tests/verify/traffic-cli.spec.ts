import { execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'

const script = fileURLToPath(new URL('../../scripts/verify/traffic-check.mjs', import.meta.url))
const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

describe('traffic-check CLI identity', () => {
  it('resolves a short Session id and uses the header id for --log', async () => {
    const home = await mkdtemp(join(tmpdir(), 'traffic-cli-home-'))
    roots.push(home)
    const directory = join(home, 'sessions', 'project', 'short-id')
    await mkdir(directory, { recursive: true })
    const log = join(directory, 'session.v4.jsonl')
    await writeFile(log, [
      JSON.stringify({ type: 'session', version: 4, id: 'short-id', createdAt: 1 }),
      JSON.stringify({ type: 'step/start', seq: 1, time: 1, data: { turn: 1, step: 1 } }),
      '',
    ].join('\n'))

    const bySession = JSON.parse(execFileSync(process.execPath, [script, '--session', 'short-id', '--home', home, '--json'], { encoding: 'utf8' }))
    expect(bySession.sessionId).toBe('short-id')

    const byLog = JSON.parse(execFileSync(process.execPath, [script, '--log', log, '--json'], { encoding: 'utf8' }))
    expect(byLog.sessionId).toBe('short-id')
  })
})
