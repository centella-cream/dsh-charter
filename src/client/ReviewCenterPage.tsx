import type { ReactNode } from 'react'
import type { PaneScope } from './pane-scope.js'
import { ActionButton, ErrorDetails, StatusTag } from './pane-ui.js'
import { bootstrapProblemText, formatBytes, normalizedBytes, shortText, textIssueMessage } from './pane-format.js'
import { inspectUserText } from '../core/normalize.js'
import { PAGE_ORDER } from './page-order.js'

export function ReviewCenterPage({ scope }: { readonly scope: PaneScope }): ReactNode {
  const {
  abandonUnknown,
  applyBootstrapDraft,
  applyHintId,
  area,
  batchByItem,
  bootstrap,
  bootstrapBudgetOver,
  bootstrapId,
  bootstrapItems,
  bootstrapObjective,
  bootstrapObjectiveOver,
  bootstrapPhase,
  bootstrapPlan,
  bootstrapProblem,
  bootstrapPromptBytes,
  bootstrapReplay,
  bootstrapSaving,
  bootstrapStorageOver,
  bootstrapTextIssue,
  bootstrapVisibleCount,
  canApplyBootstrap,
  closedObjectiveProposals,
  confirmAbandon,
  draft,
  editor,
  inactiveItems,
  messageBytes,
  messageCanSave,
  messageCandidates,
  messageDraft,
  messageKind,
  messageMenuOpen,
  messageMenuRef,
  messageOverBudget,
  messageSeq,
  messageTextAvailable,
  ops,
  pendingItemProposals,
  pendingObjectiveProposals,
  proposalReasons,
  reviewLimit,
  saving,
  selectedMessage,
  setMessageDraft,
  setMessageKind,
  setMessageMenuOpen,
  setMessageSeq,
  setProposalReasons,
  setReviewLimit,
  source,
  t,
  unknownBlocked,
  unknownReplay,
  view,
  } = scope
  return (
    <>


    {area === 'review' && source.proposeMessage !== undefined && (<section className="charter-card charter-section charter-messageproposal" aria-labelledby="charter-message-proposal-title" style={{ order: PAGE_ORDER.review.messageProposal }}>
                <div className="charter-cardhead">
                  <div className="charter-cardtitle">
                    <h3 id="charter-message-proposal-title">{t('review.messageProposal')}</h3>
                  </div>
                </div>
                <div className="charter-messageproposal__form">
                  <div className="charter-messageproposal__field">
                    <span className="charter-fieldlabel">{t('message.pick')}</span>
                    <div className="charter-messageproposal__picker" onBlur={event => {
            if (!event.currentTarget.contains(event.relatedTarget as Node | null))
                setMessageMenuOpen(false);
        }} onKeyDown={event => {
            if (event.key === 'Escape') {
                setMessageMenuOpen(false);
                return;
            }
            if (!messageMenuOpen || (event.key !== 'ArrowDown' && event.key !== 'ArrowUp'))
                return;
            const options = [...messageMenuRef.current?.querySelectorAll<HTMLButtonElement>('[role="option"]') ?? []];
            if (options.length === 0)
                return;
            event.preventDefault();
            const current = options.indexOf(document.activeElement as HTMLButtonElement);
            const next = event.key === 'ArrowDown'
                ? (current + 1) % options.length
                : (current - 1 + options.length) % options.length;
            options[next]?.focus();
        }}>
                      <button type="button" className="charter-messageproposal__trigger" aria-label={t('message.pick')} aria-haspopup="listbox" aria-expanded={messageMenuOpen} disabled={messageCandidates.length === 0 || saving || unknownBlocked} onClick={() => setMessageMenuOpen(open => !open)}>
                        <span>
                          {selectedMessage === undefined
            ? t('message.pickPlaceholder')
            : `#${selectedMessage.seq} · ${shortText(selectedMessage.excerpt, 72)}`}
                        </span>
                        <span aria-hidden="true" className="charter-messageproposal__chevron">⌄</span>
                      </button>
                      {messageMenuOpen && (<div ref={messageMenuRef} className="charter-messageproposal__menu" role="listbox" aria-label={t('message.pick')}>
                          {messageCandidates.map(candidate => (<button key={candidate.seq} type="button" role="option" aria-selected={candidate.seq === messageSeq} className={`charter-messageproposal__option${candidate.seq === messageSeq ? ' is-selected' : ''}`} title={candidate.excerpt} onClick={() => {
                    setMessageSeq(candidate.seq);
                    setMessageDraft(candidate.text ?? '');
                    setMessageMenuOpen(false);
                }}>
                              <span className="charter-messageproposal__optionseq">#{candidate.seq}</span>
                              <span className="charter-messageproposal__optiontext">{candidate.excerpt}</span>
                            </button>))}
                        </div>)}
                    </div>
                  </div>
                  <label className="charter-messageproposal__field">
                    <span className="charter-fieldlabel">{t('message.textLabel')}</span>
                    <textarea aria-label={t('message.textLabel')} className="charter-messageproposal__textarea" disabled={messageSeq !== undefined && !messageTextAvailable} value={messageDraft} onChange={event => setMessageDraft(event.target.value)}/>
                    <span className="charter-hint">
                      {messageSeq !== undefined && !messageTextAvailable
            ? t('message.legacyUnavailable')
            : selectedMessage?.truncated === true
                ? t('message.truncated')
                : t('message.textHint')}
                    </span>
                  </label>
                  <div className="charter-messageproposal__field">
                    <span className="charter-fieldlabel">{t('message.kind')}</span>
                    <div className="charter-messageproposal__kind" role="group" aria-label={t('message.kind')}>
                      <button type="button" className={`charter-messageproposal__choice${messageKind === 'invariant' ? ' is-active' : ''}`} aria-pressed={messageKind === 'invariant'} onClick={() => setMessageKind('invariant')}>
                        {t('invariants.kicker')}
                      </button>
                      <button type="button" className={`charter-messageproposal__choice${messageKind === 'deliverable' ? ' is-active' : ''}`} aria-pressed={messageKind === 'deliverable'} onClick={() => setMessageKind('deliverable')}>
                        {t('deliverables.kicker')}
                      </button>
                    </div>
                  </div>
                  <div className="charter-messageproposal__actions">
                    <span className={`charter-budget${messageOverBudget ? ' is-over' : ''}`}>
                      {messageOverBudget
            ? t('budget.itemOver', { limit: formatBytes(t, view.limits.maxItemBytes) })
            : `${formatBytes(t, messageBytes)} / ${formatBytes(t, view.limits.maxItemBytes)}`}
                    </span>
                    <ActionButton variant="outline" disabled={saving || unknownBlocked || !messageCanSave} onClick={() => {
            if (!messageCanSave || messageSeq === undefined)
                return;
            void draft.proposeLatestMessage({
                seq: messageSeq,
                kind: messageKind,
                text: messageDraft.trim(),
            });
        }}>
                      {t('review.saveLatestMessage')}
                    </ActionButton>
                  </div>
                </div>
              </section>)}

    {area === 'review' && inactiveItems.length > 0 && (<section className="charter-card charter-section" aria-labelledby="charter-inactive-title" style={{ order: PAGE_ORDER.review.inactive }}>
                <div className="charter-cardhead">
                  <div className="charter-cardtitle">
                    <h3 id="charter-inactive-title">{t('review.inactiveItems')}</h3>
                  </div>
                  <span className="charter-count">{inactiveItems.length}</span>
                </div>
                <ul className="charter-timeline">
                  {inactiveItems.slice(0, reviewLimit).map(item => (<li key={item.id} className="charter-timeline__row">
                      <span className="charter-timeline__kind">{item.kind === 'invariant' ? t('invariants.kicker') : t('deliverables.kicker')}</span>
                      <span className="charter-timeline__text">{item.text}</span>
                      <span className="charter-timeline__state">
                        {item.review === 'rejected' ? t('review.rejected') : t(`review.lifecycle.${item.lifecycle}`)}
                      </span>
                      {(item.supersedes !== undefined || item.supersededBy !== undefined) && (<span className="charter-timeline__lineage">{t('review.lineage')}</span>)}
                    </li>))}
                </ul>
              </section>)}

    {area === 'review' && closedObjectiveProposals.length > 0 && (<section className="charter-card charter-section" aria-labelledby="charter-objective-history-title" style={{ order: PAGE_ORDER.review.objectiveHistory }}>
                <div className="charter-cardhead">
                  <div className="charter-cardtitle">
                    <h3 id="charter-objective-history-title">{t('review.objectiveHistory')}</h3>
                  </div>
                  <span className="charter-count">{closedObjectiveProposals.length}</span>
                </div>
                <ul className="charter-timeline">
                  {closedObjectiveProposals.slice(0, reviewLimit).map(proposal => (<li key={proposal.id} className="charter-timeline__row">
                      <span className="charter-timeline__kind">{t('objective.kicker')}</span>
                      <span className="charter-timeline__text">{proposal.text === '' ? proposal.textDigest ?? '' : proposal.text}</span>
                      <span className="charter-timeline__state">{t(`review.proposal.${proposal.review}`)}</span>
                      <span className="charter-timeline__lineage">
                        {t('review.proposalRevision', {
                revision: proposal.appliedRevision ?? proposal.reviewedAtRevision ?? proposal.createdRevision,
            })}
                      </span>
                    </li>))}
                </ul>
              </section>)}

    {area === 'review' && pendingItemProposals.length > 0 && (<section className="charter-card charter-section" aria-labelledby="charter-item-proposals-title" style={{ order: PAGE_ORDER.review.itemProposals }}>
                <div className="charter-cardhead">
                  <div className="charter-cardtitle">
                    <h3 id="charter-item-proposals-title">{t('review.itemProposals')}</h3>
                  </div>
                  <span className="charter-count">{pendingItemProposals.length}</span>
                </div>
                <ul className="charter-proposal-list">
                  {pendingItemProposals.slice(0, reviewLimit).map(item => {
            const batch = batchByItem.get(item.id);
            return (<li key={item.id} className="charter-proposal" data-proposal-id={item.id} tabIndex={-1}>
                        <p className="charter-proposal__text">{item.text}</p>
                        <span className="charter-proposal__meta">
                          {item.kind === 'invariant' ? t('invariants.kicker') : t('deliverables.kicker')}
                          {batch === undefined ? '' : ` · ${t(`review.source.${batch.sourceKind}` as never)}`}
                          {item.contentModified === true ? ` · ${t('review.contentModified')}` : ''}
                        </span>
                        <div className="charter-proposal__actions">
                          <ActionButton variant="outline" disabled={saving || unknownBlocked} onClick={() => draft.stage(view, { type: 'item.accept', itemId: item.id })}>
                            {t('item.accept')}
                          </ActionButton>
                          <ActionButton variant="outline" disabled={saving || unknownBlocked} onClick={() => draft.stage(view, { type: 'item.reject', itemId: item.id })}>
                            {t('item.reject')}
                          </ActionButton>
                        </div>
                      </li>);
        })}
                </ul>
              </section>)}

    {area === 'review' && pendingObjectiveProposals.length > 0 && (<section className="charter-card charter-section" aria-labelledby="charter-objective-proposals-title" style={{ order: PAGE_ORDER.review.objectiveProposals }}>
                <div className="charter-cardhead">
                  <div className="charter-cardtitle">
                    <h3 id="charter-objective-proposals-title">{t('review.objectiveProposals')}</h3>
                  </div>
                  <span className="charter-count">{pendingObjectiveProposals.length}</span>
                </div>
                <ul className="charter-proposal-list">
                  {pendingObjectiveProposals.slice(0, reviewLimit).map(proposal => {
            const reason = proposalReasons[proposal.id] ?? '';
            const needsReason = view.objective !== null;
            return (<li key={proposal.id} className="charter-proposal">
                        <p className="charter-proposal__text">{proposal.text}</p>
                        <span className="charter-proposal__meta">
                          {t('review.proposalRevision', { revision: proposal.createdRevision })}
                        </span>
                        {needsReason && (<input className="charter-proposal__reason" value={reason} placeholder={t('review.objectiveReason')} aria-label={t('review.objectiveReason')} onChange={event => setProposalReasons(previous => ({
                        ...previous,
                        [proposal.id]: event.target.value,
                    }))}/>)}
                        <div className="charter-proposal__actions">
                          <ActionButton variant="outline" disabled={saving || unknownBlocked || (needsReason && reason.trim().length === 0)} onClick={() => draft.stage(view, {
                    type: 'objective.accept',
                    proposalId: proposal.id,
                    ...(needsReason ? { reason } : {}),
                })}>
                            {t('review.acceptObjective')}
                          </ActionButton>
                          <ActionButton variant="outline" disabled={saving || unknownBlocked} onClick={() => draft.stage(view, { type: 'objective.reject', proposalId: proposal.id })}>
                            {t('review.rejectObjective')}
                          </ActionButton>
                        </div>
                      </li>);
        })}
                </ul>
              </section>)}

    {area === 'review' && (view.proposalBatches?.length ?? 0) > 0 && (<section className="charter-card charter-section" aria-labelledby="charter-batches-title" style={{ order: PAGE_ORDER.review.batches }}>
                <div className="charter-cardhead">
                  <div className="charter-cardtitle">
                    <h3 id="charter-batches-title">{t('review.title')}</h3>
                  </div>
                  <span className="charter-count">{view.proposalBatches!.length}</span>
                </div>
                <ol className="charter-batch-list">
                  {view.proposalBatches!.slice().reverse().slice(0, reviewLimit).map(batch => {
            const pending = batch.candidates.filter(candidate => candidate.kind === 'item'
                && view.items.some(item => item.id === candidate.id && item.review === 'pending')).length;
            return (<li key={batch.id} className="charter-batch">
                        <span className="charter-batch__source">{t(`review.source.${batch.source.kind}`)}</span>
                        <span className="charter-batch__revision">{t('review.captured', { revision: batch.capturedAtRevision })}</span>
                        <span className="charter-batch__count">{t('review.pendingCandidates', { count: pending })}</span>
                        {batch.sourceIntegrity !== undefined && batch.sourceIntegrity !== 'not-applicable' && (<span className="charter-batch__count">
                            {t('review.sourceIntegrity', { integrity: batch.sourceIntegrity })}
                          </span>)}
                      </li>);
        })}
                </ol>
              </section>)}

    {area === 'review' && (<>
                {bootstrapPhase === 'checking' && (<div className="charter-notice">
                    <span role="status">{t('bootstrap.loading')}</span>
                  </div>)}
                {bootstrapPhase === 'failed' && (<div className="charter-notice charter-notice--danger">
                    <span role="alert">
                      {bootstrapProblemText(bootstrapProblem, t) ?? t('bootstrap.requestFailed')}
                    </span>
                    <ErrorDetails detail={bootstrapProblem?.detail} t={t}/>
                    <ActionButton onClick={() => draft.retryBootstrap(view)}>{t('button.retry')}</ActionButton>
                  </div>)}
                {bootstrapPhase === 'unavailable' && (<div className="charter-notice">
                    <span role="status">
                      {bootstrapProblemText(bootstrapProblem, t) ?? t('bootstrap.unavailable')}
                    </span>
                    <ErrorDetails detail={bootstrapProblem?.detail} t={t}/>
                    <ActionButton onClick={() => draft.retryBootstrap(view)}>{t('button.retry')}</ActionButton>
                  </div>)}
                {(bootstrapPhase === 'no-summary' || bootstrapPhase === 'not-live' || bootstrapPhase === 'idle') && (<div className="charter-notice">
                    <span role="status">
                      {bootstrapPhase === 'no-summary'
                ? t('bootstrap.noSummary')
                : bootstrapPhase === 'not-live' ? t('bootstrap.notLive') : t('bootstrap.idle')}
                    </span>
                    <ActionButton onClick={() => draft.retryBootstrap(view)}>{t('bootstrap.checkAgain')}</ActionButton>
                  </div>)}
                {bootstrapPhase === 'dismissed' && (<div className="charter-notice">
                    <span role="status">{t('bootstrap.dismissed')}</span>
                    <ActionButton onClick={() => draft.retryBootstrap(view)}>{t('bootstrap.checkAgain')}</ActionButton>
                  </div>)}
                {ops.length > 0 && (<div className="charter-notice charter-notice--warning">
                    <span role="status">{t('bootstrap.blocked')}</span>
                  </div>)}
                {bootstrap !== null && ops.length === 0 && editor !== null && (<div className="charter-notice charter-notice--warning">
                    <span role="alert">{t('bootstrap.blockedEditor')}</span>
                    <ActionButton onClick={() => draft.closeEditor()}>{t('editor.cancel')}</ActionButton>
                  </div>)}
                {bootstrap !== null && ops.length === 0 && editor === null && (<section className="charter-card charter-bootstrap" aria-labelledby="charter-bootstrap-title" style={{ order: PAGE_ORDER.review.bootstrap }}>
                    <div className="charter-cardhead">
                      <div className="charter-cardtitle">
                        <span className="charter-kicker">{t('bootstrap.kicker')}</span>
                        <h3 id="charter-bootstrap-title">{t('bootstrap.title')}</h3>
                      </div>
                      <span className={`charter-budget${bootstrapBudgetOver ? ' is-over' : ''}`}>
                        {t('bootstrap.budget', {
                used: formatBytes(t, bootstrapPromptBytes),
                limit: formatBytes(t, view.limits.maxPromptBytes),
            })}
                      </span>
                    </div>
                    <p className="charter-copy">{t('bootstrap.body')}</p>
                    <span className="charter-source">
                      {bootstrap.source.shadowedTokens === undefined
                ? t('bootstrap.sourcePlain')
                : t('bootstrap.source', { tokens: bootstrap.source.shadowedTokens })}
                    </span>
                    <div className="charter-bootstrap__summary">
                      <StatusTag tone="info">{t('bootstrap.summary', { active: bootstrapPlan.active, pending: bootstrapPlan.pending })}</StatusTag>
                      <span role="status">
                        {t('bootstrap.reviewCounts', {
                total: bootstrapItems.length,
                visible: Math.min(bootstrapItems.length, bootstrapVisibleCount),
                selected: bootstrapItems.filter(item => item.selected).length,
            })}
                      </span>
                      <ActionButton disabled={bootstrapSaving || unknownBlocked} onClick={() => draft.setVisibleBootstrapSelected(true)}>
                        {t('bootstrap.selectShown', { count: Math.min(bootstrapItems.length, bootstrapVisibleCount) })}
                      </ActionButton>
                      <ActionButton disabled={bootstrapSaving || unknownBlocked} onClick={() => draft.setVisibleBootstrapSelected(false)}>
                        {t('bootstrap.clearShown')}
                      </ActionButton>
                    </div>
                    {view.objective === null && (<label className="charter-bootstrap__field">
                        <span>{t('bootstrap.objective')}</span>
                        <textarea id={`${bootstrapId}-objective`} value={bootstrapObjective} rows={2} disabled={bootstrapSaving || unknownBlocked} aria-label={t('bootstrap.objective')} aria-invalid={bootstrapObjectiveOver || inspectUserText(bootstrapObjective).issue !== undefined} aria-describedby={`${bootstrapId}-objective-budget`} onChange={event => draft.setBootstrapObjective(event.target.value)}/>
                        <span id={`${bootstrapId}-objective-budget`} className={`charter-budget${bootstrapObjectiveOver ? ' is-over' : ''}`}>
                          {bootstrapObjectiveOver
                    ? t('budget.objectiveOver', { limit: formatBytes(t, view.limits.maxObjectiveBytes) })
                    : `${formatBytes(t, normalizedBytes(bootstrapObjective))} / ${formatBytes(t, view.limits.maxObjectiveBytes)}`}
                        </span>
                      </label>)}
                    {(() => {
                const ordered = [
                    ...bootstrapItems.filter(item => item.kind === 'invariant').map(item => ({ item, kind: 'invariant' as const })),
                    ...bootstrapItems.filter(item => item.kind === 'deliverable').map(item => ({ item, kind: 'deliverable' as const })),
                ];
                const visible = ordered.slice(0, bootstrapVisibleCount);
                const groups = [
                    { kind: 'invariant' as const, label: t('bootstrap.groupInvariants'), items: visible.filter(entry => entry.kind === 'invariant') },
                    { kind: 'deliverable' as const, label: t('bootstrap.groupDeliverables'), items: visible.filter(entry => entry.kind === 'deliverable') },
                ];
                return (<>
                          {groups.map(group => group.items.length === 0 ? null : (<div className="charter-bootstrap__group" key={group.kind}>
                              <h4>{group.label} ({group.items.length})</h4>
                              {group.items.map(({ item }) => {
                            const index = ordered.findIndex(entry => entry.item.id === item.id);
                            const bytes = normalizedBytes(item.text);
                            const outcome = bootstrapPlan.outcomes[item.id];
                            const checkboxId = `${bootstrapId}-include-${item.id}`;
                            const textId = `${bootstrapId}-text-${item.id}`;
                            return (<div className="charter-bootstrap__item" key={item.id}>
                                    <input id={checkboxId} type="checkbox" checked={item.selected} disabled={bootstrapSaving || unknownBlocked} aria-label={t('bootstrap.includeAria', { index: index + 1 })} onChange={event => draft.updateBootstrapItem(item.id, { selected: event.target.checked })}/>
                                    <label className="charter-bootstrap__checklabel" htmlFor={checkboxId}>{t('bootstrap.selected')}</label>
                                    <div className="charter-draftfield">
                                      <label className="charter-bootstrap__textlabel" htmlFor={textId}>{t('bootstrap.editAria', { index: index + 1 })}</label>
                                      <textarea id={textId} value={item.text} rows={2} disabled={bootstrapSaving || unknownBlocked} aria-invalid={item.text.trim().length === 0 || normalizedBytes(item.text) > view.limits.maxItemBytes || inspectUserText(item.text).issue !== undefined} aria-describedby={`${textId}-meta`} onChange={event => draft.updateBootstrapItem(item.id, { text: event.target.value })}/>
                                      <span className="charter-draftfield__meta" id={`${textId}-meta`}>
                                        {outcome !== undefined && (<StatusTag tone={outcome === 'active' ? 'success' : 'warning'}>
                                            {outcome === 'active' ? t('bootstrap.outcomeActive') : t('bootstrap.outcomePending')}
                                          </StatusTag>)}
                                        <span className={`charter-budget${bytes > view.limits.maxItemBytes ? ' is-over' : ''}`}>
                                          {bytes > view.limits.maxItemBytes
                                    ? t('bootstrap.itemOver', { limit: formatBytes(t, view.limits.maxItemBytes) })
                                    : `${formatBytes(t, bytes)} / ${formatBytes(t, view.limits.maxItemBytes)}`}
                                        </span>
                                      </span>
                                    </div>
                                  </div>);
                        })}
                            </div>))}
                          {ordered.length > visible.length && (<ActionButton disabled={bootstrapSaving || unknownBlocked} onClick={() => draft.showMoreBootstrapCandidates(40)}>
                              {t('bootstrap.showMore', { count: Math.min(40, ordered.length - visible.length) })}
                            </ActionButton>)}
                        </>);
            })()}
                    {bootstrapTextIssue !== undefined && (<div className="charter-notice charter-notice--danger" role="alert">
                        {textIssueMessage(bootstrapTextIssue.issue, t)}
                        {bootstrapTextIssue.where === 'candidate'
                    ? ` (${t('bootstrap.editAria', { index: (bootstrapTextIssue.index ?? 0) + 1 })})`
                    : ''}
                      </div>)}
                    {bootstrapBudgetOver && (<div className="charter-notice charter-notice--danger" role="alert">
                        {t('bootstrap.overBudget', { limit: formatBytes(t, view.limits.maxPromptBytes) })}
                      </div>)}
                    {bootstrapPlan.pending > 0 && (<div className="charter-notice charter-notice--warning" role="note">
                        {bootstrapPlan.pending === 1
                    ? t('bootstrap.pendingOne')
                    : t('bootstrap.pendingOther', { count: bootstrapPlan.pending })}
                      </div>)}
                    {bootstrapStorageOver && (<div className="charter-notice charter-notice--danger" role="alert">
                        {t('bootstrap.overItems')}
                      </div>)}
                    {bootstrapProblem !== null && bootstrapProblem.kind === 'save-failed' && (<div className="charter-notice charter-notice--warning" role="alert">
                        {bootstrapProblemText(bootstrapProblem, t)}
                      </div>)}
                    <div className="charter-bootstrap__actions">
                      <ActionButton variant="primary" className="charter-actionbar__primary" disabled={bootstrapReplay ? bootstrapSaving : !canApplyBootstrap} ariaDescribedBy={applyHintId} onClick={applyBootstrapDraft} busy={bootstrapSaving}>
                        {bootstrapSaving
                ? t('footer.applying')
                : bootstrapReplay ? t('footer.retryApply') : t('bootstrap.apply')}
                      </ActionButton>
                      <ActionButton disabled={bootstrapSaving || unknownBlocked} onClick={() => draft.dismissBootstrap()}>
                        {t('bootstrap.discard')}
                      </ActionButton>
                      {unknownReplay && (<ActionButton variant="outline" onClick={abandonUnknown}>
                          {confirmAbandon ? t('footer.abandonConfirm') : t('footer.abandon')}
                        </ActionButton>)}
                    </div>
                  </section>)}
              </>)}

    {area === 'review' && ((pendingItemProposals.length > reviewLimit
        || inactiveItems.length > reviewLimit
        || closedObjectiveProposals.length > reviewLimit
        || pendingObjectiveProposals.length > reviewLimit
        || (view.proposalBatches?.length ?? 0) > reviewLimit)
        ? (<div className="charter-recovery__actions">
                      <ActionButton variant="outline" onClick={() => setReviewLimit(current => current + 50)}>
                        {t('history.showMore', { count: 50 })}
                      </ActionButton>
                    </div>)
        : null)}
    </>
  )
}
