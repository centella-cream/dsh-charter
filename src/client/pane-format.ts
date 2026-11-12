// Pure formatting/derivation helpers for the Charter Pane and its page components.
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { CharterErrorCode } from '../core/errors.js'
import type { CharterRecordArchive, DeliverableProgress } from '../core/schemas.js'
import type { CharterView } from '../host/types.js'
import type { BootstrapProblem, DraftFeedback } from './draft-store.js'
import type { DependencyConflictDiff } from '../core/dependencies.js'
import type { ProjectedItem } from './preview.js'
import { inspectUserText } from '../core/normalize.js'
import { utf8Bytes } from './preview.js'
import { CHARTER_LOCALE_NS, type CharterLocaleKey } from './locales.js'

export type CharterText = TranslateNS<typeof CHARTER_LOCALE_NS>

export interface ArchivePreview {
  readonly fileName: string
  readonly archive?: CharterRecordArchive
  readonly errorKey?: string
  readonly errorParams?: Readonly<Record<string, string>>
  readonly health?: 'healthy' | 'schema-invalid' | 'consistency-invalid' | 'lifecycle-mismatch'
  readonly revision?: number | null
  readonly lifecycle?: string | null
  readonly digest?: string
  readonly exportedAt?: number
  readonly sourceSession?: string
  readonly payloadDigestOk?: boolean
  readonly recordDigestOk?: boolean
}

export function formatBytes(t: CharterText, bytes: number): string {
    return bytes < 1024
        ? t('unit.bytes', { value: bytes })
        : t('unit.kib', { value: (bytes / 1024).toFixed(bytes < 10240 ? 1 : 0) });
}

/** Pretty-print the JSON body of the rendered prompt for reading; exact bytes remain available. */
export function formatCharterPreview(preview: string): string | null {
    const start = preview.indexOf('{');
    if (start < 0)
        return null;
    try {
        return preview.slice(0, start) + JSON.stringify(JSON.parse(preview.slice(start)), null, 2);
    }
    catch {
        return null;
    }
}

export function progressLabel(progress: DeliverableProgress | undefined, t: CharterText): string {
    return t(`progress.${progress ?? 'not-started'}`);
}

export function errorLabel(code: CharterErrorCode | string, t: CharterText): string {
    const key = `error.${code}`;
    const text = t(key as never);
    return text === key ? t('error.unexpected') : text;
}

export function textIssueMessage(issue: 'empty' | 'control' | 'surrogate', t: CharterText): string {
    if (issue === 'control')
        return t('editor.issue.control');
    if (issue === 'surrogate')
        return t('editor.issue.surrogate');
    return t('editor.issue.empty');
}

export function countLabel(t: CharterText, count: number, one: CharterLocaleKey, other: CharterLocaleKey): string {
    return t(count === 1 ? one : other, { count });
}

/** Resolve a stable feedback descriptor against the current locale. */
export function feedbackText(feedback: DraftFeedback | null, t: CharterText): string | null {
    if (feedback === null)
        return null;
    switch (feedback.kind) {
        case 'saved': return t('footer.saved', { revision: feedback.revision });
        case 'replayed': return t('footer.replayed');
        case 'bootstrapSaved':
            return t('footer.bootstrapSaved', {
                revision: feedback.revision,
                active: feedback.active,
                pending: feedback.pending,
            });
        case 'error': return errorLabel(feedback.code, t);
        case 'connection': return t('error.connection');
        case 'scope': return t('error.draftScope');
        case 'editorBudget': return t('budget.editorOver', { limit: formatBytes(t, feedback.limit) });
        case 'itemBudget': return t('budget.itemOver', { limit: formatBytes(t, feedback.limit) });
        case 'editorUnchanged':
            return feedback.target === 'objective' ? t('editor.unchangedObjective') : t('editor.unchangedItem');
        case 'editorInvalid': return textIssueMessage(feedback.issue, t);
        case 'discarded': return t('footer.discarded');
    }
}

export function feedbackDetail(feedback: DraftFeedback | null): string | undefined {
    return feedback?.kind === 'error' ? feedback.detail : undefined;
}

export function bootstrapProblemText(problem: BootstrapProblem | null, t: CharterText): string | null {
    if (problem === null)
        return null;
    switch (problem.kind) {
        case 'stale': return t('bootstrap.stale');
        case 'request-failed': return t('bootstrap.requestFailed');
        case 'unavailable': return t('bootstrap.unavailable');
        case 'save-failed':
            return problem.code === undefined ? t('bootstrap.saveFailed') : errorLabel(problem.code, t);
    }
}

/** One exhaustive switch over the Host-derived record state. */
export function statusMessage(view: CharterView, t: CharterText): string | null {
    if (view.status === 'ready')
        return null;
    const state = view.recordState;
    switch (state?.kind) {
        case 'absent-unconfirmed':
            return t('status.absent');
        case 'invalid':
            return state.reason === 'future-schema'
                ? t('status.futureSchema')
                : state.reason === 'schema' ? t('status.invalidSchema') : t('status.invalidConsistency');
        case 'lifecycle-mismatch':
            return t('status.lifecycle');
        case 'write-uncertain':
            return t('status.writeUncertain');
        case 'unknown':
            return state.reason === 'initializing'
                ? t('status.initializing')
                : state.reason === 'legacy-host' ? t('status.legacyHost') : t('status.storage');
        case 'healthy':
            return view.status === 'initializing' ? t('status.initializing') : t('status.unavailable');
        default:
            return view.status === 'initializing' ? t('status.initializing') : t('status.unavailable');
    }
}

export function itemState(item: ProjectedItem): 'done' | 'warning' | 'ongoing' | 'idle' {
    if (item.lifecycle === 'archived' || item.lifecycle === 'superseded')
        return 'idle';
    if (item.review === 'pending')
        return 'warning';
    if (item.kind === 'deliverable' && item.progress === 'done')
        return 'done';
    if (item.kind === 'deliverable' && item.progress === 'in-progress')
        return 'ongoing';
    return 'idle';
}

export const EMPTY_CONFLICT_DIFF: DependencyConflictDiff = { added: [], worsened: [] };

export function shortText(text: string, length = 48): string {
    const normalized = text.replace(/\s+/gu, ' ').trim();
    return normalized.length <= length ? normalized : `${normalized.slice(0, length)}...`;
}

/** Render the lifecycle fingerprint as a compact, stable date label for the UI. */
export function lifecycleLabel(value: string | null | undefined): string {
    if (!value)
        return '-';
    try {
        const parsed = JSON.parse(value) as {
            createdAt?: unknown;
        };
        if (typeof parsed.createdAt === 'number' && Number.isFinite(parsed.createdAt)) {
            const date = new Date(parsed.createdAt);
            if (!Number.isNaN(date.getTime()))
                return date.toISOString().slice(0, 10);
        }
    }
    catch {
        // Non-fingerprint legacy value: fall through to a short text label.
    }
    return shortText(value, 24);
}

/** Render an archive timestamp without ever throwing on hostile values. */
export function formatTimestamp(value: number | undefined): string {
    if (value === undefined || !Number.isFinite(value))
        return '-';
    try {
        const date = new Date(value);
        if (Number.isNaN(date.getTime()))
            return '-';
        return date.toISOString().slice(0, 19).replace('T', ' ');
    }
    catch {
        return '-';
    }
}

/** Localized health label for an archive preview. */
export function archiveHealthLabel(health: 'healthy' | 'schema-invalid' | 'consistency-invalid' | 'lifecycle-mismatch', t: CharterText): string {
    if (health === 'healthy')
        return t('recovery.healthy');
    if (health === 'lifecycle-mismatch')
        return t('recovery.mismatch');
    return t('recovery.invalid');
}

/** Byte budget of the value the Host will store (normalized, not raw input). */
export function normalizedBytes(value: string): number {
    return utf8Bytes(inspectUserText(value).value);
}

export function normalizedNonEmpty(value: string): boolean {
    return inspectUserText(value).value.length > 0;
}
