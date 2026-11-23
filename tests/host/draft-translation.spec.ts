import { describe, expect, it } from 'vitest'
type FakeChunk = { readonly type: string; readonly index?: number; readonly text?: string; readonly block?: { readonly type?: string; readonly text?: string }; readonly reason?: { readonly kind?: string } }
type FakeLlm = { stream(options: unknown): AsyncIterable<FakeChunk> }
import { translateDraftItems } from '../../src/host/draft-translation.js'
import type { CharterBootstrapDraftItem } from '../../src/host/types.js'

function item(ref: string, text: string, kind: CharterBootstrapDraftItem['kind'] = 'invariant'): CharterBootstrapDraftItem {
  return { ref, kind, text, lang: 'zh', oversized: false }
}

function fakeLlm(json: string, finish: 'stop' | 'max-tokens' = 'stop'): FakeLlm {
  return {
    async *stream() {
      yield { type: 'block-start', index: 0 }
      yield { type: 'text-delta', index: 0, text: json }
      yield { type: 'block-end', index: 0, block: { type: 'text', text: json } }
      yield {
        type: 'finish',
        reason: finish === 'stop' ? { kind: 'stop' } : { kind: 'max-tokens' },
      }
    },
  }
}

describe('draft translation', () => {
  it('translates active refs and keeps the exact ref set', async () => {
    const result = await translateDraftItems(
      fakeLlm(JSON.stringify({ items: [
        { ref: 'd-obj-0', text: 'Write tests.' },
        { ref: 'd-inv-0', text: 'Keep the API stable.' },
      ] })),
      { provider: 'p', model: 'm' },
      'en',
      [item('d-obj-0', '编写测试。', 'objective'), item('d-inv-0', '保持 API 稳定。')],
    )
    expect(result.items.map(entry => entry.text)).toEqual(['Write tests.', 'Keep the API stable.'])
    expect(result.provider).toBe('p')
  })

  it('keeps source refs when a model response is incomplete or malformed', async () => {
    const incomplete = await translateDraftItems(
      fakeLlm(JSON.stringify({ items: [{ ref: 'd-inv-0', text: 'Only one' }] })),
      { provider: 'p', model: 'm' },
      'en',
      [item('d-obj-0', '编写测试。', 'objective'), item('d-inv-0', '保持 API 稳定。')],
    )
    expect(incomplete.translatedRefs).toEqual(['d-inv-0'])
    expect(incomplete.failedRefs).toEqual(['d-obj-0'])
    expect(incomplete.items.map(entry => entry.text)).toEqual(['编写测试。', 'Only one'])
    const malformed = await translateDraftItems(
      fakeLlm('not json'),
      { provider: 'p', model: 'm' },
      'en',
      [item('d-inv-0', '保持 API 稳定。')],
    )
    expect(malformed.translatedRefs).toEqual([])
    expect(malformed.failedRefs).toEqual(['d-inv-0'])
  })

  it('keeps a max-token batch as source instead of accepting partial text', async () => {
    const result = await translateDraftItems(
      fakeLlm(JSON.stringify({ items: [{ ref: 'd-inv-0', text: 'Keep stable.' }] }), 'max-tokens'),
      { provider: 'p', model: 'm' },
      'en',
      [item('d-inv-0', '保持稳定。')],
    )
    expect(result.translatedRefs).toEqual([])
    expect(result.failedRefs).toEqual(['d-inv-0'])
    expect(result.items[0]?.text).toBe('保持稳定。')
  })
})


describe('draft translation batching', () => {
  it('splits large drafts into bounded calls and merges every ref', async () => {
    let calls = 0
    const llm = {
      async *stream(options: { messages?: readonly { content?: readonly { text?: string }[] }[] }) {
        calls += 1
        const prompt = options.messages?.[0]?.content?.[0]?.text ?? ''
        const rows = prompt.split('\n').flatMap(line => {
          if (!line.startsWith('{"ref":')) return []
          const parsed = JSON.parse(line) as { ref: string; text: string }
          return [{ ref: parsed.ref, text: `translated:${parsed.ref}` }]
        })
        const json = JSON.stringify({ items: rows })
        yield { type: 'block-start', index: 0 }
        yield { type: 'text-delta', index: 0, text: json }
        yield { type: 'block-end', index: 0, block: { type: 'text', text: json } }
        yield { type: 'finish', reason: { kind: 'stop' } }
      },
    }
    const items = Array.from({ length: 25 }, (_, index) => item(`d-inv-${index}`, `source-${index}-${'x'.repeat(120)}`))
    const result = await translateDraftItems(llm, { provider: 'p', model: 'm' }, 'en', items)
    expect(calls).toBeGreaterThan(1)
    expect(result.items).toHaveLength(25)
    for (const [index, translated] of result.items.entries()) {
      expect(translated.text).toBe(`translated:d-inv-${index}`)
    }
  })
})
