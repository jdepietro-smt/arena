/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        brand: {
          50:  '#eef2ff',
          100: '#e0e7ff',
          200: '#c7d2fe',
          400: '#818cf8',
          500: '#6366f1',
          600: '#4f46e5',
          700: '#4338ca',
          800: '#3730a3',
          900: '#1e1b4b',
        },
        // Consolidated near-black scale, deliberately given more separation
        // between steps than the old flat #111118-everywhere approach —
        // real contrast between page canvas and card surface is what
        // reads as depth rather than "one color, several names."
        surface: {
          950: '#050508',  // outermost app shell (Layout root)
          900: '#08080c',  // page canvas
          800: '#14141f',  // card / panel background — lighter than canvas on purpose
          750: '#191926',  // secondary panel, table stripe, nested chip
          700: '#1e1e30',  // raised surface, hover state
          600: '#28283c',  // hairline borders
          500: '#38385a',  // stronger borders, scrollbar thumb
        },
        // Cyan "signal" accent — a second hue reserved for live/data
        // readouts (sparklines, live pulses, mono numerals) so the app
        // reads as an actual broadcast monitoring surface, not just a
        // generic indigo SaaS dashboard with different labels.
        signal: {
          400: '#22d3ee',
          500: '#06b6d4',
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'monospace'],
      },
      boxShadow: {
        glow: '0 0 24px -4px rgba(99, 102, 241, 0.35)',
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
