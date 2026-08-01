// Canonical "live/status" indicator — every page previously reimplemented
// this inline with slightly different sizes/colors (w-2 vs w-1.5, green vs
// emerald). One component, one set of tones, used everywhere.
const TONES = {
  good:     '#34d399', // emerald-400 — live/active/success, the one "positive" color app-wide
  warning:  '#fbbf24', // amber-400
  critical: '#f87171', // red-400
  muted:    '#52525b', // zinc-600 — idle/inactive/offline
}

export default function StatusDot({ tone = 'muted', pulse = false, size = 8 }) {
  const color = TONES[tone] ?? TONES.muted
  return (
    <span
      className={pulse ? 'animate-pulse' : ''}
      style={{
        display: 'inline-block',
        width: size,
        height: size,
        borderRadius: '50%',
        background: color,
        boxShadow: pulse ? `0 0 8px ${color}` : 'none',
        flexShrink: 0,
      }}
    />
  )
}
