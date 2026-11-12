import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { CharterOp } from '../core/schemas.js'
import {
  groupChangeSetOps,
  opCanBeUnstaged,
  opDiff,
  opText,
  type ChangeSetConflictRow,
  type ChangeSetDiffContext,
} from './change-set-model.js'
import { CHARTER_LOCALE_NS } from './locales.js'

type Translate = TranslateNS<typeof CHARTER_LOCALE_NS>

export interface ChangeSetPanelProps {
  readonly t: Translate
  readonly headingId: string
  /** Ops are rendered in draft order; each row can be unstaged independently. */
  readonly ops: readonly CharterOp[]
  readonly stagedOps: number
  readonly promptDelta: string
  readonly itemsDelta: string
  readonly editorOpen: boolean
  readonly conflicts: readonly ChangeSetConflictRow[]
  readonly diffContext: ChangeSetDiffContext
  readonly canUnstage: boolean
  readonly hint?: string
  readonly onUnstage: (op: CharterOp) => void
}

export function ChangeSetPanel({
  t,
  headingId,
  ops,
  stagedOps,
  promptDelta,
  itemsDelta,
  editorOpen,
  conflicts,
  diffContext,
  canUnstage,
  hint,
  onUnstage,
}: ChangeSetPanelProps): JSX.Element {
  return (
    <div className="charter-changeset">
      <div className="charter-cardhead">
        <div className="charter-cardtitle">
          <span className="charter-kicker">{t('changeset.kicker')}</span>
          <h3 id={headingId}>{t('changeset.title')}</h3>
        </div>
        <span className="charter-count">{stagedOps}</span>
      </div>
      <div className="charter-changeset__body">
        <span>{t('changeset.ops', { count: stagedOps })}</span>
        <span>{promptDelta}</span>
        <span>{itemsDelta}</span>
        {editorOpen && <span>{t('changeset.editorOpen')}</span>}
      </div>
      {ops.length > 0 && (
        <div className="charter-changeset__ops">
          {groupChangeSetOps(ops).map(group => (
            <section className="charter-changeset__group" key={group.category}>
              <h4 className="charter-changeset__grouphead">
                {t(`changeset.op.${group.category}` as never)}
              </h4>
              <ul>
                {group.ops.map((op, index) => {
                  const text = opText(op)
                  const diff = opDiff(op, diffContext)
                  return (
                    <li key={`${op.type}:${index}`} className="charter-changeset__op">
                      <span className="charter-changeset__optext">
                        {diff.before !== null || diff.after !== null || diff.afterLabel !== undefined
                          ? (
                              <>
                                {diff.before ?? '—'} <span aria-hidden="true">→</span>{' '}
                                {diff.after ?? (diff.afterLabel !== undefined
                                  ? t(diff.afterLabel.key as never, diff.afterLabel.params as never)
                                  : '—')}
                              </>
                            )
                          : text ?? t('changeset.op.unknown')}
                      </span>
                      {canUnstage && opCanBeUnstaged(op) && (
                        <button
                          type="button"
                          className="charter-button"
                          onClick={() => onUnstage(op)}
                        >
                          {t('changeset.unstage')}
                        </button>
                      )}
                    </li>
                  )
                })}
              </ul>
            </section>
          ))}
        </div>
      )}
      {conflicts.length > 0 && (
        <div className="charter-notice charter-notice--warning" role="status">
          <strong>{t('changeset.conflicts', { count: conflicts.length })}</strong>
          <ul className="charter-changeset__conflicts">
            {conflicts.map(conflict => (
              <li key={`${conflict.kind}:${conflict.key}`}>
                <span className="charter-dependency__key">{conflict.key}</span>
                <span className="charter-changeset__conflicttext">{conflict.text}</span>
                <span>
                  {t(conflict.kind === 'added' ? 'changeset.conflictAdded' : 'changeset.conflictWorsened', {
                    before: conflict.before,
                    after: conflict.after,
                  })}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {hint !== undefined && <p className="charter-hint">{hint}</p>}
    </div>
  )
}
