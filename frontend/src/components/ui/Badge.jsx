// Canonical status/role pill — StreamsPage used a bg+border pair,
// SettingsPage used bg-only, RecordingsPage used yet another combination.
// One shape, one set of tones.
const TONES = {
  good:     'bg-emerald-500/15 text-emerald-400 border-emerald-500/30',
  warning:  'bg-amber-500/15 text-amber-400 border-amber-500/30',
  critical: 'bg-red-500/15 text-red-400 border-red-500/30',
  info:     'bg-brand-500/15 text-brand-400 border-brand-500/30',
  muted:    'bg-surface-700 text-gray-400 border-surface-600',
}

export default function Badge({ tone = 'muted', children, className = '' }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-medium border ${TONES[tone] ?? TONES.muted} ${className}`}
    >
      {children}
    </span>
  )
}
