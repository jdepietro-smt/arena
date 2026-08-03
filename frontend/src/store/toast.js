import { create } from 'zustand'

// Not persisted — a toast that survived a reload would be stale by
// definition. Auto-dismiss timers live here (not in the component) so a
// toast queued before ToastStack ever mounts still expires on schedule.
let nextId = 0
const _timers = new Map()

const useToastStore = create((set) => ({
  toasts: [],
  push: (toast) => {
    const id = ++nextId
    set((s) => ({ toasts: [...s.toasts, { id, ...toast }] }))
    const timer = setTimeout(() => useToastStore.getState().dismiss(id), toast.duration ?? 4000)
    _timers.set(id, timer)
    return id
  },
  dismiss: (id) => {
    clearTimeout(_timers.get(id))
    _timers.delete(id)
    set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }))
  },
}))

// Imperative API for use in mutation onSuccess/onError callbacks, event
// handlers, or anywhere outside a component render — the same shape as
// most toast libraries (toast.success(...) / toast.error(...)), so call
// sites don't need to be components or reach for a hook.
export const toast = {
  success: (message, opts) => useToastStore.getState().push({ tone: 'good', message, ...opts }),
  error: (message, opts) => useToastStore.getState().push({ tone: 'critical', message, ...opts }),
  info: (message, opts) => useToastStore.getState().push({ tone: 'info', message, ...opts }),
}

export { useToastStore }
