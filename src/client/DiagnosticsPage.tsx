import { useMemo, type ReactNode } from 'react'
import type { PaneScope } from './pane-scope.js'
import { ActionButton, ErrorDetails, StatusTag } from './pane-ui.js'
import { archiveHealthLabel, errorLabel, formatBytes, formatTimestamp, lifecycleLabel, shortText } from './pane-format.js'
import { PAGE_ORDER } from './page-order.js'
import { buildStandingEnvelope, STANDING_TOOL_MAX_BYTES, STANDING_TOOL_MAX_ITEMS } from '../core/standing-envelope.js'
import type { CharterItem } from '../core/schemas.js'

export function DiagnosticsPage({ scope }: { readonly scope: PaneScope }): ReactNode {
  const {
  abandonUnknown,
  activeArchiveKey,
  archiveCacheProblem,
  archiveEntries,
  archiveInputRef,
  archivePreview,
  archiveSource,
  area,
  bootstrapReplay,
  canExport,
  capabilities,
  chooseArchive,
  chooseCachedArchive,
  confirmAbandon,
  confirmRecovery,
  draft,
  draftOpen,
  draftState,
  errorText,
  exportArchive,
  exportProblem,
  exportableState,
  exporting,
  formattedPreview,
  initAdmission,
  initializeEmpty,
  integrityFeedback,
  maintenanceEnabled,
  maintenanceProblem,
  maintenanceReplay,
  ops,
  preview,
  previewBytes,
  previewMode,
  recordDigest,
  recordState,
  recoveryBusy,
  restoreAdmission,
  restoreArchive,
  restoreArchiveReady,
  restoreTarget,
  retainedArchive,
  setConfirmRecovery,
  setIntegrityFeedback,
  setPreviewMode,
  setValidatorExpectation,
  setValidatorFeedback,
  setValidatorItemId,
  setValidatorKind,
  setValidatorPath,
  setValidatorRunning,
  source,
  t,
  unknownBlocked,
  validatorExpectation,
  validatorFeedback,
  validatorItemId,
  validatorKind,
  validatorPath,
  validatorRunning,
  view,
  } = scope
  const standingEnvelope = useMemo(() => {
    try {
      return buildStandingEnvelope(
        view.items as unknown as CharterItem[],
        view.revision,
        view.objective?.current.text ?? null,
      )
    } catch {
      return null
    }
  }, [view])
  const envelopePercent = standingEnvelope === null
    ? 0
    : Math.min(999, Math.round((standingEnvelope.bytes / STANDING_TOOL_MAX_BYTES) * 100))
  const envelopeState = standingEnvelope === null
    ? null
    : standingEnvelope.bytes > STANDING_TOOL_MAX_BYTES
      ? 'over'
      : envelopePercent >= 80 ? 'near' : 'ok'
  return (
    <>
    {area === 'diagnostics' && (<>
                <section className="charter-card charter-section charter-envelope" aria-labelledby="charter-envelope-title">
                  <div className="charter-cardhead">
                    <div className="charter-cardtitle">
                      <h3 id="charter-envelope-title">{t('diagnostics.envelopeTitle')}</h3>
                    </div>
                  </div>
                  {standingEnvelope === null ? (
                    <p className="charter-hint">{t('diagnostics.envelopeUnavailable')}</p>
                  ) : (
                    <>
                      <p className="charter-hint">{t('diagnostics.envelopeHint')}</p>
                      <dl className="charter-envelope__facts">
                        <div><dt>{t('diagnostics.envelopeUsage')}</dt><dd>{formatBytes(t, standingEnvelope.bytes)} / {formatBytes(t, STANDING_TOOL_MAX_BYTES)}</dd></div>
                        <div><dt>{t('diagnostics.envelopePercent')}</dt><dd>{envelopePercent}%</dd></div>
                        <div><dt>{t('diagnostics.envelopeItems')}</dt><dd>{standingEnvelope.itemCount} / {STANDING_TOOL_MAX_ITEMS}</dd></div>
                        <div><dt>{t('diagnostics.envelopeDeliverables')}</dt><dd>{standingEnvelope.deliverableCount}</dd></div>
                        <div><dt>{t('diagnostics.envelopePromptCap')}</dt><dd>{formatBytes(t, view.limits.maxPromptBytes)}</dd></div>
                        <div><dt>{t('diagnostics.envelopeIdCost')}</dt><dd>{t('diagnostics.envelopeIdCostValue', { count: standingEnvelope.deliverableCount })}</dd></div>
                      </dl>
                      <p className={`charter-envelope__status is-${envelopeState}`} role="status">
                        {envelopeState === 'over'
                          ? t('diagnostics.envelopeOver')
                          : envelopeState === 'near' ? t('diagnostics.envelopeNear') : t('diagnostics.envelopeOk')}
                      </p>
                    </>
                  )}
                </section>
                {source.runValidators !== undefined && (<section className="charter-card charter-section charter-validator" aria-labelledby="charter-validator-title">
                    <div className="charter-cardhead">
                      <div className="charter-cardtitle">
                        <span className="charter-kicker">{t('diagnostics.kicker')}</span>
                        <h3 id="charter-validator-title">{t('validators.title')}</h3>
                      </div>
                    </div>
                    <p className="charter-hint">{t('validators.hint')}</p>
                    <div className="charter-validator__form">
                      <label className="charter-validator__field">
                        <span className="charter-fieldlabel">{t('validators.targetLabel')}</span>
                        <select aria-label={t('validators.itemAria')} value={validatorItemId} onChange={event => setValidatorItemId(event.target.value)}>
                          <option value="">{t('validators.pickItem')}</option>
                          {view.items
                .filter(item => item.review === 'accepted' && item.lifecycle === 'current')
                .map(item => (<option key={item.id} value={item.id} title={item.text}>
                                {item.kind === 'invariant' ? t('invariants.kicker') : t('deliverables.kicker')} · {shortText(item.text, 14)}
                              </option>))}
                        </select>
                        <span className="charter-hint">{t('validators.targetHint')}</span>
                      </label>
                      <div className="charter-validator__row">
                        <label className="charter-validator__field">
                          <span className="charter-fieldlabel">{t('validators.methodLabel')}</span>
                          <select aria-label={t('validators.kindAria')} value={validatorKind} onChange={event => setValidatorKind(event.target.value as typeof validatorKind)}>
                            <option value="workspace.path-exists">{t('validators.kind.path-exists')}</option>
                            <option value="workspace.file-digest">{t('validators.kind.file-digest')}</option>
                            <option value="workspace.file-contains">{t('validators.kind.file-contains')}</option>
                          </select>
                        </label>
                        <label className="charter-validator__field">
                          <span className="charter-fieldlabel">{t('validators.pathLabel')}</span>
                          <input aria-label={t('validators.pathAria')} placeholder={t('validators.pathPlaceholder')} value={validatorPath} onChange={event => setValidatorPath(event.target.value)}/>
                        </label>
                      </div>
                      {validatorKind !== 'workspace.path-exists' && (<label className="charter-validator__field">
                          <span className="charter-fieldlabel">{t('validators.expectationLabel')}</span>
                          <input aria-label={t('validators.expectationAria')} placeholder={validatorKind === 'workspace.file-digest' ? 'sha256:...' : t('validators.containsPlaceholder')} value={validatorExpectation} onChange={event => setValidatorExpectation(event.target.value)}/>
                        </label>)}
                      <div className="charter-validator__actions">
                        <ActionButton variant="outline" disabled={validatorRunning || validatorItemId === '' || validatorPath.trim() === ''} onClick={() => {
                void (async () => {
                    setValidatorRunning(true);
                    setValidatorFeedback(null);
                    try {
                        const result = await source.runValidators!([{
                                itemId: validatorItemId,
                                validator: {
                                    kind: validatorKind,
                                    path: validatorPath.trim(),
                                    ...(validatorKind === 'workspace.file-digest' ? { expectedDigest: validatorExpectation.trim() } : {}),
                                    ...(validatorKind === 'workspace.file-contains' ? { contains: validatorExpectation } : {}),
                                },
                            }]);
                        setValidatorFeedback(result.ok ? t('validators.done') : errorLabel(result.code, t));
                    }
                    catch {
                        setValidatorFeedback(t('validators.failed'));
                    }
                    finally {
                        setValidatorRunning(false);
                    }
                })();
            }}>
                          {t('validators.run')}
                        </ActionButton>
                      </div>
                    </div>
                    {validatorFeedback !== null && <p className="charter-hint" role="status">{validatorFeedback}</p>}
                  </section>)}
                {source.sourceIntegrity !== undefined && (<section className="charter-card charter-section" aria-labelledby="charter-integrity-title">
                    <div className="charter-cardhead">
                      <div className="charter-cardtitle">
                        <span className="charter-kicker">{t('diagnostics.kicker')}</span>
                        <h3 id="charter-integrity-title">{t('integrity.title')}</h3>
                      </div>
                    </div>
                    <p className="charter-hint">{t('integrity.hint')}</p>
                    <div className="charter-validator__actions">
                      <ActionButton variant="outline" onClick={() => {
                void (async () => {
                    try {
                        const result = await source.sourceIntegrity!();
                        if (result.ok) {
                            const changed = result.items.filter(item => item.integrity !== 'intact').length
                                + result.batches.filter(batch => batch.integrity !== 'intact' && batch.integrity !== 'not-applicable').length;
                            setIntegrityFeedback(t('integrity.summary', {
                                count: result.items.length + result.batches.length,
                                changed,
                            }) + (result.truncated === true ? ` ${t('integrity.truncated')}` : ''));
                        }
                        else {
                            setIntegrityFeedback(errorLabel(result.code, t));
                        }
                    }
                    catch {
                        setIntegrityFeedback(t('validators.failed'));
                    }
                })();
            }}>
                        {t('integrity.check')}
                      </ActionButton>
                    </div>
                    {integrityFeedback !== null && <p className="charter-hint" role="status">{integrityFeedback}</p>}
                  </section>)}
                <section id="charter-recovery" className="charter-card charter-recovery" aria-labelledby="charter-recovery-title">
                  <div className="charter-cardhead">
                    <div className="charter-cardtitle">
                      <span className="charter-kicker">{t('recovery.title')}</span>
                      <h3 id="charter-recovery-title">{t('recovery.recordTitle')}</h3>
                    </div>
                    <StatusTag tone={recordState?.kind === 'healthy' ? 'success' : 'warning'}>
                      {recordState?.kind === 'healthy'
            ? t('recovery.healthy')
            : recordState?.kind === 'absent-unconfirmed'
                ? t('recovery.absent')
                : recordState?.kind === 'invalid'
                    ? recordState.reason === 'future-schema'
                        ? t('recovery.futureSchema')
                        : t('recovery.invalid')
                    : recordState?.kind === 'lifecycle-mismatch'
                        ? t('recovery.mismatch')
                        : recordState?.kind === 'write-uncertain'
                            ? t('recovery.uncertain')
                            : t('recovery.unknown')}
                    </StatusTag>
                  </div>
                  <dl className="charter-recovery__facts">
                    <div>
                      <dt>{t('recovery.revision')}</dt>
                      <dd>{view.revision}</dd>
                    </div>
                    <div>
                      <dt>{t('recovery.lifecycle')}</dt>
                      <dd><code>{lifecycleLabel(view.lifecycle)}</code></dd>
                    </div>
                    <div>
                      <dt>{t('recovery.digest')}</dt>
                      <dd><code>{recordDigest === undefined ? '-' : shortText(recordDigest.replace('sha256:', ''), 20)}</code></dd>
                    </div>
                    {view.overBudget && <div><dt>{t('recovery.overBudget')}</dt><dd>!</dd></div>}
                  </dl>
                  <p className="charter-hint">{t('recovery.subtitle')}</p>
                </section>

                <section className="charter-card charter-recovery" aria-labelledby="charter-export-title">
                  <div className="charter-cardhead">
                    <div className="charter-cardtitle">
                      <span className="charter-kicker">{t('recovery.exportTitle')}</span>
                      <h3 id="charter-export-title">{t('recovery.export')}</h3>
                    </div>
                  </div>
                  <p className="charter-hint">{t('recovery.exportHint')}</p>
                  <div className="charter-notice charter-notice--warning" role="note">
                    <span>{t('recovery.sensitive')}</span>
                  </div>
                  <div className="charter-recovery__actions">
                    <ActionButton variant="primary" disabled={!canExport || recoveryBusy || exporting} onClick={exportArchive} busy={exporting}>
                      {t('recovery.export')}
                    </ActionButton>
                    {!maintenanceEnabled && (<span className="charter-hint" role="note">
                        {capabilities?.recordMaintenanceReason === 'record-limit'
                ? t('recovery.recordLimit')
                : t('recovery.capabilityUnavailable')}
                      </span>)}
                    {maintenanceEnabled && !exportableState && (<span className="charter-hint" role="note">{t('recovery.noRawRecord')}</span>)}
                  </div>
                  {exportProblem !== null && (<p className="charter-hint" role="alert">{exportProblem}</p>)}
                </section>

                <section className="charter-card charter-recovery" aria-labelledby="charter-restore-title">
                  <div className="charter-cardhead">
                    <div className="charter-cardtitle">
                      <span className="charter-kicker">{t('recovery.title')}</span>
                      <h3 id="charter-restore-title">{t('recovery.restoreTitle')}</h3>
                    </div>
                  </div>
                  {recordState?.kind === 'write-uncertain' && (<div className="charter-notice charter-notice--warning" role="alert">
                      <span>{t('recovery.writeUncertain')}</span>
                    </div>)}
                  {recordState?.kind === 'absent-unconfirmed' && (<div className="charter-notice" role="note">
                      <span>{t('recovery.absentHint')}</span>
                    </div>)}
                  {recordState?.kind === 'healthy' && (<p className="charter-hint">{t('recovery.replaceHint')}</p>)}
                  {maintenanceProblem !== null && (<div className="charter-recovery__problem">
                      <div className="charter-notice charter-notice--warning" role="alert">
                        <span>
                          {t('recovery.problem')}
                          {maintenanceProblem.code === undefined ? '' : ` (${errorText(String(maintenanceProblem.code))})`}
                        </span>
                        <ErrorDetails detail={maintenanceProblem.detail} t={t}/>
                      </div>
                      <ActionButton variant="outline" onClick={() => draft.dismissMaintenanceProblem()}>
                        {t('recovery.dismiss')}
                      </ActionButton>
                    </div>)}
                  {draftState.maintenanceSaving && (<div className="charter-notice" role="status">
                      <span>{t('recovery.inFlight')}</span>
                    </div>)}
                  {(maintenanceReplay || (unknownBlocked && (draftState.attempt?.kind === 'initialize' || draftState.attempt?.kind === 'restore'))) && (<div className="charter-recovery__problem">
                      <div className="charter-notice" role="status">
                        <span>{t('recovery.unknownOutcome')}</span>
                      </div>
                      {retainedArchive != null && (<dl className="charter-recovery__retained">
                          <div><dt>{t('recovery.sourceSession')}</dt><dd>{retainedArchive.source.sessionId}</dd></div>
                          <div><dt>{t('recovery.lifecycle')}</dt><dd>{retainedArchive.source.lifecycle}</dd></div>
                          <div><dt>{t('recovery.previewRevision')}</dt><dd>{retainedArchive.source.revision ?? '-'}</dd></div>
                          <div><dt>{t('recovery.previewDigest')}</dt><dd>{retainedArchive.source.recordDigest}</dd></div>
                          <div><dt>{t('recovery.payloadDigest')}</dt><dd>{retainedArchive.payloadDigest}</dd></div>
                        </dl>)}
                      <div className="charter-recovery__actions">
                        {maintenanceReplay && (<ActionButton variant="primary" onClick={() => void draft.retryMaintenance()}>
                            {t('recovery.retry')}
                          </ActionButton>)}
                        <ActionButton variant="outline" onClick={abandonUnknown}>
                          {confirmAbandon ? t('footer.abandonConfirm') : t('recovery.abandon')}
                        </ActionButton>
                      </div>
                    </div>)}
                  {maintenanceEnabled && (<>
                  <div className="charter-archivecache">
                    <div className="charter-archivecache__head">
                      <strong>{t('recovery.cacheTitle')}</strong>
                    </div>
                    {archiveCacheProblem !== null
                ? <p className="charter-archivecache__empty" role="alert">{archiveCacheProblem}</p>
                : archiveEntries.length === 0
                    ? <p className="charter-archivecache__empty">{t('recovery.cacheEmpty')}</p>
                    : (<ul className="charter-archivecache__list" aria-label={t('recovery.cacheAria')}>
                              {archiveEntries.map(entry => (<li key={entry.key}>
                                  <button type="button" aria-pressed={activeArchiveKey === entry.key} className={`charter-archivecache__item${activeArchiveKey === entry.key ? ' is-active' : ''}`} onClick={() => chooseCachedArchive(entry)}>
                                    <span className="charter-archivecache__revision">
                                      {t('recovery.cacheRevision', { revision: entry.revision })}
                                    </span>
                                    <span className="charter-archivecache__meta">
                                      {formatTimestamp(entry.archivedAt)} · {shortText(entry.recordDigest.replace('sha256:', ''), 16)}
                                    </span>
                                  </button>
                                </li>))}
                            </ul>)}
                  </div>
                  <p className="charter-hint">{t('recovery.cacheHint')}</p>
                  <details className="charter-recovery__import">
                    <summary>{t('recovery.importTitle')}</summary>
                    <p className="charter-hint">{t('recovery.importHint')}</p>
                    <label className="charter-recovery__file">
                      <input ref={archiveInputRef} aria-label={t('recovery.chooseFile')} type="file" accept="application/json,.json" disabled={recoveryBusy || unknownBlocked} onChange={event => {
                const file = event.currentTarget.files?.[0];
                if (file !== undefined)
                    chooseArchive(file);
            }}/>
                    </label>
                  </details>
                    </>)}
                  {archivePreview !== null && (<div className="charter-recovery__preview">
                      <strong>{t('recovery.previewTitle')}</strong>
                      <span>{t('recovery.selected')}: {archivePreview.fileName}</span>
                      {archivePreview.errorKey !== undefined
                ? <span role="alert">{t(archivePreview.errorKey as never, archivePreview.errorParams as never)}</span>
                : (<dl>
                            <div><dt>{t('recovery.previewHealth')}</dt><dd>{archivePreview.health === undefined ? '-' : archiveHealthLabel(archivePreview.health, t)}</dd></div>
                            <div><dt>{t('recovery.previewRevision')}</dt><dd>{archivePreview.revision ?? '-'}</dd></div>
                            <div><dt>{t('recovery.previewLifecycle')}</dt><dd><code>{lifecycleLabel(archivePreview.lifecycle)}</code></dd></div>
                            <div><dt>{t('recovery.previewDigest')}</dt><dd><code>{archivePreview.digest === undefined ? '-' : shortText(archivePreview.digest.replace('sha256:', ''), 20)}</code></dd></div>
                            <div><dt>{t('recovery.exportedAt')}</dt><dd>{formatTimestamp(archivePreview.exportedAt)}</dd></div>
                            <div><dt>{t('recovery.sourceSession')}</dt><dd><code>{shortText(archivePreview.sourceSession ?? '-', 24)}</code></dd></div>
                            <div><dt>{t('recovery.payloadDigest')}</dt><dd>{archivePreview.payloadDigestOk === true ? t('recovery.verified') : t('recovery.unverified')}</dd></div>
                          </dl>)}
                    </div>)}
                  {recordState?.kind === 'absent-unconfirmed' && (<div className="charter-recovery__danger">
                      <p className="charter-hint" role="note">{t('recovery.initializeWarning')}</p>
                      <ActionButton variant={confirmRecovery === 'initialize' ? 'primary' : 'outline'} disabled={!maintenanceEnabled || recoveryBusy || !initAdmission.ok} onClick={initializeEmpty}>
                        {confirmRecovery === 'initialize' ? t('recovery.initializeConfirm') : t('recovery.initialize')}
                      </ActionButton>
                      {confirmRecovery === 'initialize' && (<ActionButton variant="outline" onClick={() => setConfirmRecovery(null)}>
                          {t('recovery.cancel')}
                        </ActionButton>)}
                      {!initAdmission.ok && (<span className="charter-hint" role="note">
                          {t(`recovery.reason.${initAdmission.reason}` as never)}
                        </span>)}
                    </div>)}
                  {restoreTarget && (<div className="charter-recovery__actions">
                      <ActionButton variant={confirmRecovery === 'restore' ? 'primary' : 'outline'} disabled={!maintenanceEnabled || recoveryBusy || !restoreAdmission.ok || !restoreArchiveReady} onClick={restoreArchive}>
                        {confirmRecovery === 'restore'
                ? t('recovery.restoreConfirm')
                : archiveSource === 'file'
                    ? t('recovery.restoreFile')
                    : t('recovery.restoreCached')}
                      </ActionButton>
                      {confirmRecovery === 'restore' && (<ActionButton variant="outline" onClick={() => setConfirmRecovery(null)}>
                          {t('recovery.cancel')}
                        </ActionButton>)}
                      <span className="charter-hint">
                        {archivePreview?.archive === undefined
                ? t('recovery.noPreview')
                : restoreArchiveReady
                    ? t('recovery.readyToRestore')
                    : t('recovery.diagnosticOnly')}
                      </span>
                      {!restoreAdmission.ok && (<span className="charter-hint" role="note">
                          {t(`recovery.reason.${restoreAdmission.reason}` as never)}
                        </span>)}
                    </div>)}
                </section>
              </>)}

    {area === 'diagnostics' && (<section id="charter-context-preview" className="charter-card charter-preview" style={{ order: PAGE_ORDER.diagnostics.contextPreview }}>
                <div className="charter-preview__meta">
                  <div className="charter-cardtitle">
                    <span className="charter-kicker">{t('preview.title')}</span>
                    <h3>{t('preview.subtitle')}</h3>
                  </div>
                  <StatusTag tone="info">{t('preview.bytesLabel', { bytes: formatBytes(t, previewBytes) })}</StatusTag>
                </div>
                {(draftOpen || bootstrapReplay) && ops.length === 0 && (<div className="charter-notice" role="note">{t('footer.draftStatus')}</div>)}
                <div className="charter-preview__toolbar" role="group" aria-label={t('preview.viewLabel')}>
                  <button type="button" className={`charter-preview__view${previewMode === 'formatted' ? ' is-active' : ''}`} aria-pressed={previewMode === 'formatted'} disabled={preview === '' || formattedPreview === null} onClick={() => setPreviewMode('formatted')}>
                    {t('preview.formatted')}
                  </button>
                  <button type="button" className={`charter-preview__view${previewMode === 'exact' ? ' is-active' : ''}`} aria-pressed={previewMode === 'exact'} onClick={() => setPreviewMode('exact')}>
                    {t('preview.exact')}
                  </button>
                  <span className="charter-hint">
                    {preview === ''
            ? t('preview.emptyHint')
            : previewMode === 'formatted'
                ? formattedPreview === null ? t('preview.formattedUnavailable') : t('preview.formattedHint')
                : t('preview.exactHint')}
                  </span>
                </div>
                <pre>{preview === ''
            ? t('preview.empty')
            : previewMode === 'formatted' && formattedPreview !== null
                ? formattedPreview
                : preview}</pre>
                <p className="charter-hint">{t('budget.recordLimit', { limit: formatBytes(t, view.limits.maxRecordBytes) })}</p>
              </section>)}
    </>
  )
}
