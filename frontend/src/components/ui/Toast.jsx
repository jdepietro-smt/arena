import { CheckCircle2, XCircle, Info, X } from 'lucide-react'
import { useToastStore } from '../../store/toast'

const TONES = {
  good:     { icon: CheckCircle2, className: 'border-emerald-500/30 text-emerald-300', iconClass: 'text-emerald-400' },
  critical: { icon: XCircle,      className: 'border-red-500/30 text-red-300',         iconClass: 'text-red-400' },
  info:     { icon: Info,         className: 'border-brand-500/30 text-brand-300',     iconClass: 'text-brand-400' },
}

function ToastItem({ id, tone, message, action, onDismiss }) {
  const t = TONES[tone] ?? TONES.info
  const Icon = t.icon
  return (
    <div
      role="alert"
      className={`flex items-start gap-2.5 w-80 max-w-[calc(100vw-2rem)] px-4 py-3 rounded-xl bg-surface-800 border ${t.className} shadow-panel animate-fadeIn`}
    >
      <Icon size={17} className={`shrink-0 mt-px ${t.iconClass}`} />
      <p className="flex-1 text-sm text-gray-200 leading-snug">{message}</p>
      {action && (
        <button
          onClick={() => { action.onClick(); onDismiss(id) }}
          className="shrink-0 text-xs font-semibold text-brand-300 hover:text-brand-200 transition-colors"
        >
          {action.label}
        </button>
      )}
      <button
        onClick={() => onDismiss(id)}
        className="shrink-0 text-gray-500 hover:text-white transition-colors"
        aria-label="Dismiss"
      >
        <X size={15} />
      </button>
    </div>
  )
}

// Mounted once at the app root (App.jsx) — every toast.success()/error()/
// info() call anywhere in the app (mutation callbacks, query error
// effects, event handlers) renders here, above modals (z-[300] > Modal's
// z-50) so a toast fired while a modal is open is never hidden behind it.
export default function ToastStack() {
  const toasts = useToastStore((s) => s.toasts)
  const dismiss = useToastStore((s) => s.dismiss)

  if (toasts.length === 0) return null

  return (
    <div className="fixed bottom-4 right-4 z-[300] flex flex-col gap-2 items-end">
      {toasts.map((t) => (
        <ToastItem key={t.id} {...t} onDismiss={dismiss} />
      ))}
    </div>
  )
}
