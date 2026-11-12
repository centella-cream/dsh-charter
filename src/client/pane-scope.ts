// Generated W5 Pane scope: explicit contract between CharterPane and its page components.
// Regenerate with the refactor script when page fields move.
export interface PaneScope {
  readonly activeDeliverables: import("./preview.js").ProjectedItem[]
  readonly activeInvariants: import("./preview.js").ProjectedItem[]
  readonly area: "review" | "diagnostics" | "workspace"
  readonly bootstrapPhase: import("./draft-store.js").BootstrapPhase
  readonly bootstrapProblem: import("./draft-store.js").BootstrapProblem | null
  readonly counts: { readonly active: number; readonly pending: number; readonly history: number; }
  readonly currentDeliverables: import("./preview.js").ProjectedItem[]
  readonly currentInvariants: import("./preview.js").ProjectedItem[]
  readonly deliverables: (import("./preview.js").ProjectedItem & { kind: "deliverable"; })[]
  readonly dependencyByItemId: Map<string, import("../core/dependencies.js").DependencyProjection>
  readonly dependencyEditorId: string | null
  readonly dependencyGraphActiveKey: string | undefined
  readonly dependencyGraphDepth: 1 | 2
  readonly dependencyGraphHidden: boolean
  readonly dependencyGraphProblem: string | null
  readonly dependencyGraphSupersedes: boolean
  readonly dependencyPlan: never[] | readonly import("../core/dependencies.js").DependencyProjection[]
  readonly dependencyVisibleCount: number
  readonly draft: import("./draft-store.js").CharterDraft
  readonly editable: boolean
  readonly editor: import("./draft-store.js").DraftEditor | null
  readonly editorNeedsReason: boolean
  readonly editorReason: string
  readonly editorText: string
  readonly focusStatus: () => void
  readonly goSection: (next: import("./draft-store.js").CharterSection) => void
  readonly historyDeliverables: (import("./preview.js").ProjectedItem & { kind: "deliverable"; })[]
  readonly historyInvariants: import("./preview.js").ProjectedItem[]
  readonly invariants: import("./preview.js").ProjectedItem[]
  readonly locateGraphNodeInList: (id: string) => void
  readonly newDeliverable: string
  readonly newInvariant: string
  readonly objectiveStaged: boolean
  readonly openEditor: (target: import("./draft-store.js").DraftEditor) => void
  readonly openHistory: () => void
  readonly pendingDeliverables: import("./preview.js").ProjectedItem[]
  readonly pendingInvariants: import("./preview.js").ProjectedItem[]
  readonly planInvalid: boolean
  readonly projectedItems: readonly import("./preview.js").ProjectedItem[]
  readonly projectedObjective: { original: { text: string; setAtRevision: number; }; current: { text: string; setAtRevision: number; reason?: string | undefined; }; } | null
  readonly relationFocusId: string | undefined
  readonly relationGraph: import("./relation-graph.js").RelationGraphModel | null
  readonly relationGraphAvailable: boolean
  readonly relationLayout: import("./relation-graph.js").GraphLayout | null
  readonly release: () => void
  readonly renderItems: (items: readonly import("./preview.js").ProjectedItem[], history: readonly import("./preview.js").ProjectedItem[], emptyKey: "invariants.empty" | "deliverables.empty", windowKey: "invariants" | "deliverables") => import("react").ReactNode
  readonly saving: boolean
  readonly section: import("./draft-store.js").CharterSection
  readonly setDependencyEditorId: import("react").Dispatch<import("react").SetStateAction<string | null>>
  readonly setDependencyGraphActiveKey: import("react").Dispatch<import("react").SetStateAction<string | undefined>>
  readonly setDependencyGraphDepth: import("react").Dispatch<import("react").SetStateAction<1 | 2>>
  readonly setDependencyGraphFocusId: import("react").Dispatch<import("react").SetStateAction<string | undefined>>
  readonly setDependencyGraphHidden: import("react").Dispatch<import("react").SetStateAction<boolean>>
  readonly setDependencyGraphSupersedes: import("react").Dispatch<import("react").SetStateAction<boolean>>
  readonly setDependencyVisibleCount: import("react").Dispatch<import("react").SetStateAction<number>>
  readonly setPendingProposalFocusId: import("react").Dispatch<import("react").SetStateAction<string | null>>
  readonly showEmpty: boolean
  readonly source: import("./store.js").CharterSource
  readonly stageGraphRequires: (targetId: string, nextRequires: readonly string[]) => void
  readonly t: import("@deepseek-ai/dsh-client-ui-slots").TranslateNS<"dsh-charter">
  readonly unknownBlocked: boolean
  readonly view: import("../host/types.js").CharterView
  readonly abandonUnknown: () => void
  readonly applyBootstrapDraft: () => void
  readonly applyHintId: string
  readonly batchByItem: Map<string, { readonly batchId: string; readonly sourceKind: string; }>
  readonly bootstrap: import("../host/types.js").CharterBootstrapProposal | null
  readonly bootstrapBudgetOver: boolean
  readonly bootstrapId: string
  readonly bootstrapItems: readonly import("./bootstrap-plan.js").BootstrapDraftItem[]
  readonly bootstrapObjective: string
  readonly bootstrapObjectiveOver: boolean
  readonly bootstrapPlan: import("./bootstrap-plan.js").BootstrapPlan
  readonly bootstrapPromptBytes: number
  readonly bootstrapReplay: boolean
  readonly bootstrapSaving: boolean
  readonly bootstrapStorageOver: boolean
  readonly bootstrapTextIssue: import("./bootstrap-plan.js").DraftTextIssue | undefined
  readonly bootstrapVisibleCount: number
  readonly canApplyBootstrap: boolean
  readonly closedObjectiveProposals: { id: string; text: string; origin: "user" | "agent" | "fork"; review: "pending" | "accepted" | "rejected" | "purged"; createdRevision: number; reviewedAtRevision?: number | undefined; appliedRevision?: number | undefined; textDigest?: string | undefined; }[]
  readonly confirmAbandon: boolean
  readonly inactiveItems: import("./preview.js").ProjectedItem[]
  readonly messageBytes: number
  readonly messageCanSave: boolean
  readonly messageCandidates: readonly import("../host/types.js").CharterMessageCandidate[]
  readonly messageDraft: string
  readonly messageKind: "invariant" | "deliverable"
  readonly messageMenuOpen: boolean
  readonly messageMenuRef: import("react").MutableRefObject<HTMLDivElement | null>
  readonly messageOverBudget: boolean
  readonly messageSeq: number | undefined
  readonly messageTextAvailable: boolean
  readonly ops: readonly ({ type: "objective.initialize"; text: string; } | { type: "objective.redirect"; text: string; reason?: string | undefined; } | { type: "objective.propose"; clientRef: string; text: string; } | { type: "objective.accept"; proposalId: string; reason?: string | undefined; } | { type: "objective.reject"; proposalId: string; } | { type: "objective.purge"; proposalId: string; } | { type: "item.add"; item: { clientRef: string; kind: "invariant"; text: string; order: number; origin?: "user" | "agent" | "fork" | undefined; contentModified?: boolean | undefined; } | { clientRef: string; kind: "deliverable"; text: string; order: number; progress: "not-started" | "in-progress" | "blocked" | "done" | "cancelled"; requires?: string[] | undefined; proposedRequires?: string[] | undefined; origin?: "user" | "agent" | "fork" | undefined; contentModified?: boolean | undefined; }; } | { type: "item.propose"; item: { clientRef: string; kind: "invariant"; text: string; order: number; origin?: "user" | "agent" | "fork" | undefined; contentModified?: boolean | undefined; } | { clientRef: string; kind: "deliverable"; text: string; order: number; progress: "not-started" | "in-progress" | "blocked" | "done" | "cancelled"; requires?: string[] | undefined; proposedRequires?: string[] | undefined; origin?: "user" | "agent" | "fork" | undefined; contentModified?: boolean | undefined; }; } | { type: "item.edit"; itemId: string; text?: string | undefined; order?: number | undefined; } | { type: "item.accept"; itemId: string; } | { type: "item.reject"; itemId: string; } | { type: "item.archive"; itemId: string; } | { type: "item.restore"; itemId: string; } | { type: "item.supersede"; itemId: string; replacement: { clientRef: string; kind: "invariant"; text: string; order: number; origin?: "user" | "agent" | "fork" | undefined; contentModified?: boolean | undefined; } | { clientRef: string; kind: "deliverable"; text: string; order: number; progress: "not-started" | "in-progress" | "blocked" | "done" | "cancelled"; requires?: string[] | undefined; proposedRequires?: string[] | undefined; origin?: "user" | "agent" | "fork" | undefined; contentModified?: boolean | undefined; }; } | { type: "item.purge"; itemId: string; confirmed: true; } | { type: "deliverable.progress"; itemId: string; progress: "not-started" | "in-progress" | "blocked" | "done" | "cancelled"; } | { type: "deliverable.requires"; itemId: string; requires: string[]; } | { type: "item.verification.set"; itemId: string; verification: "unchecked" | "verified"; } | { type: "item.validity.set"; itemId: string; validity: { state: "unassessed"; } | { state: "attested"; atRevision: number; } | { state: "valid"; validator: string; inputDigest: string; checkedAtRevision: number; resultDigest?: string | undefined; } | { state: "invalid"; validator: string; inputDigest: string; checkedAtRevision: number; reason?: string | undefined; } | { state: "unknown"; validator: string; inputDigest: string; checkedAtRevision: number; reason?: string | undefined; } | { state: "stale"; previous: "unknown" | "attested" | "valid" | "invalid"; atRevision: number; }; evidence?: { kind: "message" | "compaction-summary" | "workspace-file"; projectionVersion: number; digest: string; sessionId?: string | undefined; seq?: number | undefined; path?: string | undefined; excerpt?: string | undefined; }[] | undefined; } | { type: "item.attest"; itemId: string; })[]
  readonly pendingItemProposals: import("./preview.js").ProjectedItem[]
  readonly pendingObjectiveProposals: { id: string; text: string; origin: "user" | "agent" | "fork"; review: "pending" | "accepted" | "rejected" | "purged"; createdRevision: number; reviewedAtRevision?: number | undefined; appliedRevision?: number | undefined; textDigest?: string | undefined; }[]
  readonly proposalReasons: Record<string, string>
  readonly reviewLimit: number
  readonly selectedMessage: import("../host/types.js").CharterMessageCandidate | undefined
  readonly setMessageDraft: import("react").Dispatch<import("react").SetStateAction<string>>
  readonly setMessageKind: import("react").Dispatch<import("react").SetStateAction<"invariant" | "deliverable">>
  readonly setMessageMenuOpen: import("react").Dispatch<import("react").SetStateAction<boolean>>
  readonly setMessageSeq: import("react").Dispatch<import("react").SetStateAction<number | undefined>>
  readonly setProposalReasons: import("react").Dispatch<import("react").SetStateAction<Record<string, string>>>
  readonly setReviewLimit: import("react").Dispatch<import("react").SetStateAction<number>>
  readonly unknownReplay: boolean
  readonly activeArchiveKey: string | null
  readonly archiveCacheProblem: string | null
  readonly archiveEntries: readonly import("../host/types.js").CharterArchiveEntry[]
  readonly archiveInputRef: import("react").MutableRefObject<HTMLInputElement | null>
  readonly archivePreview: import("./pane-format.js").ArchivePreview | null
  readonly archiveSource: "file" | "cache" | null
  readonly canExport: boolean
  readonly capabilities: import("../host/types.js").CharterViewCapabilities | undefined
  readonly chooseArchive: (file: File) => void
  readonly chooseCachedArchive: (entry: import("../host/types.js").CharterArchiveEntry) => void
  readonly confirmRecovery: "initialize" | "restore" | null
  readonly draftOpen: boolean
  readonly draftState: import("./draft-store.js").CharterDraftState
  readonly errorText: (code: string | undefined) => string
  readonly exportArchive: () => void
  readonly exportProblem: string | null
  readonly exportableState: boolean
  readonly exporting: boolean
  readonly formattedPreview: string | null
  readonly initAdmission: { readonly ok: true; } | { readonly ok: false; readonly reason: string; }
  readonly initializeEmpty: () => void
  readonly integrityFeedback: string | null
  readonly maintenanceEnabled: boolean
  readonly maintenanceProblem: import("./draft-store.js").MaintenanceProblem | null
  readonly maintenanceReplay: boolean
  readonly overBudget: boolean
  readonly preview: string
  readonly previewBytes: number
  readonly previewMode: "formatted" | "exact"
  readonly recordDigest: `sha256:${string}` | undefined
  readonly recordState: import("../host/types.js").CharterRecordState | undefined
  readonly recoveryBusy: boolean
  readonly restoreAdmission: { readonly ok: true; } | { readonly ok: false; readonly reason: string; }
  readonly restoreArchive: () => void
  readonly restoreArchiveReady: boolean
  readonly restoreTarget: boolean
  readonly retainedArchive: { format: "dsh-charter-record"; formatVersion: 1; exportedAt: number; source: { domain: "dsh_charter_v1"; domainVersion: 1; sessionId: string; lifecycle: string | null; health: "healthy" | "lifecycle-mismatch" | "schema-invalid" | "consistency-invalid"; revision: number | null; recordDigest: string; }; record: unknown; payloadDigest: string; } | null | undefined
  readonly setConfirmRecovery: import("react").Dispatch<import("react").SetStateAction<"initialize" | "restore" | null>>
  readonly setIntegrityFeedback: import("react").Dispatch<import("react").SetStateAction<string | null>>
  readonly setPreviewMode: import("react").Dispatch<import("react").SetStateAction<"formatted" | "exact">>
  readonly setValidatorExpectation: import("react").Dispatch<import("react").SetStateAction<string>>
  readonly setValidatorFeedback: import("react").Dispatch<import("react").SetStateAction<string | null>>
  readonly setValidatorItemId: import("react").Dispatch<import("react").SetStateAction<string>>
  readonly setValidatorKind: import("react").Dispatch<import("react").SetStateAction<"workspace.path-exists" | "workspace.file-digest" | "workspace.file-contains">>
  readonly setValidatorPath: import("react").Dispatch<import("react").SetStateAction<string>>
  readonly setValidatorRunning: import("react").Dispatch<import("react").SetStateAction<boolean>>
  readonly validatorExpectation: string
  readonly validatorFeedback: string | null
  readonly validatorItemId: string
  readonly validatorKind: "workspace.path-exists" | "workspace.file-digest" | "workspace.file-contains"
  readonly validatorPath: string
  readonly validatorRunning: boolean
}
