// Canonical button — pages previously hand-rolled the same 4-5 button
// styles (primary/danger/ghost) inline, slightly differently each time.
const VARIANTS = {
  primary: 'bg-brand-600 hover:bg-brand-500 text-white shadow-sm shadow-brand-900/40',
  danger:  'bg-red-600/90 hover:bg-red-600 text-white',
  ghost:   'bg-surface-700 hover:bg-surface-600 text-gray-200 border border-surface-600',
  subtle:  'bg-transparent hover:bg-surface-700 text-gray-400 hover:text-gray-200',
}

const SIZES = {
  sm: 'px-2.5 py-1.5 text-xs',
  md: 'px-4 py-2 text-sm',
}

export default function Button({
  variant = 'primary', size = 'md', className = '', children, disabled, ...props
}) {
  return (
    <button
      disabled={disabled}
      className={`inline-flex items-center justify-center gap-1.5 rounded-lg font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${VARIANTS[variant]} ${SIZES[size]} ${className}`}
      {...props}
    >
      {children}
    </button>
  )
}
