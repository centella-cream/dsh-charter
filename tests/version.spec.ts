import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import { CHARTER_VERSION } from '../src/version.js'

describe('client version identifier', () => {
  it('matches the package version', async () => {
    const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8')) as {
      version: string
    }
    expect(CHARTER_VERSION).toBe(pkg.version)
  })
})
