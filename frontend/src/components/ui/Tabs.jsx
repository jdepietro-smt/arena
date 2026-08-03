// Canonical tab switcher — StreamsPage used an underlined-tab pattern,
// SettingsPage used a pill/segmented control for the same interaction.
// Standardizing on the segmented-control look: it reads more like a
// broadcast console control surface than a web-doc underline does.
//
// Implements the WAI-ARIA tabs pattern (role="tablist"/"tab",
// aria-selected, roving tabindex, Left/Right arrow-key navigation) —
// previously these were plain unlabeled buttons with no tab semantics,
// so a screen reader announced an unordered button group instead of a
// tab interface, and Tab key order included every tab instead of just
// the active one.
export default function Tabs({ tabs, active, onChange, className = '' }) {
  const activeIndex = Math.max(0, tabs.findIndex((t) => t.value === active))

  function handleKeyDown(e, index) {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return
    e.preventDefault()
    const dir = e.key === 'ArrowRight' ? 1 : -1
    const nextIndex = (index + dir + tabs.length) % tabs.length
    onChange(tabs[nextIndex].value)
    e.currentTarget.parentElement.children[nextIndex]?.focus()
  }

  return (
    <div
      role="tablist"
      className={`inline-flex bg-surface-800 border border-surface-600 rounded-xl p-1 gap-1 ${className}`}
    >
      {tabs.map((tab, index) => {
        const isActive = tab.value === active
        return (
          <button
            key={tab.value}
            role="tab"
            aria-selected={isActive}
            tabIndex={index === activeIndex ? 0 : -1}
            onClick={() => onChange(tab.value)}
            onKeyDown={(e) => handleKeyDown(e, index)}
            className={`px-3.5 py-1.5 rounded-lg text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-brand-400 focus-visible:outline-offset-2 ${
              isActive
                ? 'bg-brand-500/15 text-brand-400'
                : 'text-gray-500 hover:text-gray-300'
            }`}
          >
            {tab.label}
          </button>
        )
      })}
    </div>
  )
}
