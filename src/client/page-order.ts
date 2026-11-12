/**
 * Explicit page reading order used by the flex stack. Extracted from the Pane so
 * the Workspace/Review/Diagnostics order contract is unit-tested instead of
 * living as inline numbers.
 */
export const PAGE_ORDER = {
  workspace: {
    objective: 10,
    invariants: 20,
    deliverables: 30,
    execution: 40,
  },
  review: {
    batches: 10,
    itemProposals: 20,
    objectiveProposals: 30,
    messageProposal: 40,
    bootstrap: 50,
    objectiveHistory: 60,
    inactive: 70,
  },
  diagnostics: {
    contextPreview: -1,
  },
} as const

export type PageOrder = typeof PAGE_ORDER
