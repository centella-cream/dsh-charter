import { useEffect, useRef, useState } from 'react'

export interface ChangeSetSheetController {
  readonly open: boolean
  readonly setOpen: (open: boolean) => void
  readonly close: () => void
  readonly triggerRef: React.MutableRefObject<HTMLButtonElement | null>
  readonly sheetRef: React.MutableRefObject<HTMLElement | null>
}

/**
 * Narrow-container Change Set sheet controller: state, opener/sheet refs,
 * Escape/Tab handling, and opener focus restore. Extracted from the Pane so a
 * future page split can reuse the same modal behavior.
 */
export function useChangeSetSheet(): ChangeSetSheetController {
  const [open, setOpen] = useState(false)
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const sheetRef = useRef<HTMLElement | null>(null)

  useEffect(() => {
    if (!open) return
    if (typeof document === 'undefined') return
    const sheet = sheetRef.current
    const opener = triggerRef.current ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null)
    sheet?.focus()
    const onKeyDown = (event: Event): void => {
      const { key, shiftKey } = event as unknown as { key: string; shiftKey: boolean }
      if (key === 'Escape') {
        event.preventDefault()
        setOpen(false)
        return
      }
      if (key !== 'Tab' || sheet === null) return
      const focusables = [...sheet.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      )]
      if (focusables.length === 0) {
        event.preventDefault()
        sheet.focus()
        return
      }
      const first = focusables[0]
      const last = focusables[focusables.length - 1]
      if (first === undefined || last === undefined) {
        event.preventDefault()
        sheet.focus()
        return
      }
      if (shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      opener?.focus()
    }
  }, [open])

  return {
    open,
    setOpen,
    close: () => setOpen(false),
    triggerRef,
    sheetRef,
  }
}
