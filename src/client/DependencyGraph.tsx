import { useEffect, useMemo, useRef, useState } from 'react'
import type { GraphLayout, PlacedEdge, PlacedNode, RelationGraphModel } from './relation-graph.js'
import { graphNavigationTarget, GRAPH } from './relation-graph.js'

export interface DependencyGraphProps {
  readonly layout: GraphLayout
  readonly model: RelationGraphModel
  readonly focusId: string | undefined
  readonly activeKey: string | undefined
  readonly depth: 1 | 2
  readonly showSupersedes: boolean
  readonly editable: boolean
  readonly onFocus: (id: string) => void
  readonly onActiveKey: (key: string) => void
  readonly onDepth: (depth: 1 | 2) => void
  readonly onShowSupersedes: (show: boolean) => void
  readonly onStageRequires: (targetId: string, nextRequires: readonly string[]) => void
  readonly onLocateList: (id: string) => void
  readonly onProposal: (id: string) => void
  readonly t: (key: string, values?: Record<string, string | number>) => string
}

const PX_PER_EM = 18.4
const PX_PER_EM_Y = 22
const GRAPH_PAD = 18

function nodeName(node: PlacedNode, t: DependencyGraphProps['t']): string {
  if (node.lane === 'execution') {
    const status = t(`deps.status.${node.executionDisplay ?? 'ready'}`)
    return `${node.localKey ?? ''} ${node.text} ${status}`.trim()
  }
  if (node.lane === 'history') return t('deps.historyAria', { text: node.text })
  return t('deps.candidateAria', { text: node.text })
}

function edgeName(edge: PlacedEdge, model: RelationGraphModel, t: DependencyGraphProps['t']): string {
  const from = model.nodes.find(node => node.id === edge.from)
  const to = model.nodes.find(node => node.id === edge.to)
  const left = from?.localKey ?? from?.text ?? edge.from
  const right = to?.localKey ?? to?.text ?? edge.to
  if (edge.kind === 'proposed') return t('deps.proposedEdgeAria', { from: left, to: right })
  if (edge.kind === 'supersedes') return t('deps.supersedesEdgeAria', { from: left, to: right })
  return t(edge.state === 'staged-added' ? 'deps.edgeAriaAdded' : edge.state === 'staged-removed' ? 'deps.edgeAriaRemoved' : 'deps.edgeAria', { from: left, to: right })
}

function nodeClass(node: PlacedNode): string {
  return [
    'charter-graph__node',
    `is-${node.lane}`,
    node.ghost === true ? 'is-ghost' : '',
    node.lane === 'execution' ? `is-${node.executionDisplay ?? 'unknown'}` : '',
    `is-${node.state}`,
  ].filter(Boolean).join(' ')
}

function edgeClass(edge: PlacedEdge): string {
  return `charter-graph__edge is-${edge.kind} is-${edge.state}`
}

function edgeMarker(edge: PlacedEdge): string {
  if (edge.state === 'staged-added') return 'charter-arrow-staged'
  if (edge.state === 'staged-removed') return 'charter-arrow-removed'
  if (edge.kind === 'proposed') return 'charter-arrow-proposed'
  if (edge.kind === 'supersedes') return 'charter-arrow-history'
  return 'charter-arrow-committed'
}

function edgeHitStyle(edge: PlacedEdge, layout: GraphLayout): { left: number; top: number; width: number; angle: number } | null {
  const from = layout.nodes.find(node => node.id === edge.from)
  const to = layout.nodes.find(node => node.id === edge.to)
  if (from === undefined || to === undefined) return null
  const x1 = GRAPH_PAD + (from.x + from.w / 2) * PX_PER_EM
  const y1 = GRAPH_PAD + (from.y + 1.5) * PX_PER_EM_Y
  const x2 = GRAPH_PAD + (to.x + to.w / 2) * PX_PER_EM
  const y2 = GRAPH_PAD + (to.y + 1.5) * PX_PER_EM_Y
  return { left: (x1 + x2) / 2, top: (y1 + y2) / 2, width: Math.max(44, Math.hypot(x2 - x1, y2 - y1)), angle: Math.atan2(y2 - y1, x2 - x1) * 180 / Math.PI }
}

type ChipTone = 'neutral' | 'business' | 'success' | 'warn' | 'danger' | 'outline'

function nodeChip(node: PlacedNode): { readonly tone: ChipTone; readonly labelKey: string } {
  if (node.lane === 'candidate') return { tone: 'outline', labelKey: 'deps.candidateKicker' }
  if (node.lane === 'history') return { tone: 'neutral', labelKey: 'deps.historyKicker' }
  switch (node.executionDisplay) {
    case 'done': return { tone: 'success', labelKey: 'deps.status.done' }
    case 'in-progress': return { tone: 'business', labelKey: 'deps.status.in-progress' }
    case 'blocked': return { tone: 'warn', labelKey: 'deps.status.blocked' }
    case 'dependency-conflict': return { tone: 'danger', labelKey: 'deps.status.dependency-conflict' }
    default: return { tone: 'neutral', labelKey: `deps.status.${node.executionDisplay ?? 'ready'}` }
  }
}

function nodeFoot(node: PlacedNode, model: RelationGraphModel, t: DependencyGraphProps['t']): string {
  if (node.lane === 'candidate') return t('deps.candidateStatus')
  if (node.lane === 'history') return t('deps.historyStatus')
  const requires = [...new Set(model.edges
    .filter(edge => edge.kind === 'requires' && edge.to === node.id && edge.state !== 'staged-removed')
    .map(edge => model.nodes.find(candidate => candidate.id === edge.from)?.localKey ?? edge.from))]
  const staged = node.state === 'staged-added' || model.edges.some(edge => edge.kind === 'requires' && edge.to === node.id && edge.state === 'staged-added')
  const base = requires.length === 0 ? t('deps.noRequires') : t('deps.requiresSummary', { keys: requires.join(', ') })
  return staged ? `${base} · ${t('deps.stagedAdded')}` : base
}

export function DependencyGraph({
  layout, model, focusId, activeKey, showSupersedes, editable,
  onFocus, onActiveKey, onShowSupersedes, onStageRequires, onLocateList, onProposal, t,
}: DependencyGraphProps): JSX.Element {
  const groupRef = useRef<HTMLDivElement | null>(null)
  const key = activeKey ?? focusId ?? layout.traversal[0]
  const [inspector, setInspector] = useState<string | undefined>(undefined)
  const [zoom, setZoom] = useState(1)
  const [dragError, setDragError] = useState<string | null>(null)
  const selectedNode = inspector === undefined ? undefined : layout.nodes.find(node => node.id === inspector)
  const selectedEdge = inspector === undefined ? undefined : layout.edges.find(edge => edge.key === inspector)
  const activeNode = key === undefined ? undefined : layout.nodes.find(node => node.id === key)
  const activeEdge = key === undefined ? undefined : layout.edges.find(edge => edge.key === key)
  const inspectorLabel = selectedNode === undefined
    ? selectedEdge === undefined ? '' : edgeName(selectedEdge, model, t)
    : selectedNode.localKey ?? selectedNode.text
  const liveLabel = activeNode === undefined
    ? activeEdge === undefined ? '' : edgeName(activeEdge, model, t)
    : nodeName(activeNode, t)

  useEffect(() => {
    if (key === undefined) return
    if (!layout.traversal.includes(key)) {
      const next = layout.traversal[0]
      if (next !== undefined) onActiveKey(next)
    }
  }, [key, layout.traversal, onActiveKey])

  const executionNodes = useMemo(() => layout.nodes.filter(node => node.lane === 'execution'), [layout.nodes])
  const availableNodes = useMemo(() => model.nodes.filter(node => node.lane === 'execution'), [model.nodes])
  const lanes = useMemo(() => ([
    ['execution', layout.nodes.filter(node => node.lane === 'execution')],
    ['candidate', layout.nodes.filter(node => node.lane === 'candidate')],
    ['history', layout.nodes.filter(node => node.lane === 'history')],
  ] as const).flatMap(([lane, nodes]) => nodes.length === 0 ? [] : [{
    lane,
    count: nodes.length,
    top: lane === 'execution' ? 0 : GRAPH_PAD + Math.min(...nodes.map(node => node.y)) * PX_PER_EM_Y - 18,
    label: lane === 'execution' ? t('deps.laneExecution') : lane === 'candidate' ? t('deps.laneCandidate') : t('deps.laneHistory'),
  }]), [layout.nodes, t])

  const focusKey = (next: string): void => {
    onActiveKey(next)
    const element = groupRef.current?.querySelector<HTMLElement>(`[data-graph-key="${CSS.escape(next)}"]`)
    element?.focus()
  }

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>): void => {
    if (event.target !== event.currentTarget && (event.key === 'Enter' || event.key === ' ')) return
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      if (inspector !== undefined) {
        setInspector(undefined)
      } else {
        document.querySelector<HTMLElement>('.charter-graph__skip')?.focus()
      }
      return
    }
    if ((event.key === 'Delete' || event.key === 'Backspace') && key !== undefined) {
      const edge = layout.edges.find(candidate => candidate.key === key)
      if (edge?.kind === 'requires' && edge.editable && editable) {
        event.preventDefault()
        event.stopPropagation()
        onStageRequires(edge.to, projectedRequires(edge.to).filter(id => id !== edge.from))
      }
      return
    }
    const next = graphNavigationTarget(
      layout,
      key ?? '',
      event.key as Parameters<typeof graphNavigationTarget>[2],
    )
    if (next === null || next === key) return
    event.preventDefault()
    event.stopPropagation()
    focusKey(next)
  }

  const handleActivate = (targetKey: string): void => {
    onActiveKey(targetKey)
    const node = layout.nodes.find(candidate => candidate.id === targetKey)
    if (node !== undefined) {
      onFocus(node.id)
      setInspector(node.id)
      return
    }
    const edge = layout.edges.find(candidate => candidate.key === targetKey)
    if (edge?.kind === 'proposed') {
      onProposal(edge.targetProposalId ?? edge.to)
      return
    }
    setInspector(targetKey)
  }

  const removeRequires = (node: PlacedNode, id: string): void => {
    if (!editable) return
    onStageRequires(node.id, projectedRequires(node.id).filter(value => value !== id))
  }

  const projectedRequires = (id: string): readonly string[] => {
    // Use the full semantic model, not the ego-cropped layout: a node at the
    // depth boundary must still keep its prerequisites outside this view.
    return [...new Set(model.edges
      .filter(edge => edge.kind === 'requires' && edge.to === id && edge.state !== 'staged-removed')
      .map(edge => edge.from))]
  }

  const addRequires = (node: PlacedNode, prerequisiteId: string): void => {
    if (!editable || prerequisiteId === '' || prerequisiteId === node.id) return
    const current = projectedRequires(node.id)
    if (current.includes(prerequisiteId)) return
    onStageRequires(node.id, [...current, prerequisiteId])
  }

  return (
    <section className="charter-graph" aria-labelledby="charter-dependency-graph-title">
      <h4 id="charter-dependency-graph-title" className="charter-sr-only">{t('deps.graphTitle')}</h4>
      <div className="charter-graph__toolbar">
        <span className="charter-graph__title">{t('deps.graphTitle')}</span>
        <div className="charter-graph__tools">
          <label className="charter-graph__control">
            <span>{t('deps.graphFocus')}</span>
            <select
              className="charter-graph__select"
              aria-label={t('deps.graphFocus')}
              value={focusId ?? ''}
              onChange={event => { onFocus(event.target.value); onActiveKey(event.target.value) }}
            >
              {executionNodes.map(node => (
                <option key={node.id} value={node.id}>{node.localKey} · {node.text}</option>
              ))}
            </select>
          </label>
          <label className="charter-graph__check">
            <input type="checkbox" checked={showSupersedes} onChange={event => onShowSupersedes(event.target.checked)} />
            <span>{t('deps.historyToggle')}</span>
          </label>
          <span className="charter-graph__zoom">
            <button type="button" aria-label={t('deps.zoomOut')} onClick={() => setZoom(value => Math.max(0.75, Math.round((value - 0.25) * 100) / 100))}>−</button>
            <button type="button" aria-label={t('deps.resetLayout')} onClick={() => setZoom(1)}>{Math.round(zoom * 100)}%</button>
            <button type="button" aria-label={t('deps.zoomIn')} onClick={() => setZoom(value => Math.min(2, Math.round((value + 0.25) * 100) / 100))}>+</button>
          </span>
        </div>
      </div>
      {dragError !== null && <div className="charter-notice charter-notice--warning" role="alert">{dragError}</div>}
      {layout.edges.length === 0 && <p className="charter-hint charter-graph__hint">{t('deps.graphEmpty')}</p>}
      {layout.degraded.supersedesHidden && showSupersedes && <div className="charter-notice" role="status">{t('deps.graphDegradedSupersedes')}</div>}
      {layout.degraded.isolatedTooMany && <div className="charter-notice" role="status">{t('deps.graphIsolatedTooMany')}</div>}
      {layout.degraded.depthReduced && <div className="charter-notice" role="status">{t('deps.graphDegradedDepth')}</div>}
      {layout.degraded.hidden && !layout.degraded.isolatedTooMany && (
        <div className="charter-notice charter-notice--warning" role="status">
          {t('deps.graphTooDense', { count: layout.navigables })}
        </div>
      )}
      {!layout.degraded.hidden && (
        <>
          <div
            ref={groupRef}
            className="charter-graph__viewport"
            role="group"
            tabIndex={0}
            aria-label={t('deps.graphAria')}
            aria-describedby="charter-graph-keys"
            onKeyDown={handleKeyDown}
            onFocus={event => {
              if (event.target === event.currentTarget && key !== undefined) {
                groupRef.current?.querySelector<HTMLElement>(`[data-graph-key="${CSS.escape(key)}"]`)?.focus()
              }
            }}
          >
            <div
              className="charter-graph__canvas"
              role="img"
              aria-label={t('deps.graphAria')}
              style={{
                width: `${Math.max(layout.width, 1) * PX_PER_EM + GRAPH_PAD * 2}px`,
                height: `${Math.max(layout.height * PX_PER_EM_Y + GRAPH_PAD * 2, 360)}px`,
                transform: `scale(${zoom})`,
                transformOrigin: 'top left',
              }}
            >
              {lanes.map(lane => (
                <span key={lane.lane} className="charter-graph__lane" style={{ top: `${lane.top}px` }} aria-hidden="true">
                  {lane.label} <b>{lane.count}</b>
                </span>
              ))}
              <svg
                className="charter-graph__svg"
                style={{
                  left: `${GRAPH_PAD}px`,
                  top: `${GRAPH_PAD}px`,
                  width: `${Math.max(layout.width, 1) * PX_PER_EM}px`,
                  height: `${Math.max(layout.height, 1) * PX_PER_EM_Y}px`,
                }}
                viewBox={`0 0 ${Math.max(layout.width, 1)} ${Math.max(layout.height, 1)}`}
                preserveAspectRatio="none"
                aria-hidden="true"
                focusable="false"
              >
                <defs>
                  <marker id="charter-arrow-committed" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path className="charter-graph__arrow charter-graph__arrow--committed" d="M0,0 L8,4 L0,8 z" /></marker>
                  <marker id="charter-arrow-staged" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path className="charter-graph__arrow charter-graph__arrow--staged" d="M0,0 L8,4 L0,8 z" /></marker>
                  <marker id="charter-arrow-removed" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path className="charter-graph__arrow charter-graph__arrow--removed" d="M0,0 L8,4 L0,8 z" /></marker>
                  <marker id="charter-arrow-proposed" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path className="charter-graph__arrow charter-graph__arrow--proposed" d="M0,0 L8,4 L0,8 z" /></marker>
                  <marker id="charter-arrow-history" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path className="charter-graph__arrow charter-graph__arrow--history" d="M0,0 L8,4 L0,8 z" /></marker>
                </defs>
                {layout.edges.map(edge => (
                  <g key={edge.key} className={edgeClass(edge)}>
                    <path d={edge.path} className="charter-graph__edge-line" markerEnd={`url(#${edgeMarker(edge)})`} />
                    {edge.state === 'staged-removed' && <path d={edge.path} className="charter-graph__edge-removed" />}
                    <path
                      d={edge.path}
                      className="charter-graph__edgehit-path"
                      onClick={() => handleActivate(edge.key)}
                    />
                  </g>
                ))}
              </svg>
              {layout.nodes.map(node => (
                <button
                  key={node.id}
                  type="button"
                  className={nodeClass(node)}
                  data-graph-key={node.id}
                  tabIndex={-1}
                  aria-label={nodeName(node, t)}
                  aria-current={node.id === focusId ? 'true' : undefined}
                  style={{
                    left: `${GRAPH_PAD + node.x * PX_PER_EM}px`,
                    top: `${GRAPH_PAD + node.y * PX_PER_EM_Y}px`,
                    width: '184px',
                    minHeight: `${GRAPH.touchTargetPx}px`,
                  }}
                  draggable={editable && node.lane === 'execution'}
                  onDragStart={event => {
                    if (!editable || node.lane !== 'execution') return
                    setDragError(null)
                    event.dataTransfer.setData('text/plain', node.id)
                    event.dataTransfer.effectAllowed = 'link'
                  }}
                  onDragOver={event => {
                    if (!editable || node.lane !== 'execution') return
                    event.preventDefault()
                    event.dataTransfer.dropEffect = 'link'
                  }}
                  onDrop={event => {
                    if (!editable || node.lane !== 'execution') return
                    event.preventDefault()
                    const source = event.dataTransfer.getData('text/plain')
                    if (source === '') return
                    if (source === node.id) {
                      setDragError(t('deps.dropInvalidSelf'))
                      return
                    }
                    if (projectedRequires(node.id).includes(source)) {
                      setDragError(t('deps.dropInvalidDuplicate'))
                      return
                    }
                    addRequires(node, source)
                  }}
                  onFocus={() => onActiveKey(node.id)}
                  onClick={() => handleActivate(node.id)}
                >
                  <span className="charter-graph__nodehead">
                    <span className="charter-graph__nodekey">
                      {node.lane === 'execution' ? node.localKey : node.lane === 'history' ? t('deps.historyKicker') : t('deps.candidateKicker')}
                    </span>
                    <span className={`charter-tag charter-tag--${nodeChip(node).tone}`}>
                      {t(nodeChip(node).labelKey as never)}
                    </span>
                  </span>
                  <span className="charter-graph__nodetext" title={node.text}>{node.text}</span>
                  <span className="charter-graph__nodefoot">
                    {nodeFoot(node, model, t)}
                    {node.candidateCycle === true ? ` · ${t('deps.candidateCycle')}` : ''}
                  </span>
                </button>
              ))}
              {layout.edges.map(edge => (
                <button
                  key={`hit-${edge.key}`}
                  type="button"
                  className="charter-graph__edgehit"
                  data-graph-key={edge.key}
                  tabIndex={-1}
                  aria-label={edgeName(edge, model, t)}
                  title={edgeName(edge, model, t)}
                  style={(() => { const hit = edgeHitStyle(edge, layout); return hit === null ? { left: 0, top: 0, width: 44 } : { left: `${hit.left}px`, top: `${hit.top}px`, width: `${hit.width}px`, transform: `translate(-50%, -50%) rotate(${hit.angle}deg)` } })()}
                  onClick={() => handleActivate(edge.key)}
                />
              ))}
            </div>
          </div>
          <div className="charter-graph__legend">
            <span><i className="charter-graph__swatch charter-graph__swatch--committed" aria-hidden="true" />{t('deps.legendCommitted')}</span>
            <span><i className="charter-graph__swatch charter-graph__swatch--staged" aria-hidden="true" />{t('deps.legendStaged')}</span>
            <span><i className="charter-graph__swatch charter-graph__swatch--proposed" aria-hidden="true" />{t('deps.legendProposed')}</span>
            {layout.edges.some(edge => edge.kind === 'supersedes') && (
              <span><i className="charter-graph__swatch charter-graph__swatch--history" aria-hidden="true" />{t('deps.legendHistory')}</span>
            )}
          </div>
          <div className="charter-graph__footer">
            {(selectedNode?.lane === 'execution'
              || (selectedEdge !== undefined && model.nodes.find(node => node.id === selectedEdge.to)?.lane === 'execution')) && (
              <button type="button" className="charter-linkbutton" onClick={() => onLocateList(selectedNode?.id ?? selectedEdge?.to ?? '')}>
                {t('deps.locateInList')}
              </button>
            )}
            <span role="status" className="charter-sr-only">{liveLabel}</span>
          </div>
          <p className="charter-graph__note">{t('deps.graphNote')}</p>
          {(selectedNode !== undefined || selectedEdge !== undefined) && (
            <aside className="charter-graph__inspector" aria-label={t('deps.inspectorTitle', { key: inspectorLabel })}>
              {selectedNode !== undefined && (
                <>
                  <div className="charter-graph__inspectormain">
                    <span className="charter-graph__nodekey">{selectedNode.localKey ?? (selectedNode.lane === 'history' ? t('deps.historyKicker') : t('deps.candidateKicker'))}</span>
                    <b className="charter-graph__inspectortext">{selectedNode.text}</b>
                    <span className={`charter-tag charter-tag--${nodeChip(selectedNode).tone}`}>
                      {t(nodeChip(selectedNode).labelKey as never)}
                    </span>
                  </div>
                  <div className="charter-graph__inspectorrels">
                    {selectedNode.lane === 'execution' && (
                      <>
                        <span className="charter-graph__inspectorlabel">{t('deps.inspectorRequires')}</span>
                        {projectedRequires(selectedNode.id).length === 0
                          ? <span className="charter-graph__inspectormuted">{t('deps.noRequires')}</span>
                          : projectedRequires(selectedNode.id).map(id => {
                              const label = model.nodes.find(node => node.id === id)?.localKey ?? id
                              return (
                                <button key={id} type="button" className="charter-tag charter-tag--outline" onClick={() => removeRequires(selectedNode, id)} disabled={!editable}>
                                  {t('deps.removeRequires', { key: label })}
                                </button>
                              )
                            })}
                      </>
                    )}
                    {selectedNode.state !== 'unchanged' && (
                      <span className="charter-tag charter-tag--business">
                        {selectedNode.state === 'staged-added' ? t('deps.stagedAdded') : selectedNode.state === 'staged-removed' ? t('deps.stagedRemoved') : t('deps.stagedChanged')}
                      </span>
                    )}
                  </div>
                  <div className="charter-graph__inspectoractions">
                    <button type="button" className="charter-quietlink" onClick={() => onLocateList(selectedNode.id)}>{t('deps.locateInList')}</button>
                    {selectedNode.lane === 'execution' && editable && (
                      <select aria-label={t('deps.addRequires')} defaultValue="" onChange={event => { addRequires(selectedNode, event.target.value); event.currentTarget.value = '' }}>
                        <option value="">{t('deps.addRequires')}</option>
                        {availableNodes.filter(node => node.id !== selectedNode.id && !projectedRequires(selectedNode.id).includes(node.id)).map(node => (
                          <option key={node.id} value={node.id}>{node.localKey} · {node.text}</option>
                        ))}
                      </select>
                    )}
                    <button type="button" className="charter-quietlink" onClick={() => setInspector(undefined)}>{t('deps.closeInspector')}</button>
                  </div>
                </>
              )}
              {selectedEdge !== undefined && (
                <>
                  <div className="charter-graph__inspectormain">
                    <b className="charter-graph__inspectortext">{edgeName(selectedEdge, model, t)}</b>
                  </div>
                  <div className="charter-graph__inspectoractions">
                    <button type="button" className="charter-quietlink" onClick={() => onLocateList(selectedEdge.to)}>{t('deps.locateInList')}</button>
                    {selectedEdge.kind === 'requires' && selectedEdge.editable && editable && (
                      <button type="button" className="charter-quietlink" onClick={() => onStageRequires(selectedEdge.to, projectedRequires(selectedEdge.to).filter(id => id !== selectedEdge.from))}>
                        {t('deps.removeEdge')}
                      </button>
                    )}
                    {selectedEdge.kind === 'proposed' && (
                      <button type="button" className="charter-quietlink" onClick={() => onProposal(selectedEdge.targetProposalId ?? selectedEdge.to)}>{t('deps.openProposal')}</button>
                    )}
                    <button type="button" className="charter-quietlink" onClick={() => setInspector(undefined)}>{t('deps.closeInspector')}</button>
                  </div>
                </>
              )}
            </aside>
          )}
        </>
      )}
    </section>
  )
}
