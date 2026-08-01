// Canonical modal — three different implementations existed before this
// (Tailwind-class backdrop-blur, inline-style no-blur, and a third with
// neither blur nor the same opacity). One backdrop, one entrance
// animation, one close-on-backdrop-click behavior.
export default function Modal({ open, onClose, children, maxWidth = 'max-w-md' }) {
  if (!open) return null
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm animate-fadeIn"
      onClick={onClose}
    >
      <div
        className={`w-full ${maxWidth} mx-4 bg-surface-800 border border-surface-600 rounded-2xl shadow-panel animate-modalIn`}
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </div>
  )
}
