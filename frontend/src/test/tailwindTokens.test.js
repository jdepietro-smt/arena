// Regression test for a real bug found during manual QA: DashboardPage's
// StatCard used text-brand-300/text-signal-300 for two of its four accent
// colors, but those custom color scales (tailwind.config.js) only defined
// 400+ — no 300 step existed. Tailwind silently generates no utility class
// for a shade that isn't in the scale (no build error, no warning), so
// those two cards silently fell back to browser-default text color instead
// of their intended accent. Confirmed live via computed style before the
// fix: rgb(226,232,240) (plain gray) instead of the accent hue.
//
// This can't be caught by rendering a component and reading className —
// the class string is present either way; the bug is that Tailwind's CSS
// generator has nothing to emit for it. The only reliable check is against
// the palette definition even Tailwind will actually build: every shade
// step 300-900) some the app's UI code actually asks for by name.
import { describe, it, expect } from 'vitest'
import tailwindConfig from '../../tailwind.config.js'

const CUSTOM_SCALES = ['brand', 'signal', 'surface']

// Every shade used by className strings in src/ — kept as an explicit list
// (rather than grepping live) so this test is a deliberate check against
// the design system, not just a mirror of whatever's currently in the code.
const SHADES_IN_USE = {
  brand: [200, 300, 400, 500, 600, 900],
  signal: [300, 400, 500],
  surface: [500, 600, 700, 750, 800, 900, 950],
}

describe('tailwind.config.js custom color scales', () => {
  const colors = tailwindConfig.theme.extend.colors

  it.each(CUSTOM_SCALES)('%s scale is defined', (scale) => {
    expect(colors[scale]).toBeDefined()
  })

  for (const [scale, shades] of Object.entries(SHADES_IN_USE)) {
    it.each(shades)(`${scale}-%s (used in the app) exists in the palette`, (shade) => {
      expect(colors[scale][shade]).toBeDefined()
    })
  }
})
