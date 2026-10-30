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

async function fixture(directoryName: string, headerId: string): Promise<{ home: string; log: string }> {
  const home = await mkdtemp(join(tmpdir(), 'traffic-cli-home-'))
  roots.push(home)
  const directory = join(home, 'sessions', 'project', directoryName)
  await mkdir(directory, { recursive: true })
  const log = join(directory, 'session.v4.jsonl')
  await writeFile(log, [
    JSON.stringify({ type: 'session', version: 4, id: headerId, createdAt: 1 }),
    JSON.stringify({ type: 'step/start', seq: 1, time: 1, data: { turn: 1, step: 1 } }),
    '',
  ].join('\n'))
  return { home, log }
}

describe('traffic-check CLI identity', () => {
  it('resolves a bare Session id through the session-<id> directory', async () => {
    const uuid = 'f0aaa8dd-05bf-4a85-9a5e-b4bd016f6dd3'
    const { home } = await fixture(`session-${uuid}`, `session-${uuid}`)
    const report = JSON.parse(execFileSync(
      process.execPath,
      [script, '--session', uuid, '--home', home, '--json'],
      { encoding: 'utf8' },
    ))
    expect(report.sessionId).toBe(`session-${uuid}`)
  })

  it('uses the transcript header id for --log when the directory has another name', async () => {
    const { log } = await fixture('container', 'real-header-id')
    const report = JSON.parse(execFileSync(process.execPath, [script, '--log', log, '--json'], { encoding: 'utf8' }))
    expect(report.sessionId).toBe('real-header-id')
  })
})
