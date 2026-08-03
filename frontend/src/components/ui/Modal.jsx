import { useEffect, useRef } from 'react'

const FOCUSABLE = 'a[href], button:not([disabled]), textarea, input, select, [tabindex]:not([tabindex="-1"])'

// Canonical modal — three different implementations existed before this
// (Tailwind-class backdrop-blur, inline-style no-blur, and a third with
// neither blur nor the same opacity). One backdrop, one entrance
// animation, one close-on-backdrop-click behavior.
//
// Also the only place Escape-to-close and a focus trap need to exist —
// previously a keyboard-only user had no way to dismiss any modal
// (add-preset, add-user, add-route, confirm dialogs) except tabbing to a
// close/cancel button, and focus was never moved into the dialog on open.
export default function Modal({ open, onClose, children, maxWidth = 'max-w-md' }) {
  const panelRef = useRef(null)

  useEffect(() => {
    if (!open) return

    const panel = panelRef.current
    const previouslyFocused = document.activeElement
    // Focus the first focusable element inside the dialog (falling back
    // to the panel itself) rather than leaving focus on whatever
    // triggered the modal, which is now hidden behind the backdrop.
    const first = panel?.querySelector(FOCUSABLE)
    ;(first || panel)?.focus()

    function onKeyDown(e) {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onClose?.()
        return
      }
      if (e.key !== 'Tab' || !panel) return
      const focusable = Array.from(panel.querySelectorAll(FOCUSABLE))
      if (focusable.length === 0) return
      const firstEl = focusable[0]
      const lastEl = focusable[focusable.length - 1]
      if (e.shiftKey && document.activeElement === firstEl) {
        e.preventDefault()
        lastEl.focus()
      } else if (!e.shiftKey && document.activeElement === lastEl) {
        e.preventDefault()
        firstEl.focus()
      }
    }

    document.addEventListener('keydown', onKeyDown, true)
    return () => {
      document.removeEventListener('keydown', onKeyDown, true)
      // Return focus to whatever opened the modal — otherwise focus
      // silently resets to <body> and a keyboard user loses their place.
      previouslyFocused?.focus?.()
    }
  }, [open, onClose])

  if (!open) return null
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm animate-fadeIn"
      onClick={onClose}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        tabIndex={-1}
        className={`w-full ${maxWidth} mx-4 bg-surface-800 border border-surface-600 rounded-2xl shadow-panel animate-modalIn outline-none`}
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </div>
  )
}
