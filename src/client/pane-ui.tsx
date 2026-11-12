// Shared presentational controls for the Charter Pane and its page components.
import type { ReactNode, KeyboardEvent } from 'react'
import { useId } from 'react'
import type { CharterText } from './pane-format.js'
import { formatBytes, itemState, normalizedBytes, normalizedNonEmpty } from './pane-format.js'

export function ErrorDetails({ detail, t }: {
    readonly detail: string | undefined;
    readonly t: CharterText;
}): ReactNode {
    if (detail === undefined || detail.trim().length === 0)
        return null;
    return (<details className="charter-error-details">
      <summary>{t('error.details')}</summary>
      <pre>{detail}</pre>
    </details>);
}

export function ActionButton({ children, onClick, disabled = false, variant = 'ghost', ariaLabel, ariaDescribedBy, title, busy, className, }: {
    readonly children: ReactNode;
    readonly onClick?: () => void;
    readonly disabled?: boolean;
    readonly variant?: 'primary' | 'outline' | 'ghost';
    readonly ariaLabel?: string;
    readonly ariaDescribedBy?: string;
    readonly title?: string;
    readonly busy?: boolean;
    readonly className?: string;
}) {
    return (<button type="button" className={`charter-button charter-button--${variant}${className === undefined ? '' : ` ${className}`}`} onClick={onClick} disabled={disabled} aria-label={ariaLabel} aria-describedby={ariaDescribedBy} title={title} aria-busy={busy === true ? true : undefined}>
      {children}
    </button>);
}

export function StateMark({ state }: {
    readonly state: ReturnType<typeof itemState> | 'error';
}) {
    return <span className={`charter-state-mark charter-state-mark--${state}`} aria-hidden="true"/>;
}

export function StatusTag({ children, tone = 'quiet', title, }: {
    readonly children: ReactNode;
    readonly tone?: 'quiet' | 'info' | 'success' | 'warning' | 'danger';
    readonly title?: string;
}) {
    return <span className={`charter-tag charter-tag--${tone}`} title={title}>{children}</span>;
}

export function TextEditor({ value, onChange, reason, onReasonChange, showReason, onSave, onCancel, maxBytes, previousBytes, label, t, }: {
    readonly value: string;
    readonly onChange: (value: string) => void;
    readonly reason?: string;
    readonly onReasonChange?: (value: string) => void;
    readonly showReason?: boolean;
    readonly onSave: () => void;
    readonly onCancel: () => void;
    readonly maxBytes: number;
    readonly previousBytes?: number | undefined;
    readonly label?: string | undefined;
    readonly t: CharterText;
}) {
    const budgetId = useId();
    const bytes = normalizedBytes(value);
    const shrinking = previousBytes !== undefined && bytes < previousBytes;
    const over = bytes > maxBytes && !shrinking;
    const overButShrinking = bytes > maxBytes && shrinking;
    const save = (): void => {
        if (!over && normalizedNonEmpty(value))
            onSave();
    };
    const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>): void => {
        if (event.key === 'Escape')
            onCancel();
        if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
            event.preventDefault();
            save();
        }
    };
    const onReasonKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
        if (event.key === 'Escape')
            onCancel();
        if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
            event.preventDefault();
            save();
        }
    };
    return (<>
      <textarea autoFocus className="charter-editor__input" value={value} aria-label={label ?? t('editor.charterTextAria')} aria-invalid={over} aria-describedby={budgetId} onChange={event => onChange(event.target.value)} onKeyDown={onKeyDown}/>
      {showReason === true && (<label className="charter-editor__reasonfield">
          <span>{t('editor.reasonLabel')}</span>
          <input className="charter-editor__reason" value={reason ?? ''} placeholder={t('editor.reasonPlaceholder')} aria-label={t('editor.reasonLabel')} onChange={event => onReasonChange?.(event.target.value)} onKeyDown={onReasonKeyDown}/>
        </label>)}
      <div className="charter-editor__actions">
        <span id={budgetId} className={over ? 'charter-budget is-over' : 'charter-budget'}>
          {overButShrinking
            ? t('budget.shrinking')
            : over
                ? t('budget.editorOver', { limit: formatBytes(t, maxBytes) })
                : `${formatBytes(t, bytes)} / ${formatBytes(t, maxBytes)}`}
        </span>
        <ActionButton variant="outline" disabled={over || !normalizedNonEmpty(value)} onClick={save}>
          {t('editor.stage')}
        </ActionButton>
        <ActionButton onClick={onCancel}>{t('editor.cancel')}</ActionButton>
      </div>
      <span className="charter-editor__hint">{t('editor.hint')}</span>
    </>);
}
