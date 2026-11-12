import type { CharterSection } from './draft-store.js'

/**
 * Stable DOM anchors for in-Pane navigation. Keeping the map here (rather than
 * inside the Pane) lets the routing contract be unit-tested and reused by a
 * future Workspace/Review/Diagnostics page split.
 */
export const SECTION_ANCHOR: Record<CharterSection, string> = {
  overview: 'charter-workspace-top',
  objective: 'charter-objective',
  invariants: 'charter-invariants',
  deliverables: 'charter-deliverables',
  history: 'charter-review-pending',
  context: 'charter-context-preview',
  recovery: 'charter-recovery',
}

export function sectionAnchor(section: CharterSection): string {
  return SECTION_ANCHOR[section]
}

/** Scroll the host scrollBody to the section anchor; returns the anchor element. */
export function scrollToSectionAnchor(section: CharterSection, doc: Document): HTMLElement | null {
  const target = doc.getElementById(sectionAnchor(section))
  if (target === null) return null
  target.scrollIntoView({ block: 'start' })
  return target
}

/** Move focus to the section heading, falling back to the page heading. */
export function focusSectionHeading(target: HTMLElement | null, fallback: HTMLElement | null): void {
  if (target === null) {
    fallback?.focus({ preventScroll: true })
    return
  }
  const focusTarget = target.matches('h2, h3')
    ? target
    : target.querySelector<HTMLElement>('h2, h3, [tabindex="-1"]')
  if (focusTarget === null) {
    fallback?.focus({ preventScroll: true })
    return
  }
  focusTarget.tabIndex = -1
  focusTarget.focus({ preventScroll: true })
}
