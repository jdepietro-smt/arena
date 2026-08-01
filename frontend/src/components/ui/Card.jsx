// Canonical panel/card — the one visual container every page reaches for
// (stat tiles, list rows, form sections). `hover` adds the subtle
// lift+border-brighten previously only present on RecordingsPage.
export default function Card({ children, className = '', hover = false, as: Tag = 'div', ...props }) {
  return (
    <Tag
      className={`bg-surface-800 border border-surface-600 rounded-xl ${
        hover ? 'transition-colors hover:border-surface-500' : ''
      } ${className}`}
      {...props}
    >
      {children}
    </Tag>
  )
}
