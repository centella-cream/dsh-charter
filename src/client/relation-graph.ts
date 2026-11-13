import type { DeliverableProgress } from '../core/schemas.js'

/**
 * Client-side dependency-graph projection.
 *
 * The design contract is split in two:
 * - buildRelationGraph compares committed and projected items and derives
 *   execution/candidate/history lanes plus edge staging state;
 * - layoutRelationGraph is a deterministic, font-free geometry pass over the
 *   semantic model.
 *
 * Both functions are pure. The Pane renders their output; the Host is not
 * involved and no graph coordinate enters the record, prompt, or digest.
 */

export const GRAPH = {
  nodePaddingEm: 0.625,
  summaryEm: 0.78,
  nodeMinWidthEm: 9,
  nodeWidthEm: 10,
  nodeMaxWidthEm: 12,
  nodeHeightEm: { 1: 3, 2: 4.5 } as const,
  rankPitchEm: 12.5,
  rowPitchEm: 5.5,
  candidateGapEm: 2.5,
  historyGapEm: 2.5,
  navigationLimit: 60,
  isolatedNodeLimit: 20,
  touchTargetPx: 44,
} as const

export const LINE_CAPACITY = Math.floor(
  (GRAPH.nodeWidthEm - 2 * GRAPH.nodePaddingEm) / GRAPH.summaryEm,
)

export type GraphLane = 'execution' | 'candidate' | 'history'
export type NodeState = 'unchanged' | 'staged-added' | 'staged-removed' | 'staged-changed'
export type EdgeState = 'committed' | 'staged-added' | 'staged-removed'
export type EdgeKind = 'requires' | 'proposed' | 'supersedes'

export interface GraphInputItem {
  readonly id: string
  readonly kind: string
  readonly text: string
  readonly review: string
  readonly lifecycle: string
  readonly progress?: DeliverableProgress
  readonly requires?: readonly string[]
  readonly proposedRequires?: readonly string[]
  readonly supersedes?: string
  readonly supersededBy?: string
  readonly order?: number
}

export interface RelationNode {
  readonly id: string
  readonly lane: GraphLane
  readonly ghost?: boolean
  readonly localKey: string | undefined
  readonly text: string
  readonly rank: number | undefined
  readonly order: number
  readonly groupRank: number | undefined
  readonly progress: DeliverableProgress | undefined
  readonly executionDisplay: string | undefined
  readonly prerequisiteStatus: string | undefined
  readonly state: NodeState
  readonly candidateCycle?: boolean
}

export interface RelationEdge {
  readonly from: string
  readonly to: string
  readonly kind: EdgeKind
  readonly state: EdgeState
  readonly editable: boolean
  readonly focusable: boolean
  readonly targetProposalId?: string
}

export interface RelationGraphModel {
  readonly nodes: readonly RelationNode[]
  readonly edges: readonly RelationEdge[]
  readonly topoOrder: readonly string[]
  readonly committedTopoOrder: readonly string[]
  readonly navigables: number
}

export interface PlacedNode extends RelationNode {
  readonly col: number
  readonly x: number
  readonly y: number
  readonly w: number
  readonly h: number
  readonly labelLines: 1 | 2
}

export interface PlacedEdge extends RelationEdge {
  readonly key: string
  readonly path: string
  readonly labelAt: { readonly x: number; readonly y: number }
}

export interface GraphLayout {
  readonly nodes: readonly PlacedNode[]
  readonly edges: readonly PlacedEdge[]
  readonly width: number
  readonly height: number
  readonly traversal: readonly string[]
  readonly navigables: number
  readonly focusId: string | undefined
  readonly depth: 1 | 2
  readonly degraded: {
    readonly supersedesHidden: boolean
    readonly depthReduced: boolean
    readonly hidden: boolean
    readonly isolatedTooMany: boolean
  }
}

export interface BuildRelationGraphInput {
  readonly committed: readonly GraphInputItem[]
  readonly projected: readonly GraphInputItem[]
  readonly showSupersedes?: boolean
}

const active = (item: GraphInputItem): boolean =>
  item.kind === 'deliverable' && item.review === 'accepted' && item.lifecycle === 'current'
const pending = (item: GraphInputItem): boolean =>
  item.kind === 'deliverable' && item.review === 'pending' && item.lifecycle === 'current'
const requiresOf = (item: GraphInputItem): readonly string[] => item.requires ?? []
const proposedOf = (item: GraphInputItem): readonly string[] => item.proposedRequires ?? []
const sameSet = (left: readonly string[], right: readonly string[]): boolean => {
  const a = new Set(left)
  const b = new Set(right)
  return a.size === b.size && [...a].every(value => b.has(value))
}

function statusFor(item: GraphInputItem, byId: ReadonlyMap<string, GraphInputItem>): {
  prerequisiteStatus: string
  executionDisplay: string
} {
  const prerequisites = requiresOf(item).map(id => byId.get(id)).filter((value): value is GraphInputItem => value !== undefined)
  const conflict = prerequisites.some(prerequisite =>
    prerequisite.progress === 'cancelled'
    || (prerequisite.progress !== 'done' && (item.progress === 'in-progress' || item.progress === 'done')))
  const waiting = !conflict && prerequisites.some(prerequisite => prerequisite.progress !== 'done')
  const prerequisiteStatus = conflict ? 'dependency-conflict' : waiting ? 'waiting' : 'satisfied'
  const executionDisplay = item.progress === 'done' || item.progress === 'cancelled'
    ? 'terminal'
    : item.progress === 'blocked'
      ? 'blocked'
      : item.progress === 'in-progress'
        ? 'in-progress'
        : prerequisiteStatus === 'satisfied' ? 'ready' : prerequisiteStatus
  return { prerequisiteStatus, executionDisplay }
}

interface Topology {
  readonly byId: ReadonlyMap<string, {
    readonly rank: number
    readonly order: number
    readonly localKey: string
    readonly prerequisiteStatus: string
    readonly executionDisplay: string
  }>
  readonly order: readonly string[]
}

function topology(items: readonly GraphInputItem[]): Topology {
  const byId = new Map(items.map(item => [item.id, item]))
  const rankOf = new Map<string, number>()
  const visiting = new Set<string>()
  const place = (id: string): number => {
    const known = rankOf.get(id)
    if (known !== undefined) return known
    if (visiting.has(id)) return 0
    visiting.add(id)
    const prerequisites = requiresOf(byId.get(id) ?? { id, kind: 'deliverable', text: '', review: 'accepted', lifecycle: 'current' })
      .filter(prerequisiteId => byId.has(prerequisiteId))
    const rank = prerequisites.length === 0 ? 0 : Math.max(...prerequisites.map(place)) + 1
    visiting.delete(id)
    rankOf.set(id, rank)
    return rank
  }
  for (const item of items) place(item.id)
  const byRank = new Map<number, GraphInputItem[]>()
  for (const item of items) {
    const rank = rankOf.get(item.id) ?? 0
    const rows = byRank.get(rank) ?? []
    rows.push(item)
    byRank.set(rank, rows)
  }
  const out = new Map<string, {
    rank: number
    order: number
    localKey: string
    prerequisiteStatus: string
    executionDisplay: string
  }>()
  const order: string[] = []
  for (const rank of [...byRank.keys()].sort((a, b) => a - b)) {
    const rows = (byRank.get(rank) ?? []).slice().sort((a, b) =>
      ((a.order ?? 0) - (b.order ?? 0)) || a.id.localeCompare(b.id))
    rows.forEach((item, index) => {
      const status = statusFor(item, byId)
      out.set(item.id, {
        rank,
        order: index,
        localKey: `D${order.length + 1}`,
        prerequisiteStatus: status.prerequisiteStatus,
        executionDisplay: status.executionDisplay,
      })
      order.push(item.id)
    })
  }
  return { byId: out, order }
}

export function buildRelationGraph(input: BuildRelationGraphInput): RelationGraphModel {
  const committed = input.committed
  const projected = input.projected
  const showSupersedes = input.showSupersedes !== false
  const committedActive = committed.filter(active)
  const projectedActive = projected.filter(active)
  const committedTopology = topology(committedActive)
  const projectedTopology = topology(projectedActive)
  const committedById = new Map(committedActive.map(item => [item.id, item]))
  const projectedById = new Map(projectedActive.map(item => [item.id, item]))
  const nodes: RelationNode[] = []

  const allExecutionIds = new Set([...committedById.keys(), ...projectedById.keys()])
  for (const id of allExecutionIds) {
    const before = committedById.get(id)
    const after = projectedById.get(id)
    const state: NodeState = before === undefined
      ? 'staged-added'
      : after === undefined
        ? 'staged-removed'
        : !sameSet(requiresOf(before), requiresOf(after)) || before.progress !== after.progress
          ? 'staged-changed'
          : 'unchanged'
    const source = after ?? before
    if (source === undefined) continue
    const projectedTopo = projectedTopology.byId.get(id)
    const committedTopo = committedTopology.byId.get(id)
    const topo = projectedTopo ?? committedTopo
    nodes.push({
      id,
      lane: 'execution',
      localKey: topo?.localKey,
      text: source.text,
      rank: topo?.rank,
      order: topo?.order ?? 0,
      groupRank: undefined,
      progress: source.progress,
      executionDisplay: topo?.executionDisplay,
      prerequisiteStatus: topo?.prerequisiteStatus,
      state,
    })
  }

  const committedPending = new Map(committed.filter(pending).map(item => [item.id, item]))
  const projectedPending = new Map(projected.filter(pending).map(item => [item.id, item]))
  const executionIds = new Set(nodes.map(node => node.id))
  const referenced = new Set<string>()
  for (const item of projectedPending.values()) {
    for (const id of proposedOf(item)) referenced.add(id)
  }
  const nextCandidateOrder = (): number => nodes.filter(node => node.lane === 'candidate').length
  for (const [id, item] of projectedPending) {
    if (proposedOf(item).length === 0 && !referenced.has(id)) continue
    const targetRanks = proposedOf(item)
      .map(target => projectedTopology.byId.get(target)?.rank)
      .filter((rank): rank is number => rank !== undefined)
    nodes.push({
      id,
      lane: 'candidate',
      localKey: undefined,
      text: item.text,
      rank: undefined,
      order: item.order ?? nextCandidateOrder(),
      groupRank: targetRanks.length ? Math.max(...targetRanks) : Number.MAX_SAFE_INTEGER,
      progress: undefined,
      executionDisplay: undefined,
      prerequisiteStatus: undefined,
      state: committedPending.has(id) ? 'unchanged' : 'staged-added',
    })
  }
  for (const [id, item] of committedPending) {
    if (projectedPending.has(id) || executionIds.has(id)) continue
    nodes.push({
      id,
      lane: 'candidate',
      localKey: undefined,
      text: item.text,
      rank: undefined,
      order: item.order ?? nextCandidateOrder(),
      groupRank: Number.MAX_SAFE_INTEGER,
      progress: undefined,
      executionDisplay: undefined,
      prerequisiteStatus: undefined,
      state: 'staged-removed',
    })
  }

  // Candidate columns are lane-local: active prerequisites decide the base
  // column and pending prerequisites stack to the right. Cycles are tolerated
  // (acceptance still rejects them) and surfaced on the nodes.
  const pendingIds = new Set(projectedPending.keys())
  const cycleIds = new Set<string>()
  const visitState = new Map<string, 0 | 1 | 2>()
  const stack: string[] = []
  const visit = (id: string): void => {
    const state = visitState.get(id) ?? 0
    if (state === 2) return
    if (state === 1) {
      const index = stack.indexOf(id)
      if (index >= 0) for (const member of stack.slice(index)) cycleIds.add(member)
      return
    }
    visitState.set(id, 1)
    stack.push(id)
    for (const target of proposedOf(projectedPending.get(id) ?? { id, kind: 'deliverable', text: '', review: 'pending', lifecycle: 'current' })) {
      if (pendingIds.has(target)) visit(target)
    }
    stack.pop()
    visitState.set(id, 2)
  }
  for (const id of pendingIds) visit(id)
  const candidateRankCache = new Map<string, number>()
  const candidateRank = (id: string): number => {
    if (cycleIds.has(id)) return 0
    const cached = candidateRankCache.get(id)
    if (cached !== undefined) return cached
    if (!pendingIds.has(id)) return 0
    const item = projectedPending.get(id)
    if (item === undefined) return 0
    const activeBase = Math.max(0, ...proposedOf(item)
      .map(target => projectedTopology.byId.get(target)?.rank)
      .filter((rank): rank is number => rank !== undefined))
    const pendingPredecessors = proposedOf(item).filter(target => pendingIds.has(target))
    const rank = activeBase + (pendingPredecessors.length === 0
      ? 0
      : 1 + Math.max(...pendingPredecessors.map(candidateRank)))
    candidateRankCache.set(id, rank)
    return rank
  }
  for (let index = 0; index < nodes.length; index += 1) {
    const node = nodes[index]
    if (node?.lane !== 'candidate' || !pendingIds.has(node.id)) continue
    nodes[index] = {
      ...node,
      groupRank: candidateRank(node.id),
      candidateCycle: cycleIds.has(node.id) || proposedOf(projectedPending.get(node.id) ?? { id: node.id, kind: 'deliverable', text: '', review: 'pending', lifecycle: 'current' }).some(target => pendingIds.has(target) && cycleIds.has(target)),
    }
  }

  const edges: RelationEdge[] = []
  const committedPairs = new Set<string>()
  for (const item of committedActive) for (const from of requiresOf(item)) committedPairs.add(`${from}→${item.id}`)
  const projectedPairs = new Set<string>()
  for (const item of projectedActive) for (const from of requiresOf(item)) projectedPairs.add(`${from}→${item.id}`)
  for (const pair of new Set([...committedPairs, ...projectedPairs])) {
    const [from = '', to = ''] = pair.split('→')
    const inCommitted = committedPairs.has(pair)
    const inProjected = projectedPairs.has(pair)
    edges.push({
      from,
      to,
      kind: 'requires',
      state: inCommitted && inProjected ? 'committed' : inProjected ? 'staged-added' : 'staged-removed',
      editable: true,
      focusable: true,
    })
  }
  for (const item of projectedPending.values()) {
    for (const from of proposedOf(item)) {
      edges.push({
        from,
        to: item.id,
        kind: 'proposed',
        state: 'committed',
        editable: false,
        focusable: true,
        targetProposalId: item.id,
      })
    }
  }

  const committedAll = new Map(committed.map(item => [item.id, item]))
  const projectedAll = new Map(projected.map(item => [item.id, item]))
  const pairsOf = (items: readonly GraphInputItem[]): Set<string> => {
    const out = new Set<string>()
    for (const item of items) {
      if (item.supersedes !== undefined) out.add(`${item.supersedes}→${item.id}`)
      if (item.supersededBy !== undefined) out.add(`${item.id}→${item.supersededBy}`)
    }
    return out
  }
  const committedSupersedes = pairsOf(committed)
  const projectedSupersedes = pairsOf(projected)
  const supersedesPairs = new Set([...committedSupersedes, ...projectedSupersedes])
  const visibleIds = new Set(nodes.map(node => node.id))
  const committedActiveIds = new Set(committedActive.map(item => item.id))
  const projectedActiveIds = new Set(projectedActive.map(item => item.id))

  if (showSupersedes) {
    const endpoints = new Set<string>()
    for (const pair of supersedesPairs) {
      for (const id of pair.split('→')) endpoints.add(id)
    }
    const ghostIds = [...endpoints]
      .filter(id => !visibleIds.has(id))
      .filter(id => !committedActiveIds.has(id) && !projectedActiveIds.has(id))
      .filter(id => committedAll.has(id) || projectedAll.has(id))
      .sort()
    ghostIds.forEach((id, index) => {
      const item = projectedAll.get(id) ?? committedAll.get(id)
      if (item === undefined) return
      nodes.push({
        id,
        lane: 'history',
        ghost: true,
        localKey: undefined,
        text: item.text,
        rank: undefined,
        order: index,
        groupRank: undefined,
        progress: undefined,
        executionDisplay: undefined,
        prerequisiteStatus: undefined,
        state: 'unchanged',
      })
      visibleIds.add(id)
    })
  }

  for (const pair of [...supersedesPairs].sort()) {
    if (!showSupersedes) break
    const [from = '', to = ''] = pair.split('→')
    if (!visibleIds.has(from) || !visibleIds.has(to)) continue
    const inCommitted = committedSupersedes.has(pair)
    const inProjected = projectedSupersedes.has(pair)
    edges.push({
      from,
      to,
      kind: 'supersedes',
      state: inCommitted && inProjected ? 'committed' : inProjected ? 'staged-added' : 'staged-removed',
      editable: false,
      focusable: true,
    })
  }

  return {
    nodes,
    edges,
    topoOrder: projectedTopology.order,
    committedTopoOrder: committedTopology.order,
    navigables: nodes.length + edges.length,
  }
}

export function labelLines(text: string): 1 | 2 {
  let weight = 0
  for (const character of text) {
    weight += /[\u2e80-\u9fff\uf900-\ufaff\uff00-\uffef]/u.test(character) ? 1 : 0.5
  }
  return weight <= LINE_CAPACITY ? 1 : 2
}

export function defaultFocus(model: RelationGraphModel): string | undefined {
  const execution = model.nodes.filter(node => node.lane === 'execution')
  const order = (nodes: readonly RelationNode[]): readonly RelationNode[] => nodes.slice().sort((a, b) =>
    ((a.rank ?? 999) - (b.rank ?? 999))
    || ((a.order ?? 0) - (b.order ?? 0))
    || a.id.localeCompare(b.id))
  if (execution.length === 0) {
    const candidate = model.nodes.filter(node => node.lane === 'candidate')
    if (candidate.length > 0) return order(candidate)[0]?.id
    return order(model.nodes.filter(node => node.lane === 'history'))[0]?.id
  }
  const conflict = order(execution.filter(node =>
    node.prerequisiteStatus === 'dependency-conflict' || node.executionDisplay === 'dependency-conflict'))
  if (conflict.length > 0) return conflict[0]?.id
  const waiting = order(execution.filter(node => node.executionDisplay === 'waiting'))
  if (waiting.length > 0) return waiting[0]?.id
  return order(execution)[0]?.id
}

interface LayoutOptions {
  readonly focusId?: string | undefined
  readonly depth?: 1 | 2
  readonly supersedesHidden?: boolean
}

export function layoutRelationGraph(model: RelationGraphModel, options: LayoutOptions = {}): GraphLayout {
  const depth = options.depth ?? 1
  const focusId = options.focusId !== undefined ? options.focusId : defaultFocus(model)

  let visible = [...model.nodes]
  let visibleEdges = [...model.edges]

  // A dependency-free Contract gets a compact grid, not a single column of
  // unconnected boxes. This is an explicit, bounded exception to the ego view;
  // once any edge exists the ordinary ego crop below applies again.
  if (model.edges.length === 0) {
    if (visible.length > GRAPH.isolatedNodeLimit) {
      return {
        nodes: [],
        edges: [],
        width: 0,
        height: 0,
        traversal: [],
        navigables: visible.length,
        focusId,
        depth,
        degraded: {
          supersedesHidden: options.supersedesHidden === true,
          depthReduced: false,
          hidden: true,
          isolatedTooMany: true,
        },
      }
    }
    const ordered = visible.slice().sort((a, b) => {
      const lane = (value: RelationNode): number => value.lane === 'execution' ? 0 : value.lane === 'candidate' ? 1 : 2
      return (lane(a) - lane(b)) || (a.order - b.order) || a.id.localeCompare(b.id)
    })
    const columns = Math.min(3, Math.max(1, ordered.length))
    const placed: PlacedNode[] = ordered.map((node, index) => {
      const lines = labelLines(node.text)
      return {
        ...node,
        col: index % columns,
        x: (index % columns) * GRAPH.rankPitchEm,
        y: Math.floor(index / columns) * GRAPH.rowPitchEm,
        w: GRAPH.nodeWidthEm,
        h: GRAPH.nodeHeightEm[lines],
        labelLines: lines,
      }
    })
    return {
      nodes: placed,
      edges: [],
      width: Math.max(0, ...placed.map(node => node.x + node.w)),
      height: Math.max(0, ...placed.map(node => node.y + node.h)),
      traversal: placed.map(node => node.id),
      navigables: placed.length,
      focusId,
      depth,
      degraded: {
        supersedesHidden: options.supersedesHidden === true,
        depthReduced: false,
        hidden: false,
        isolatedTooMany: false,
      },
    }
  }

  // A dependency-free Contract still has nodes worth showing; an ego crop
  // around the default focus would leave a single node. Only crop when there
  // are edges to define a meaningful neighbourhood.
  if (focusId !== undefined && model.edges.length > 0) {
    const keep = new Set([focusId])
    let frontier = [focusId]
    for (let distance = 0; distance < depth; distance += 1) {
      const next: string[] = []
      for (const id of frontier) {
        for (const edge of model.edges) {
          if (edge.from === id && !keep.has(edge.to)) {
            keep.add(edge.to)
            next.push(edge.to)
          }
          if (edge.to === id && !keep.has(edge.from)) {
            keep.add(edge.from)
            next.push(edge.from)
          }
        }
      }
      frontier = next
    }
    visible = visible.filter(node => keep.has(node.id))
    visibleEdges = visibleEdges.filter(edge => keep.has(edge.from) && keep.has(edge.to))
  }

  if (options.supersedesHidden === true) {
    visible = visible.filter(node => node.lane !== 'history')
    visibleEdges = visibleEdges.filter(edge => edge.kind !== 'supersedes')
  }
  const navigables = visible.length + visibleEdges.length
  const hasHistory = visible.some(node => node.lane === 'history')
  if (navigables > GRAPH.navigationLimit && hasHistory && options.supersedesHidden !== true) {
    const inner = layoutRelationGraph(model, { ...options, supersedesHidden: true })
    return { ...inner, degraded: { ...inner.degraded, supersedesHidden: true } }
  }
  if (navigables > GRAPH.navigationLimit && depth > 1) {
    const inner = layoutRelationGraph(model, { ...options, depth: 1 })
    return { ...inner, degraded: { ...inner.degraded, depthReduced: true } }
  }
  if (navigables > GRAPH.navigationLimit) {
    return {
      nodes: [],
      edges: [],
      width: 0,
      height: 0,
      traversal: [],
      navigables,
      focusId,
      depth,
      degraded: { supersedesHidden: options.supersedesHidden === true, depthReduced: false, hidden: true, isolatedTooMany: false },
    }
  }

  const placed: PlacedNode[] = []
  const rankRows = new Map<number, RelationNode[]>()
  for (const node of visible.filter(value => value.lane === 'execution')) {
    const rank = node.rank ?? 0
    const rows = rankRows.get(rank) ?? []
    rows.push(node)
    rankRows.set(rank, rows)
  }
  let rowCount = 1
  for (const rows of rankRows.values()) rowCount = Math.max(rowCount, rows.length)
  const maxExecutionHeight = rankRows.size === 0
    ? GRAPH.nodeHeightEm[1]
    : Math.max(...[...rankRows.values()].flat().map(node => GRAPH.nodeHeightEm[labelLines(node.text)]))
  const executionHeight = (rowCount - 1) * GRAPH.rowPitchEm + maxExecutionHeight + GRAPH.candidateGapEm
  const sortedRanks = [...rankRows.keys()].sort((a, b) => a - b)
  const minimumRank = sortedRanks.length > 0 ? sortedRanks[0] ?? 0 : 0
  const maxColumn = sortedRanks.length > 0 ? (sortedRanks[sortedRanks.length - 1] ?? 0) - minimumRank : -1

  for (const rank of sortedRanks) {
    const rows = (rankRows.get(rank) ?? []).slice().sort((a, b) =>
      (a.order - b.order) || a.id.localeCompare(b.id))
    rows.forEach((node, index) => {
      const lines = labelLines(node.text)
      placed.push({
        ...node,
        col: rank - minimumRank,
        x: (rank - minimumRank) * GRAPH.rankPitchEm,
        y: index * GRAPH.rowPitchEm,
        w: GRAPH.nodeWidthEm,
        h: GRAPH.nodeHeightEm[lines],
        labelLines: lines,
      })
    })
  }

  const candidates = visible.filter(node => node.lane === 'candidate')
  const candidateColumns = new Map<number, RelationNode[]>()
  for (const node of candidates) {
    const column = node.groupRank === Number.MAX_SAFE_INTEGER
      ? maxColumn + 1
      : Math.max(0, (node.groupRank ?? 0) - minimumRank)
    const rows = candidateColumns.get(column) ?? []
    rows.push(node)
    candidateColumns.set(column, rows)
  }
  for (const [column, rows] of candidateColumns) {
    rows.sort((a, b) => (a.order - b.order) || a.id.localeCompare(b.id))
    rows.forEach((node, index) => {
      const lines = labelLines(node.text)
      placed.push({
        ...node,
        col: column,
        x: column * GRAPH.rankPitchEm,
        y: executionHeight + index * GRAPH.rowPitchEm,
        w: GRAPH.nodeWidthEm,
        h: GRAPH.nodeHeightEm[lines],
        labelLines: lines,
      })
    })
  }

  const history = visible.filter(node => node.lane === 'history')
  if (history.length > 0) {
    const columnById = new Map(placed.filter(node => node.lane !== 'history').map(node => [node.id, node.col]))
    const supersedesEdges = visibleEdges.filter(edge => edge.kind === 'supersedes')
    const columnOf = (id: string): number => {
      const seen = new Set([id])
      const queue = [id]
      while (queue.length > 0) {
        const current = queue.shift()
        if (current === undefined) break
        for (const edge of supersedesEdges) {
          const next = edge.from === current ? edge.to : edge.to === current ? edge.from : undefined
          if (next === undefined || seen.has(next)) continue
          const column = columnById.get(next)
          if (column !== undefined) return column
          seen.add(next)
          queue.push(next)
        }
      }
      return 0
    }
    const candidatePlaced = placed.filter(node => node.lane === 'candidate')
    const historyTop = candidatePlaced.length > 0
      ? Math.max(...candidatePlaced.map(node => node.y + node.h)) + GRAPH.historyGapEm
      : executionHeight
    const historyColumns = new Map<number, RelationNode[]>()
    for (const node of history) {
      const column = columnOf(node.id)
      const rows = historyColumns.get(column) ?? []
      rows.push(node)
      historyColumns.set(column, rows)
    }
    for (const [column, rows] of historyColumns) {
      rows.sort((a, b) => (a.order - b.order) || a.id.localeCompare(b.id))
      rows.forEach((node, index) => {
        const lines = labelLines(node.text)
        placed.push({
          ...node,
          col: column,
          x: column * GRAPH.rankPitchEm,
          y: historyTop + index * GRAPH.rowPitchEm,
          w: GRAPH.nodeWidthEm,
          h: GRAPH.nodeHeightEm[lines],
          labelLines: lines,
        })
      })
    }
  }

  const byId = new Map(placed.map(node => [node.id, node]))
  const edges: PlacedEdge[] = visibleEdges
    .filter(edge => byId.has(edge.from) && byId.has(edge.to))
    .map(edge => {
      const from = byId.get(edge.from) as PlacedNode
      const to = byId.get(edge.to) as PlacedNode
      const x1 = from.x + from.w
      const y1 = from.y + from.h / 2
      const x2 = to.x
      const y2 = to.y + to.h / 2
      const middle = (x1 + x2) / 2
      return {
        ...edge,
        key: `e:${edge.kind}:${edge.from}→${edge.to}`,
        path: `M ${x1} ${y1} C ${middle} ${y1}, ${middle} ${y2}, ${x2} ${y2}`,
        labelAt: { x: middle, y: (y1 + y2) / 2 - 0.4 },
      }
    })

  const traversal: string[] = []
  const executionNodes = placed.filter(node => node.lane === 'execution')
    .sort((a, b) => (a.col - b.col) || (a.order - b.order) || a.id.localeCompare(b.id))
  const candidateNodes = placed.filter(node => node.lane === 'candidate')
    .sort((a, b) => (a.col - b.col) || (a.order - b.order) || a.id.localeCompare(b.id))
  const addWithEdges = (node: PlacedNode): void => {
    if (!traversal.includes(node.id)) traversal.push(node.id)
    edges.filter(edge => edge.from === node.id || (edge.kind === 'proposed' && edge.to === node.id))
      .sort((a, b) => {
        const left = byId.get(a.to)
        const right = byId.get(b.to)
        return ((left?.col ?? 999) - (right?.col ?? 999)) || ((left?.order ?? 999) - (right?.order ?? 999))
      })
      .forEach(edge => { if (!traversal.includes(edge.key)) traversal.push(edge.key) })
  }
  for (const node of executionNodes) addWithEdges(node)
  for (const node of candidateNodes) addWithEdges(node)
  const historyNodes = placed.filter(node => node.lane === 'history')
    .sort((a, b) => (a.col - b.col) || (a.order - b.order) || a.id.localeCompare(b.id))
  for (const node of historyNodes) addWithEdges(node)

  return {
    nodes: placed,
    edges,
    width: Math.max(0, ...placed.map(node => node.x + node.w)),
    height: Math.max(0, ...placed.map(node => node.y + node.h)),
    traversal,
    navigables,
    focusId,
    depth,
    degraded: { supersedesHidden: options.supersedesHidden === true, depthReduced: false, hidden: false, isolatedTooMany: false },
  }
}

export type GraphNavigationKey =
  | 'Home' | 'End' | 'BracketLeft' | 'BracketRight' | 'PageUp' | 'PageDown'
  | 'ArrowLeft' | 'ArrowRight' | 'ArrowUp' | 'ArrowDown'

export function graphNavigationTarget(
  layout: GraphLayout,
  currentKey: string,
  key: GraphNavigationKey,
): string | null {
  const nodes = new Map(layout.nodes.map(node => [node.id, node]))
  const edges = new Map(layout.edges.map(edge => [edge.key, edge]))
  const index = layout.traversal.indexOf(currentKey)
  if (index < 0) return null
  if (key === 'Home') return layout.traversal[0] ?? null
  if (key === 'End') return layout.traversal[layout.traversal.length - 1] ?? null
  if (key === 'BracketRight' || key === 'PageDown') return layout.traversal[(index + 1) % layout.traversal.length] ?? null
  if (key === 'BracketLeft' || key === 'PageUp') return layout.traversal[(index - 1 + layout.traversal.length) % layout.traversal.length] ?? null
  const isEdge = currentKey.startsWith('e:')
  if (key === 'ArrowLeft' || key === 'ArrowRight') {
    if (isEdge) {
      const edge = edges.get(currentKey)
      if (edge === undefined || edge.kind !== 'requires') return null
      return key === 'ArrowRight' ? edge.to : edge.from
    }
    const node = nodes.get(currentKey)
    if (node === undefined) return null
    const candidates = (key === 'ArrowRight'
      ? layout.edges.filter(edge => edge.kind === 'requires' && edge.from === currentKey).map(edge => nodes.get(edge.to))
      : layout.edges.filter(edge => edge.kind === 'requires' && edge.to === currentKey).map(edge => nodes.get(edge.from)))
      .filter((candidate): candidate is PlacedNode => candidate !== undefined)
    if (candidates.length === 0) return null
    const sorted = candidates.slice().sort((a, b) => {
      const rankA = a.rank ?? a.col
      const rankB = b.rank ?? b.col
      return (rankA - rankB) || (a.order - b.order) || a.id.localeCompare(b.id)
    })
    const column = (candidate: PlacedNode): number => candidate.col
    const currentColumn = node.col
    if (key === 'ArrowRight') {
      const after = sorted.filter(candidate => column(candidate) > currentColumn
        || (column(candidate) === currentColumn && candidate.order > node.order))
      return (after[0] ?? sorted[0])?.id ?? null
    }
    const before = sorted.filter(candidate => column(candidate) < currentColumn
      || (column(candidate) === currentColumn && candidate.order < node.order)).reverse()
    return (before[0] ?? sorted[sorted.length - 1])?.id ?? null
  }
  const edge = isEdge ? edges.get(currentKey) : undefined
  const node = nodes.get(isEdge ? edge?.to ?? '' : currentKey)
  if (node === undefined) return null
  const sameLane = layout.nodes
    .filter(candidate => candidate.lane === node.lane && candidate.col === node.col)
    .sort((a, b) => (a.order - b.order) || a.id.localeCompare(b.id))
  if (sameLane.length < 2) return null
  const currentIndex = sameLane.findIndex(candidate => candidate.id === node.id)
  const next = key === 'ArrowDown'
    ? sameLane[(currentIndex + 1) % sameLane.length]
    : sameLane[(currentIndex - 1 + sameLane.length) % sameLane.length]
  return next?.id ?? null
}

export interface OverlapPair {
  readonly left: string
  readonly right: string
}

export function graphOverlaps(layout: GraphLayout): readonly OverlapPair[] {
  const overlaps: OverlapPair[] = []
  for (let left = 0; left < layout.nodes.length; left += 1) {
    for (let right = left + 1; right < layout.nodes.length; right += 1) {
      const a = layout.nodes[left]
      const b = layout.nodes[right]
      if (a === undefined || b === undefined) continue
      if (a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h) {
        overlaps.push({ left: a.id, right: b.id })
      }
    }
  }
  return overlaps
}
