/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        // The accent is the amber of the Portal and the Comms apps (#ffb938), so the three read as one product.
        brand: {
          50:  '#fff8e6',
          100: '#ffefc2',
          200: '#ffe08a',
          300: '#ffd05c',
          400: '#ffc447',
          500: '#ffb938',
          600: '#e69f1c',
          700: '#b87a10',
          800: '#7d530c',
          900: '#3d2a06',
        },
        // Consolidated near-black scale, deliberately given more separation
        // between steps than the old flat #111118-everywhere approach —
        // real contrast between page canvas and card surface is what
        // reads as depth rather than "one color, several names."
        surface: {
          950: '#07080a',  // outermost app shell (Layout root)
          900: '#0d0f13',  // page canvas (the Portal's background)
          800: '#161a21',  // card / panel background (the Portal's panel)
          750: '#1b2028',  // secondary panel, table stripe, nested chip
          700: '#1f242d',  // raised surface, hover state
          600: '#2a303a',  // hairline borders (the Portal's edge)
          500: '#3b4350',  // stronger borders, scrollbar thumb
        },
        // Cyan "signal" accent — a second hue reserved for live/data
        // readouts (sparklines, live pulses, mono numerals) so the app
        // reads as an actual broadcast monitoring surface, not just a
        // generic indigo SaaS dashboard with different labels.
        signal: {
          300: '#ffd05c',
          400: '#ffc447',
          500: '#ffb938',
        },
      },
      fontFamily: {
        sans: ['Inter', 'Segoe UI', 'system-ui', 'sans-serif'],
        label: ['Bahnschrift', 'Segoe UI Semibold', 'Arial Narrow', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'monospace'],
      },
      boxShadow: {
        glow: '0 0 24px -4px rgba(255, 185, 56, 0.30)',
        panel: '0 4px 24px -4px rgba(0, 0, 0, 0.4)',
      },
      keyframes: {
        fadeIn:  { from: { opacity: 0 }, to: { opacity: 1 } },
        modalIn: {
          from: { opacity: 0, transform: 'translateY(8px) scale(0.98)' },
          to:   { opacity: 1, transform: 'translateY(0) scale(1)' },
        },
      },
      animation: {
        fadeIn: 'fadeIn 0.15s ease-out',
        modalIn: 'modalIn 0.18s ease-out',
      },
    }
  },
  plugins: []
}
