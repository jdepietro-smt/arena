import Modal from './Modal'
import Button from './Button'

// Replaces window.confirm() for destructive actions (delete recording,
// delete route, remove user) — a native browser dialog was the last
// remaining unstyled element in an otherwise fully custom dark UI, and
// gave no room to show what's actually being deleted beyond a single
// plain-text line.
export default function ConfirmDialog({
  open, title = 'Are you sure?', message, confirmLabel = 'Confirm',
  danger = true, loading = false, onConfirm, onCancel,
}) {
  return (
    <Modal open={open} onClose={onCancel} maxWidth="max-w-sm">
      <div className="p-6">
        <h2 className="text-white font-semibold text-base mb-2">{title}</h2>
        {message && <p className="text-sm text-gray-400 mb-5">{message}</p>}
        <div className="flex gap-2 justify-end">
          <Button variant="ghost" onClick={onCancel} disabled={loading}>Cancel</Button>
          <Button variant={danger ? 'danger' : 'primary'} onClick={onConfirm} disabled={loading}>
            {loading ? 'Working…' : confirmLabel}
          </Button>
        </div>
      </div>
    </Modal>
  )
}
