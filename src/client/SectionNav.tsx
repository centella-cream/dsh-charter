import { Fragment } from 'react'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { CharterSection } from './draft-store.js'
import { CHARTER_LOCALE_NS } from './locales.js'

type Translate = TranslateNS<typeof CHARTER_LOCALE_NS>
export type CharterArea = 'workspace' | 'review' | 'diagnostics'

export interface SectionNavProps {
  readonly t: Translate
  readonly area: CharterArea
  readonly totalPending: number
  readonly onNavigate: (section: CharterSection) => void
}

/** Underline tabs for the three real Pane routes. */
export function SectionNav({ t, area, totalPending, onNavigate }: SectionNavProps): JSX.Element {
  const items = [
    { id: 'workspace' as const, target: 'overview' as const, label: t('nav.workspace'), help: t('nav.workspaceHelp') },
    { id: 'review' as const, target: 'history' as const, label: t('nav.review'), help: t('nav.reviewHelp'), badge: totalPending },
    { id: 'diagnostics' as const, target: 'diagnostics' as const, label: t('nav.diagnostics'), help: t('nav.diagnosticsHelp') },
  ]
  return (
    <nav className="charter-tabs" aria-label={t('nav.label')}>
      {items.map(item => (
        <Fragment key={item.id}>
          <button
            type="button"
            className="charter-tabs__tab"
            aria-current={area === item.id ? 'page' : undefined}
            aria-describedby={`charter-tab-help-${item.id}`}
            onClick={() => onNavigate(item.target)}
          >
            <span>{item.label}</span>
            {'badge' in item && item.badge !== undefined && item.badge > 0 && (
              <span className="charter-tabs__count">{item.badge}</span>
            )}
          </button>
          <span id={`charter-tab-help-${item.id}`} className="charter-sr-only">{item.help}</span>
        </Fragment>
      ))}
    </nav>
  )
}
