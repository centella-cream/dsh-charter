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

export function DependencyGraph({
  layout, model, focusId, activeKey, depth, showSupersedes, editable,
  onFocus, onActiveKey, onDepth, onShowSupersedes, onStageRequires, onLocateList, onProposal, t,
}: DependencyGraphProps): JSX.Element {
  const groupRef = useRef<HTMLDivElement | null>(null)
  const key = activeKey ?? focusId ?? layout.traversal[0]
  const [inspector, setInspector] = useState<string | undefined>(key)
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
      <div className="charter-graph__toolbar">
        <div className="charter-graph__toolbar-title">
          <span className="charter-kicker">{t('deps.graphKicker')}</span>
          <h4 id="charter-dependency-graph-title">{t('deps.graphTitle')}</h4>
        </div>
        <label className="charter-graph__control">
          <span>{t('deps.graphFocus')}</span>
          <select
            aria-label={t('deps.graphFocus')}
            value={focusId ?? ''}
            onChange={event => { onFocus(event.target.value); onActiveKey(event.target.value) }}
          >
            {executionNodes.map(node => (
              <option key={node.id} value={node.id}>{node.localKey} · {node.text}</option>
            ))}
          </select>
        </label>
        <div className="charter-graph__control">
          <span>{t('deps.graphDepth')}</span>
          <button type="button" aria-pressed={depth === 1} onClick={() => onDepth(1)}>{t('deps.depth1')}</button>
          <button type="button" aria-pressed={depth === 2} onClick={() => onDepth(2)}>{t('deps.depth2')}</button>
        </div>
        <label className="charter-graph__control charter-graph__check">
          <input type="checkbox" checked={showSupersedes} onChange={event => onShowSupersedes(event.target.checked)} />
          <span>{t('deps.showSupersedes')}</span>
        </label>
        <div className="charter-graph__control">
          <button type="button" aria-label={t('deps.zoomOut')} onClick={() => setZoom(value => Math.max(0.75, Math.round((value - 0.25) * 100) / 100))}>−</button>
          <button type="button" aria-label={t('deps.resetLayout')} onClick={() => setZoom(1)}>{Math.round(zoom * 100)}%</button>
          <button type="button" aria-label={t('deps.zoomIn')} onClick={() => setZoom(value => Math.min(2, Math.round((value + 0.25) * 100) / 100))}>+</button>
        </div>
      </div>
      {dragError !== null && <div className="charter-notice charter-notice--warning" role="alert">{dragError}</div>}
      {layout.edges.length === 0 && <p className="charter-hint charter-graph__hint">{t('deps.graphEmpty')}</p>}
      <p className="charter-hint charter-graph__hint">{t('deps.graphHint')}</p>
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
              style={{
                width: `${Math.max(layout.width, 1)}em`,
                height: `${Math.max(layout.height, 1)}em`,
                transform: `scale(${zoom})`,
                transformOrigin: 'top left',
              }}
            >
              <svg
                className="charter-graph__svg"
                viewBox={`0 0 ${Math.max(layout.width, 1)} ${Math.max(layout.height, 1)}`}
                preserveAspectRatio="none"
                aria-hidden="true"
                focusable="false"
              >
                {layout.edges.map(edge => (
                  <g key={edge.key} className={edgeClass(edge)}>
                    <path d={edge.path} className="charter-graph__edge-line" />
                    {edge.state === 'staged-removed' && <path d={edge.path} className="charter-graph__edge-removed" />}
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
                    left: `${node.x}em`,
                    top: `${node.y}em`,
                    width: `${node.w}em`,
                    height: `max(${node.h}em, ${GRAPH.touchTargetPx}px)`,
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
                  <span className="charter-graph__nodekey">
                    {node.lane === 'execution' ? node.localKey : node.lane === 'history' ? t('deps.historyKicker') : t('deps.candidateKicker')}
                  </span>
                  <span className="charter-graph__nodetext">{node.text}</span>
                  <span className="charter-graph__nodestatus">
                    {node.lane === 'execution'
                      ? `${t(`deps.status.${node.executionDisplay ?? 'ready'}`)}${node.prerequisiteStatus === 'dependency-conflict' && node.executionDisplay !== 'dependency-conflict' ? ` · ${t('deps.prerequisiteConflict')}` : ''}`
                      : node.lane === 'history' ? t('deps.historyStatus') : t('deps.candidateStatus')}
                    {node.state === 'staged-added' ? ` · ${t('deps.stagedAdded')}` : node.state === 'staged-removed' ? ` · ${t('deps.stagedRemoved')}` : ''}
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
                  style={{
                    left: `${edge.labelAt.x}em`,
                    top: `${edge.labelAt.y}em`,
                  }}
                  onClick={() => handleActivate(edge.key)}
                />
              ))}
            </div>
            <p id="charter-graph-keys" className="charter-hint">
              {t('deps.graphKeys')}
            </p>
          </div>
          <div className="charter-graph__footer">
            {(selectedNode?.lane === 'execution'
              || (selectedEdge !== undefined && model.nodes.find(node => node.id === selectedEdge.to)?.lane === 'execution')) && (
              <button type="button" className="charter-linkbutton" onClick={() => onLocateList(selectedNode?.id ?? selectedEdge?.to ?? '')}>
                {t('deps.locateInList')}
              </button>
            )}
            <span role="status" className="charter-graph__live">{liveLabel}</span>
          </div>
          {(selectedNode !== undefined || selectedEdge !== undefined) && (
            <aside className="charter-graph__inspector" aria-label={t('deps.inspectorTitle', { key: inspectorLabel })}>
              <div className="charter-graph__inspectorhead">
                <h4>{t('deps.inspectorTitle', { key: inspectorLabel })}</h4>
                <button type="button" className="charter-linkbutton" onClick={() => setInspector(undefined)}>{t('deps.closeInspector')}</button>
              </div>
              {selectedNode !== undefined && (
                <>
                  <p className="charter-graph__inspectortext">{selectedNode.text}</p>
                  <dl className="charter-graph__inspectormeta">
                    <div><dt>{t('deps.inspectorStatus')}</dt><dd>{selectedNode.executionDisplay === undefined ? (selectedNode.lane === 'history' ? t('deps.historyStatus') : t('deps.candidateStatus')) : t(`deps.status.${selectedNode.executionDisplay}`)}</dd></div>
                    {selectedNode.lane === 'execution' && <div><dt>{t('deps.inspectorRequires')}</dt><dd>{projectedRequires(selectedNode.id).map(id => model.nodes.find(node => node.id === id)?.localKey ?? id).join(', ') || '—'}</dd></div>}
                  </dl>
                  {selectedNode.lane === 'execution' && editable && (
                    <div className="charter-graph__inspectoractions">
                      <select aria-label={t('deps.addRequires')} defaultValue="" onChange={event => { addRequires(selectedNode, event.target.value); event.currentTarget.value = '' }}>
                        <option value="">{t('deps.addRequires')}</option>
                        {availableNodes.filter(node => node.id !== selectedNode.id && !projectedRequires(selectedNode.id).includes(node.id)).map(node => (
                          <option key={node.id} value={node.id}>{node.localKey} · {node.text}</option>
                        ))}
                      </select>
                      {projectedRequires(selectedNode.id).map(id => (
                        <button key={id} type="button" className="charter-linkbutton" onClick={() => removeRequires(selectedNode, id)}>
                          {t('deps.removeRequires', { key: model.nodes.find(node => node.id === id)?.localKey ?? id })}
                        </button>
                      ))}
                    </div>
                  )}
                </>
              )}
              {selectedEdge !== undefined && (
                <>
                  <p className="charter-graph__inspectortext">{edgeName(selectedEdge, model, t)}</p>
                  {selectedEdge.kind === 'requires' && selectedEdge.editable && editable && (
                    <button type="button" className="charter-linkbutton" onClick={() => onStageRequires(selectedEdge.to, projectedRequires(selectedEdge.to).filter(id => id !== selectedEdge.from))}>
                      {t('deps.removeEdge')}
                    </button>
                  )}
                  {selectedEdge.kind === 'proposed' && (
                    <button type="button" className="charter-linkbutton" onClick={() => onProposal(selectedEdge.targetProposalId ?? selectedEdge.to)}>{t('deps.openProposal')}</button>
                  )}
                </>
              )}
            </aside>
          )}
        </>
      )}
    </section>
  )
}
