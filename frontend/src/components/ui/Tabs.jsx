// Canonical tab switcher — StreamsPage used an underlined-tab pattern,
// SettingsPage used a pill/segmented control for the same interaction.
// Standardizing on the segmented-control look: it reads more like a
// broadcast console control surface than a web-doc underline does.
export default function Tabs({ tabs, active, onChange, className = '' }) {
  return (
    <div className={`inline-flex bg-surface-800 border border-surface-600 rounded-xl p-1 gap-1 ${className}`}>
      {tabs.map((tab) => {
        const isActive = tab.value === active
        return (
          <button
            key={tab.value}
            onClick={() => onChange(tab.value)}
            className={`px-3.5 py-1.5 rounded-lg text-sm font-medium transition-colors ${
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
