import { create } from 'zustand'
import { toast } from './toast'

// Backs "delete with undo" across every delete flow in the app (recordings,
// routes, users, alert rules, redundancy gateways) — replaces the earlier
// confirm-dialog-then-delete pattern. Deleting is now: hide the item
// immediately, show an undo toast for the grace window, and only call the
// real delete mutation if the window elapses without the user undoing it.
// Confirming first and offering undo after is redundant friction; undo
// covers the same "did I mean to do that" need without an extra click.
//
// Not persisted (a reload mid-grace-window just lets the delete proceed —
// same as closing the tab on any other in-flight action) and lives outside
// any one component's lifecycle: the setTimeout keeps running even if the
// page that started it unmounts (e.g. the user navigates away), same as a
// real "send" queued and then abandoned.

const DEFAULT_GRACE_MS = 6000
const _timers = new Map()

export const usePendingDeleteStore = create(() => ({
  hidden: new Set(),
}))

function _setHidden(mutate) {
  usePendingDeleteStore.setState((s) => {
    const next = new Set(s.hidden)
    mutate(next)
    return { hidden: next }
  })
}

/** Hook: subscribe to whether a specific id is currently pending deletion. */
export function usePendingDelete(id) {
  return usePendingDeleteStore((s) => s.hidden.has(id))
}

/** Hook: subscribe to the full set of currently-pending ids — for
 * filtering a list in one pass rather than calling usePendingDelete per
 * row. */
export function usePendingDeleteIds() {
  return usePendingDeleteStore((s) => s.hidden)
}

/**
 * scheduleDelete({ id, label, onDelete, onError, grace })
 *
 * Hides `id` immediately (usePendingDelete(id) starts returning true) and
 * shows an undo toast. If the toast's Undo action fires before `grace`
 * elapses, the id is un-hidden and onDelete is never called. Otherwise
 * onDelete() runs (expected to be the real API call) after `grace`; on
 * failure the id is un-hidden again so the item reappears rather than
 * staying hidden with nothing actually deleted.
 */
export function scheduleDelete({ id, label, onDelete, onError, grace = DEFAULT_GRACE_MS }) {
  _setHidden((next) => next.add(id))

  const timer = setTimeout(async () => {
    _timers.delete(id)
    try {
      await onDelete()
    } catch (err) {
      _setHidden((next) => next.delete(id))
      onError?.(err)
      return
    }
    _setHidden((next) => next.delete(id))
  }, grace)
  _timers.set(id, timer)

  toast.info(`${label} deleted`, {
    duration: grace,
    action: {
      label: 'Undo',
      onClick: () => {
        clearTimeout(_timers.get(id))
        _timers.delete(id)
        _setHidden((next) => next.delete(id))
      },
    },
  })
}
