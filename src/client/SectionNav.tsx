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

/**
 * Pane section navigation (W5 page split). Kept presentational: the caller owns
 * routing and section state.
 */
export function SectionNav({ t, area, totalPending, onNavigate }: SectionNavProps): JSX.Element {
  const items = [
    { id: 'workspace' as const, target: 'overview' as const, label: t('nav.workspace'), help: t('nav.workspaceHelp') },
    { id: 'review' as const, target: 'history' as const, label: t('nav.review'), help: t('nav.reviewHelp'), badge: totalPending },
    { id: 'diagnostics' as const, target: 'context' as const, label: t('nav.diagnostics'), help: t('nav.diagnosticsHelp') },
  ]
  return (
    <nav className="charter-nav" aria-label={t('nav.label')}>
      {items.map(item => (
        <Fragment key={item.id}>
          <div className="charter-nav__row">
            <button
              type="button"
              className={`charter-nav__item${area === item.id ? ' is-active' : ''}`}
              aria-current={area === item.id ? 'page' : undefined}
              aria-describedby={`charter-nav-help-${item.id}`}
              onClick={() => onNavigate(item.target)}
            >
              <span className="charter-nav__text">{item.label}</span>
              {'badge' in item && item.badge !== undefined && <span className="charter-nav__badge">{item.badge}</span>}
            </button>
            <button
              type="button"
              className="charter-nav__help"
              aria-label={item.help}
              data-tooltip={item.help}
              title={item.help}
            />
          </div>
          <span id={`charter-nav-help-${item.id}`} className="charter-sr-only">{item.help}</span>
        </Fragment>
      ))}
    </nav>
  )
}
