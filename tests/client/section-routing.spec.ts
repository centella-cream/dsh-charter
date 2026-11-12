import { describe, expect, it, vi } from 'vitest'
import {
  SECTION_ANCHOR,
  focusSectionHeading,
  scrollToSectionAnchor,
  sectionAnchor,
} from '../../src/client/section-routing.js'

describe('section routing (W5 Pane split)', () => {
  it('keeps a stable anchor for every section', () => {
    expect(Object.keys(SECTION_ANCHOR).sort()).toEqual([
      'context', 'deliverables', 'diagnostics', 'history', 'invariants', 'objective', 'overview', 'recovery',
    ])
    expect(sectionAnchor('objective')).toBe('charter-objective')
    expect(sectionAnchor('history')).toBe('charter-review-pending')
  })

  it('scrolls the target anchor and returns it', () => {
    const scrollIntoView = vi.fn()
    const target = { scrollIntoView } as unknown as HTMLElement
    const doc = {
      getElementById: (id: string) => id === 'charter-objective' ? target : null,
    } as unknown as Document
    expect(scrollToSectionAnchor('objective', doc)).toBe(target)
    expect(scrollToSectionAnchor('recovery', doc)).toBeNull()
    expect(scrollIntoView).toHaveBeenCalledWith({ block: 'start' })
  })

  it('focuses the heading or falls back to the page heading', () => {
    const heading = { focus: vi.fn(), tabIndex: -1 } as unknown as HTMLElement
    const section = {
      matches: () => false,
      querySelector: () => heading,
    } as unknown as HTMLElement
    const fallback = { focus: vi.fn() } as unknown as HTMLElement
    focusSectionHeading(section, fallback)
    expect(heading.focus).toHaveBeenCalledWith({ preventScroll: true })
    focusSectionHeading(null, fallback)
    expect(fallback.focus).toHaveBeenCalledWith({ preventScroll: true })
  })
})

import { PAGE_ORDER } from '../../src/client/page-order.js'

describe('page reading order (W5 page split)', () => {
  it('puts pending review work before older sources', () => {
    expect(PAGE_ORDER.review.batches).toBeLessThan(PAGE_ORDER.review.itemProposals)
    expect(PAGE_ORDER.review.itemProposals).toBeLessThan(PAGE_ORDER.review.messageProposal)
    expect(PAGE_ORDER.review.messageProposal).toBeLessThan(PAGE_ORDER.review.objectiveHistory)
    expect(PAGE_ORDER.review.objectiveHistory).toBeLessThan(PAGE_ORDER.review.inactive)
    expect(PAGE_ORDER.diagnostics.contextPreview).toBeLessThan(0)
  })

  it('keeps workspace order objective -> invariants -> deliverables -> execution', () => {
    expect(PAGE_ORDER.workspace.objective).toBeLessThan(PAGE_ORDER.workspace.invariants)
    expect(PAGE_ORDER.workspace.invariants).toBeLessThan(PAGE_ORDER.workspace.deliverables)
    expect(PAGE_ORDER.workspace.deliverables).toBeLessThan(PAGE_ORDER.workspace.execution)
  })
})
