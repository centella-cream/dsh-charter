import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import { CHARTER_VERSION } from '../src/version.js'

async function packageVersion(): Promise<string> {
  const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8')) as {
    version: string
  }
  return pkg.version
}

describe('client version identifier', () => {
  it('matches the package version', async () => {
    expect(CHARTER_VERSION).toBe(await packageVersion())
  })

  it('does not use rc suffixes from 0.2.0 onward', async () => {
    const [major, minor] = (await packageVersion()).split('.').map(Number)
    if ((major ?? 0) > 0 || (minor ?? 0) >= 2) expect(await packageVersion()).not.toMatch(/-rc\./u)
  })
})
