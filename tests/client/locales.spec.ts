import { describe, expect, it } from 'vitest'
import { CHARTER_LOCALE } from '../../src/client/locales.js'

const placeholderPattern = /\{[A-Za-z0-9_]+\}/gu

function placeholders(value: string): readonly string[] {
  return [...value.matchAll(placeholderPattern)].map(match => match[0]).sort()
}

describe('client locale dictionaries', () => {
  it('keeps the English and Chinese key sets identical', () => {
    expect(Object.keys(CHARTER_LOCALE.en).sort()).toEqual(Object.keys(CHARTER_LOCALE.zh).sort())
  })

  it('keeps placeholders identical for every key', () => {
    for (const key of Object.keys(CHARTER_LOCALE.en) as Array<keyof typeof CHARTER_LOCALE.en>) {
      expect(placeholders(CHARTER_LOCALE.en[key]), key).toEqual(placeholders(CHARTER_LOCALE.zh[key]))
    }
  })

  it('never leaks Chinese characters into the English dictionary', () => {
    for (const [key, value] of Object.entries(CHARTER_LOCALE.en)) {
      expect(/[\u3400-\u9fff]/u.test(value), key).toBe(false)
    }
  })
})
