import { useState } from 'react'
import type { ReactNode } from 'react'
import type { PaneScope } from './pane-scope.js'
import { ActionButton, ErrorDetails, TextEditor } from './pane-ui.js'
import { bootstrapProblemText, normalizedBytes, normalizedNonEmpty } from './pane-format.js'
import { PAGE_ORDER } from './page-order.js'
import { DependencyGraph } from './DependencyGraph.js'
import type { CharterLocaleKey } from './locales.js'
import { shortText } from './pane-format.js'

export function WorkspacePage({ scope }: { readonly scope: PaneScope }): ReactNode {
  const {
    activeDeliverables,
    activeInvariants,
    bootstrapPhase,
    bootstrapProblem,
    currentDeliverables,
    currentInvariants,
    deliverables,
    dependencyByItemId,
    dependencyEditorId,
    dependencyGraphActiveKey,
    dependencyGraphDepth,
    dependencyGraphProblem,
    dependencyGraphSupersedes,
    dependencyPlan,
    dependencyVisibleCount,
    draft,
    editable,
    editor,
    editorNeedsReason,
    editorReason,
    editorText,
    focusStatus,
    goSection,
    historyDeliverables,
    historyInvariants,
    invariants,
    locateGraphNodeInList,
    newDeliverable,
    newInvariant,
    objectiveStaged,
    openEditor,
    openHistory,
    pendingDeliverables,
    pendingInvariants,
    planInvalid,
    projectedItems,
    projectedObjective,
    relationFocusId,
    relationGraph,
    relationGraphAvailable,
    relationLayout,
    renderItems,
    saving,
    setDependencyEditorId,
    setDependencyGraphActiveKey,
    setDependencyGraphDepth,
    setDependencyGraphFocusId,
    setDependencyGraphSupersedes,
    setDependencyVisibleCount,
    setPendingProposalFocusId,
    showEmpty,
    stageGraphRequires,
    t,
    unknownBlocked,
    view,
  } = scope
  const [composer, setComposer] = useState<'invariant' | 'deliverable' | null>(null)
  const [showOriginal, setShowOriginal] = useState(false)
  const invariantSummary = t('counts.summary', { active: activeInvariants.length, pending: pendingInvariants.length })
  const deliverableSummary = t('counts.summary', { active: activeDeliverables.length, pending: pendingDeliverables.length })
  const pathKeys = dependencyPlan
    .map(row => dependencyByItemId.get(row.id)?.localKey)
    .filter((key): key is string => key !== undefined)

  const addComposer = (kind: 'invariant' | 'deliverable'): void => {
    setComposer(kind)
  }

  return (
    <>
      {bootstrapPhase === 'checking' && <div className="charter-notice" role="status">{t('bootstrap.loading')}</div>}
      {(bootstrapPhase === 'failed' || bootstrapPhase === 'unavailable'
        || bootstrapPhase === 'no-summary' || bootstrapPhase === 'not-live') && (
        <div className="charter-notice">
          <span role="status">
            {bootstrapProblemText(bootstrapProblem, t)
              ?? (bootstrapPhase === 'no-summary' ? t('bootstrap.noSummary')
                : bootstrapPhase === 'not-live' ? t('bootstrap.notLive')
                  : t('bootstrap.overviewFailed'))}
          </span>
          <ErrorDetails detail={bootstrapProblem?.detail} t={t} />
          <ActionButton variant="outline" onClick={() => draft.retryBootstrap(view)}>
            {t('bootstrap.checkAgain')}
          </ActionButton>
          <ActionButton variant="outline" onClick={openHistory}>{t('nav.open')}</ActionButton>
        </div>
      )}

      {showEmpty && (
        <div className="charter-empty-state" role="note">
          <h3>{t('empty.title')}</h3>
          <p>{t('empty.body')}</p>
          <div className="charter-empty-actions">
            <ActionButton variant="primary" disabled={!editable} onClick={() => goSection('objective')}>
              {t('objective.set')}
            </ActionButton>
            <ActionButton disabled={!editable} onClick={() => goSection('invariants')}>
              {t('composer.addInvariant')}
            </ActionButton>
          </div>
        </div>
      )}

      <section
        id="charter-objective"
        className={`charter-objective${objectiveStaged ? ' is-staged' : ''}`}
        style={{ order: PAGE_ORDER.workspace.objective }}
      >
        <div className="charter-cardhead">
          <div className="charter-cardtitle">
            <h3>{t('objective.kicker')}</h3>
          </div>
          <div className="charter-cardtools">
            {objectiveStaged && (
              <ActionButton
                variant="outline"
                disabled={!editable || saving || unknownBlocked}
                onClick={() => { draft.unstageObjective(); focusStatus() }}
              >
                {t('discard.unstageObjective')}
              </ActionButton>
            )}
            {projectedObjective !== null && (
              <button type="button" className="charter-quietlink" onClick={() => setShowOriginal(value => !value)}>
                {t('objective.originalLabel')}
              </button>
            )}
            <ActionButton
              variant="outline"
              disabled={!editable || (projectedObjective !== null && objectiveStaged)}
              onClick={() => openEditor({ kind: 'objective' })}
            >
              {projectedObjective === null ? t('objective.set') : t('objective.redirect')}
            </ActionButton>
          </div>
        </div>
        <div className={objectiveStaged ? 'charter-objective--staged' : undefined}>
          <p className={`charter-objective__text${projectedObjective === null ? ' is-empty' : ''}`}>
            {projectedObjective?.current.text ?? t('objective.empty')}
          </p>
          {objectiveStaged && (
            <div className="charter-item__sub">
              <span className="charter-tag charter-tag--info">{t('tag.staged')}</span>
            </div>
          )}
        </div>
        {showOriginal && projectedObjective !== null && (
          <p className="charter-original">{t('objective.original', { text: projectedObjective.original.text })}</p>
        )}
        {projectedObjective?.current.reason !== undefined && (
          <p className="charter-original">{t('objective.reason', { reason: projectedObjective.current.reason })}</p>
        )}
        {editor?.kind === 'objective' && (
          <div className="charter-inlineeditor">
            <TextEditor
              value={editorText}
              onChange={value => draft.setEditorText(value)}
              reason={editorReason}
              onReasonChange={value => draft.setEditorReason(value)}
              showReason={editorNeedsReason}
              onSave={() => draft.saveEditor(view)}
              onCancel={() => draft.closeEditor()}
              maxBytes={view.limits.maxObjectiveBytes}
              previousBytes={normalizedBytes(projectedObjective?.current.text ?? '')}
              label={t('editor.objectiveAria')}
              t={t}
            />
          </div>
        )}
      </section>

      <section id="charter-invariants" className="charter-section" style={{ order: PAGE_ORDER.workspace.invariants }}>
        <div className="charter-cardhead">
          <div className="charter-cardtitle">
            <h3>{t('invariants.kicker')}</h3>
            <span className="charter-count">{invariantSummary}</span>
          </div>
          {currentInvariants.length > 0 && (
            <div className="charter-cardtools">
              <ActionButton variant="outline" disabled={!editable} onClick={() => addComposer('invariant')}>
                + {t('composer.addInvariant')}
              </ActionButton>
            </div>
          )}
        </div>
        <div className="charter-list">
          {renderItems(currentInvariants, historyInvariants, 'invariants.empty', 'invariants')}
          {currentInvariants.length === 0 && (
            <button type="button" className="charter-empty-row" disabled={!editable} onClick={() => addComposer('invariant')}>
              + {t('composer.addInvariant')}
            </button>
          )}
        </div>
        {(composer === 'invariant' || normalizedNonEmpty(newInvariant)) && (
          <div className={`charter-add${normalizedBytes(newInvariant) > view.limits.maxItemBytes ? ' is-over' : ''}`}>
            <textarea
              rows={2}
              disabled={!editable}
              value={newInvariant}
              placeholder={t('composer.placeholderInvariant')}
              aria-label={t('composer.invariantAria')}
              aria-invalid={normalizedBytes(newInvariant) > view.limits.maxItemBytes}
              onChange={event => draft.setNewInvariant(event.target.value)}
              onKeyDown={event => {
                if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
                  event.preventDefault()
                  draft.addItem(view, 'invariant', newInvariant, () => {
                    draft.setNewInvariant('')
                    setComposer(null)
                  })
                }
              }}
            />
            {normalizedNonEmpty(newInvariant) && (
              <div className="charter-add__foot">
                <ActionButton variant="outline" disabled={!editable || normalizedBytes(newInvariant) > view.limits.maxItemBytes} onClick={() => draft.addItem(view, 'invariant', newInvariant, () => { draft.setNewInvariant(''); setComposer(null) })}>
                  {t('composer.addInvariant')}
                </ActionButton>
                <ActionButton variant="outline" disabled={!editable || normalizedBytes(newInvariant) > view.limits.maxItemBytes} onClick={() => draft.addProposal(view, 'invariant', newInvariant, () => { draft.setNewInvariant(''); setComposer(null) })}>
                  {t('composer.proposeInvariant')}
                </ActionButton>
              </div>
            )}
          </div>
        )}
        {editor !== null && editor.kind !== 'objective' && invariants.some(item => item.id === editor.item.id) && (
          <div className="charter-inlineeditor">
            <TextEditor value={editorText} onChange={value => draft.setEditorText(value)} onSave={() => draft.saveEditor(view)} onCancel={() => draft.closeEditor()} maxBytes={view.limits.maxItemBytes} previousBytes={editor.kind === 'edit' ? normalizedBytes(editor.item.text) : undefined} label={t('editor.invariantAria')} t={(key, values) => t(key as CharterLocaleKey, values)} />
          </div>
        )}
      </section>

      {planInvalid && <div className="charter-notice charter-notice--danger" role="alert">{t('deps.conflict')}</div>}

      {dependencyPlan.length > 0 && (
        <section id="charter-execution" className="charter-section" style={{ order: PAGE_ORDER.workspace.execution }}>
          <details className="charter-disclosure">
            <summary>
              <span className="charter-disclosure__caret" aria-hidden="true">▶</span>
              <h3 id="charter-dependency-title">{t('deps.executionPath')}</h3>
              <span className="charter-pathline">
                {pathKeys.length > 0 ? pathKeys.join(' → ') : t('deps.noRequires')}
              </span>
              <span className="charter-disclosure__hint">
                <span className="charter-disclosure__hint-expand">{t('deps.expandGraph')}</span>
                <span className="charter-disclosure__hint-collapse">{t('deps.collapseGraph')}</span>
              </span>
            </summary>
            {dependencyGraphProblem !== null && <div className="charter-notice" role="alert">{dependencyGraphProblem}</div>}
            {relationGraphAvailable && relationGraph !== null && relationLayout !== null
              && !relationLayout.degraded.hidden && !relationLayout.degraded.isolatedTooMany && (
                <div className="charter-graphcard">
                  <DependencyGraph
                    layout={relationLayout}
                    model={relationGraph}
                    focusId={relationFocusId}
                    activeKey={dependencyGraphActiveKey ?? relationFocusId}
                    depth={dependencyGraphDepth}
                    showSupersedes={dependencyGraphSupersedes}
                    editable={editable}
                    onFocus={id => { setDependencyGraphFocusId(id); setDependencyGraphActiveKey(id) }}
                    onActiveKey={setDependencyGraphActiveKey}
                    onDepth={setDependencyGraphDepth}
                    onShowSupersedes={setDependencyGraphSupersedes}
                    onStageRequires={stageGraphRequires}
                    onLocateList={locateGraphNodeInList}
                    onProposal={id => { setPendingProposalFocusId(id); goSection('history') }}
                    t={(key, values) => t(key as CharterLocaleKey, values)}
                  />
                </div>
              )}
            {relationGraphAvailable && relationLayout !== null && relationLayout.degraded.isolatedTooMany && (
              <p className="charter-graph__note">{t('deps.graphIsolatedTooMany')}</p>
            )}
            {relationGraphAvailable && relationLayout !== null && relationLayout.degraded.hidden && !relationLayout.degraded.isolatedTooMany && (
              <p className="charter-graph__note">{t('deps.graphTooDense', { count: relationLayout.navigables })}</p>
            )}
          </details>
          <div className="charter-list" id="charter-dependency-list">
            {dependencyPlan.slice(0, dependencyVisibleCount).map(row => {
              const item = projectedItems.find(candidate => candidate.id === row.id)
                ?? view.items.find(candidate => candidate.id === row.id)
              return (
                <div key={row.id} className="charter-row" data-dependency-id={row.id}>
                  <span className={`charter-state-mark charter-state-mark--${row.executionDisplay}`} aria-hidden="true" />
                  <div className="charter-row__body">
                    <span className="charter-row__text">{item?.text ?? row.id}</span>
                    <span className="charter-item__sub">
                      <span className={`charter-tag charter-tag--${row.executionDisplay === 'dependency-conflict' ? 'danger' : row.executionDisplay === 'blocked' ? 'warning' : row.executionDisplay === 'terminal' ? 'success' : 'info'}`}>
                        {t(`deps.status.${row.executionDisplay}`)}
                      </span>
                      <span className="charter-row__meta">{row.localKey}</span>
                      <span className="charter-row__meta">
                        {row.requires.length > 0
                          ? t('deps.requiresSummary', { keys: row.requires.map(requireId => dependencyByItemId.get(requireId)?.localKey ?? requireId).join(', ') })
                          : t('deps.noRequires')}
                      </span>
                    </span>
                  </div>
                  <div className="charter-row__actions">
                    <button type="button" className="charter-quietlink" aria-expanded={dependencyEditorId === row.id} onClick={() => setDependencyEditorId(id => id === row.id ? null : row.id)}>
                      {t('deps.editRequires')}
                    </button>
                  </div>
                  {dependencyEditorId === row.id && (
                    <fieldset className="charter-dependency__editor">
                      <legend>{t('deps.editRequires')}</legend>
                      {view.items
                        .filter(candidate => candidate.kind === 'deliverable'
                          && candidate.review === 'accepted'
                          && candidate.lifecycle === 'current'
                          && candidate.id !== row.id)
                        .map(candidate => (
                          <label key={candidate.id}>
                            <input
                              type="checkbox"
                              checked={row.requiresIds.includes(candidate.id)}
                              disabled={!editable || saving || unknownBlocked}
                              onChange={event => {
                                const next = event.target.checked
                                  ? [...row.requiresIds, candidate.id]
                                  : row.requiresIds.filter(id => id !== candidate.id)
                                draft.setDeliverableRequires(view, row.id, next)
                              }}
                            />
                            <span>{dependencyByItemId.get(candidate.id)?.localKey ?? ''} · {shortText(candidate.text, 40)}</span>
                          </label>
                        ))}
                    </fieldset>
                  )}
                </div>
              )
            })}
            {dependencyPlan.length > dependencyVisibleCount && (
              <button type="button" className="charter-quietlink" onClick={() => setDependencyVisibleCount(count => count + 50)}>
                {t('deps.showMore', { count: Math.min(50, dependencyPlan.length - dependencyVisibleCount) })}
              </button>
            )}
          </div>
        </section>
      )}

      <section id="charter-deliverables" className="charter-section" style={{ order: PAGE_ORDER.workspace.deliverables }}>
        <div className="charter-cardhead">
          <div className="charter-cardtitle">
            <h3>{t('deliverables.kicker')}</h3>
            <span className="charter-count">{deliverableSummary}</span>
          </div>
          {currentDeliverables.length > 0 && (
            <div className="charter-cardtools">
              <ActionButton variant="outline" disabled={!editable} onClick={() => addComposer('deliverable')}>
                + {t('composer.addDeliverable')}
              </ActionButton>
            </div>
          )}
        </div>
        <div className="charter-list">
          {renderItems(currentDeliverables, historyDeliverables, 'deliverables.empty', 'deliverables')}
          {currentDeliverables.length === 0 && (
            <button type="button" className="charter-empty-row" disabled={!editable} onClick={() => addComposer('deliverable')}>
              + {t('composer.addDeliverable')}
            </button>
          )}
        </div>
        {(composer === 'deliverable' || normalizedNonEmpty(newDeliverable)) && (
          <div className={`charter-add${normalizedBytes(newDeliverable) > view.limits.maxItemBytes ? ' is-over' : ''}`}>
            <textarea
              rows={2}
              disabled={!editable}
              value={newDeliverable}
              placeholder={t('composer.placeholderDeliverable')}
              aria-label={t('composer.deliverableAria')}
              aria-invalid={normalizedBytes(newDeliverable) > view.limits.maxItemBytes}
              onChange={event => draft.setNewDeliverable(event.target.value)}
              onKeyDown={event => {
                if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
                  event.preventDefault()
                  draft.addItem(view, 'deliverable', newDeliverable, () => { draft.setNewDeliverable(''); setComposer(null) })
                }
              }}
            />
            {normalizedNonEmpty(newDeliverable) && (
              <div className="charter-add__foot">
                <ActionButton variant="outline" disabled={!editable || normalizedBytes(newDeliverable) > view.limits.maxItemBytes} onClick={() => draft.addItem(view, 'deliverable', newDeliverable, () => { draft.setNewDeliverable(''); setComposer(null) })}>
                  {t('composer.addDeliverable')}
                </ActionButton>
                <ActionButton variant="outline" disabled={!editable || normalizedBytes(newDeliverable) > view.limits.maxItemBytes} onClick={() => draft.addProposal(view, 'deliverable', newDeliverable, () => { draft.setNewDeliverable(''); setComposer(null) })}>
                  {t('composer.proposeDeliverable')}
                </ActionButton>
              </div>
            )}
          </div>
        )}
        {editor !== null && editor.kind !== 'objective' && deliverables.some(item => item.id === editor.item.id) && (
          <div className="charter-inlineeditor">
            <TextEditor value={editorText} onChange={value => draft.setEditorText(value)} onSave={() => draft.saveEditor(view)} onCancel={() => draft.closeEditor()} maxBytes={view.limits.maxItemBytes} previousBytes={editor.kind === 'edit' ? normalizedBytes(editor.item.text) : undefined} label={t('editor.deliverableAria')} t={t} />
          </div>
        )}
      </section>
    </>
  )
}
