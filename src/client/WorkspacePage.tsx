import type { ReactNode } from 'react'
import type { PaneScope } from './pane-scope.js'
import { ActionButton, ErrorDetails, TextEditor } from './pane-ui.js'
import { bootstrapProblemText, normalizedBytes, normalizedNonEmpty } from './pane-format.js'
import { PAGE_ORDER } from './page-order.js'
import { DependencyGraph } from './DependencyGraph.js'
import { shortText } from './pane-format.js'
import { utf8Bytes } from './preview.js'
import type { CharterLocaleKey } from './locales.js'

export function WorkspacePage({ scope }: { readonly scope: PaneScope }): ReactNode {
  const {
    bootstrapPhase,
    bootstrapProblem,
    counts,
    currentDeliverables,
    currentInvariants,
    deliverables,
    dependencyByItemId,
    dependencyEditorId,
    dependencyGraphActiveKey,
    dependencyGraphDepth,
    dependencyGraphHidden,
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
    planInvalid,
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
    setDependencyGraphHidden,
    setDependencyGraphSupersedes,
    setDependencyVisibleCount,
    setPendingProposalFocusId,
    showEmpty,
    stageGraphRequires,
    t,
    unknownBlocked,
    view,
  } = scope

  return (
    <>
      {bootstrapPhase === 'checking' && <div className="charter-notice" role="status">{t('bootstrap.loading')}</div>}
      {(bootstrapPhase === 'failed' || bootstrapPhase === 'unavailable'
        || bootstrapPhase === 'no-summary' || bootstrapPhase === 'not-live') && (
        <div className="charter-callout charter-callout--static">
          <span role="status">
            {bootstrapProblemText(bootstrapProblem, t)
              ?? (bootstrapPhase === 'no-summary' ? t('bootstrap.noSummary')
                : bootstrapPhase === 'not-live' ? t('bootstrap.notLive')
                  : t('bootstrap.overviewFailed'))}
          </span>
          <ErrorDetails detail={bootstrapProblem?.detail} t={t} />
          <span className="charter-callout__actions">
            <ActionButton variant="outline" onClick={() => draft.retryBootstrap(view)}>
              {t('bootstrap.checkAgain')}
            </ActionButton>
            <ActionButton onClick={openHistory}>{t('nav.open')}</ActionButton>
          </span>
        </div>
      )}

      {showEmpty && (
        <section className="charter-empty-state" role="note">
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
        </section>
      )}

      <section
        id="charter-objective"
        className={`charter-card charter-objective${utf8Bytes(projectedObjective?.current.text ?? '') > view.limits.maxObjectiveBytes ? ' is-over' : ''}`}
        style={{ order: PAGE_ORDER.workspace.objective }}
      >
        <div className="charter-cardhead">
          <div className="charter-cardtitle">
            <h3>{t('objective.kicker')}</h3>
            {objectiveStaged && <span className="charter-tag charter-tag--info">{t('tag.staged')}</span>}
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
            <ActionButton
              variant="outline"
              disabled={!editable || (projectedObjective !== null && objectiveStaged)}
              onClick={() => openEditor({ kind: 'objective' })}
            >
              {projectedObjective === null ? t('objective.set') : t('objective.redirect')}
            </ActionButton>
          </div>
        </div>
        <p className={`charter-objective__text${projectedObjective === null ? ' is-empty' : ''}`}>
          {projectedObjective?.current.text ?? t('objective.empty')}
        </p>
        {projectedObjective !== null && projectedObjective.original.text !== projectedObjective.current.text && (
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

      <section id="charter-invariants" className="charter-card charter-section" style={{ order: PAGE_ORDER.workspace.invariants }}>
        <div className="charter-cardhead">
          <h3>{t('invariants.kicker')}</h3>
        </div>
        {counts.pending > 0 && <p className="charter-hint">{t('pending.hint')}</p>}
        <div className="charter-list">
          {renderItems(currentInvariants, historyInvariants, 'invariants.empty', 'invariants')}
        </div>
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
                draft.addItem(view, 'invariant', newInvariant, () => draft.setNewInvariant(''))
              }
            }}
          />
          {normalizedNonEmpty(newInvariant) && (
            <div className="charter-add__foot">
              <ActionButton variant="outline" disabled={!editable || normalizedBytes(newInvariant) > view.limits.maxItemBytes} onClick={() => draft.addItem(view, 'invariant', newInvariant, () => draft.setNewInvariant(''))}>
                {t('composer.addInvariant')}
              </ActionButton>
              <ActionButton variant="outline" disabled={!editable || normalizedBytes(newInvariant) > view.limits.maxItemBytes} onClick={() => draft.addProposal(view, 'invariant', newInvariant, () => draft.setNewInvariant(''))}>
                {t('composer.proposeInvariant')}
              </ActionButton>
            </div>
          )}
        </div>
        {editor !== null && editor.kind !== 'objective' && invariants.some(item => item.id === editor.item.id) && (
          <div className="charter-inlineeditor">
            <TextEditor value={editorText} onChange={value => draft.setEditorText(value)} onSave={() => draft.saveEditor(view)} onCancel={() => draft.closeEditor()} maxBytes={view.limits.maxItemBytes} previousBytes={editor.kind === 'edit' ? normalizedBytes(editor.item.text) : undefined} label={t('editor.invariantAria')} t={(key, values) => t(key as CharterLocaleKey, values)} />
          </div>
        )}
      </section>

      {planInvalid && <div className="charter-notice charter-notice--danger" role="alert">{t('deps.conflict')}</div>}

      {dependencyPlan.length > 0 && (
<section id="charter-execution" className="charter-card charter-section" aria-labelledby="charter-dependency-title" style={{ order: PAGE_ORDER.workspace.execution }}>
                <div className="charter-cardhead">
                  <div className="charter-cardtitle">
                    <h3 id="charter-dependency-title">{t('deps.title')}</h3>
                  </div>
                  <div className="charter-cardtools">
                    <span className="charter-count">{dependencyPlan.length}</span>
                    {relationGraphAvailable && (<button type="button" className="charter-linkbutton" aria-pressed={!dependencyGraphHidden} onClick={() => setDependencyGraphHidden(value => !value)}>
                        {dependencyGraphHidden ? t('deps.showGraph') : t('deps.hideGraph')}
                      </button>)}
                  </div>
                </div>
                {dependencyGraphProblem !== null && (<div className="charter-notice charter-notice--warning" role="alert">{dependencyGraphProblem}</div>)}
                <div className={`charter-dependency-layout${dependencyGraphHidden ? ' is-graph-hidden' : ''}`}>
                  {!dependencyGraphHidden && relationGraphAvailable && relationLayout !== null
            && !relationLayout.degraded.hidden && !relationLayout.degraded.isolatedTooMany && (<a className="charter-graph__skip" href="#charter-dependency-list">{t('deps.skipToList')}</a>)}
                  {!dependencyGraphHidden && relationGraphAvailable && relationGraph !== null && relationLayout !== null && (<DependencyGraph layout={relationLayout} model={relationGraph} focusId={relationFocusId} activeKey={dependencyGraphActiveKey ?? relationFocusId} depth={dependencyGraphDepth} showSupersedes={dependencyGraphSupersedes} editable={editable} onFocus={id => {
                setDependencyGraphFocusId(id);
                setDependencyGraphActiveKey(id);
            }} onActiveKey={setDependencyGraphActiveKey} onDepth={setDependencyGraphDepth} onShowSupersedes={setDependencyGraphSupersedes} onStageRequires={stageGraphRequires} onLocateList={locateGraphNodeInList} onProposal={id => { setPendingProposalFocusId(id); goSection('history'); }} t={(key, values) => t(key as CharterLocaleKey, values)}/>)}
                  <div className="charter-dependency-listwrap">
                    <ol className="charter-dependency-list" id="charter-dependency-list">
                      {dependencyPlan.slice(0, dependencyVisibleCount).map((row, rowIndex) => {
            const item = view.items.find(candidate => candidate.id === row.id);
            return (<li key={row.id} className={`charter-dependency is-${row.executionDisplay}`} data-dependency-id={row.id} tabIndex={-1}>
                            <span className="charter-sr-only">{t('deps.rowPosition', { index: rowIndex + 1, total: dependencyPlan.length })}</span>
                            <div className="charter-dependency__row">
                              <span className="charter-dependency__key">{row.localKey}</span>
                              <div className="charter-dependency__main">
                                <span className="charter-dependency__text" title={item?.text ?? row.id}>
                                  {item?.text ?? row.id}
                                </span>
                                <span className="charter-dependency__meta">
                                  <span className={`charter-dependency__status is-${row.executionDisplay}`}>
                                    {t(`deps.status.${row.executionDisplay}`)}
                                  </span>
                                  {row.prerequisiteStatus === 'dependency-conflict' && row.executionDisplay !== 'dependency-conflict' && (<span className="charter-dependency__status is-conflict">{t('deps.prerequisiteConflict')}</span>)}
                                  <span className="charter-dependency__requires">
                                    {row.requires.length > 0
                    ? t('deps.requiresSummary', {
                        keys: row.requires
                            .map(requireId => dependencyByItemId.get(requireId)?.localKey ?? requireId)
                            .join(', '),
                    })
                    : t('deps.noRequires')}
                                  </span>
                                </span>
                              </div>
                              <div className="charter-dependency__actions">
                                {relationGraphAvailable && (<button type="button" className="charter-linkbutton" onClick={() => {
                        setDependencyGraphHidden(false);
                        setDependencyGraphFocusId(row.id);
                        setDependencyGraphActiveKey(row.id);
                    }}>
                                    {t('deps.locateInGraph')}
                                  </button>)}
                                <button type="button" className="charter-linkbutton" aria-expanded={dependencyEditorId === row.id} onClick={() => setDependencyEditorId(id => id === row.id ? null : row.id)}>
                                  {t('deps.editRequires')}
                                </button>
                              </div>
                            </div>
                            {dependencyEditorId === row.id && (<fieldset className="charter-dependency__editor">
                                <legend>{t('deps.editRequires')}</legend>
                                {view.items
                        .filter(candidate => candidate.kind === 'deliverable'
                        && candidate.review === 'accepted'
                        && candidate.lifecycle === 'current'
                        && candidate.id !== row.id)
                        .map(candidate => {
                        const candidateKey = dependencyByItemId.get(candidate.id)?.localKey ?? '';
                        return (<label key={candidate.id}>
                                        <input type="checkbox" checked={row.requiresIds.includes(candidate.id)} disabled={!editable || saving || unknownBlocked} onChange={event => {
                                const next = event.target.checked
                                    ? [...row.requiresIds, candidate.id]
                                    : row.requiresIds.filter(id => id !== candidate.id);
                                draft.setDeliverableRequires(view, row.id, next);
                            }}/>
                                        <span>{candidateKey} · {shortText(candidate.text, 40)}</span>
                                      </label>);
                    })}
                              </fieldset>)}
                          </li>);
        })}
                    </ol>
                    {dependencyPlan.length > dependencyVisibleCount && (<button type="button" className="charter-linkbutton" onClick={() => setDependencyVisibleCount(count => count + 50)}>
                        {t('deps.showMore', { count: Math.min(50, dependencyPlan.length - dependencyVisibleCount) })}
                      </button>)}
                  </div>
                </div>
              </section>
      )}

      <section id="charter-deliverables" className="charter-card charter-section" style={{ order: PAGE_ORDER.workspace.deliverables }}>
        <div className="charter-cardhead">
          <h3>{t('deliverables.kicker')}</h3>
        </div>
        <div className="charter-list">
          {renderItems(currentDeliverables, historyDeliverables, 'deliverables.empty', 'deliverables')}
        </div>
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
                draft.addItem(view, 'deliverable', newDeliverable, () => draft.setNewDeliverable(''))
              }
            }}
          />
          {normalizedNonEmpty(newDeliverable) && (
            <div className="charter-add__foot">
              <ActionButton variant="outline" disabled={!editable || normalizedBytes(newDeliverable) > view.limits.maxItemBytes} onClick={() => draft.addItem(view, 'deliverable', newDeliverable, () => draft.setNewDeliverable(''))}>
                {t('composer.addDeliverable')}
              </ActionButton>
              <ActionButton variant="outline" disabled={!editable || normalizedBytes(newDeliverable) > view.limits.maxItemBytes} onClick={() => draft.addProposal(view, 'deliverable', newDeliverable, () => draft.setNewDeliverable(''))}>
                {t('composer.proposeDeliverable')}
              </ActionButton>
            </div>
          )}
        </div>
        {editor !== null && editor.kind !== 'objective' && deliverables.some(item => item.id === editor.item.id) && (
          <div className="charter-inlineeditor">
            <TextEditor value={editorText} onChange={value => draft.setEditorText(value)} onSave={() => draft.saveEditor(view)} onCancel={() => draft.closeEditor()} maxBytes={view.limits.maxItemBytes} previousBytes={editor.kind === 'edit' ? normalizedBytes(editor.item.text) : undefined} label={t('editor.deliverableAria')} t={t} />
          </div>
        )}
      </section>
    </>
  )
}
