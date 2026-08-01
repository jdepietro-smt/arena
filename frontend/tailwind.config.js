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
        // One consolidated near-black scale — the app previously had 6+
        // distinct hardcoded near-black hex values (#07070d, #0a0a0f,
        // #0c0c18, #111118, #0d0d14, #12121a, #1e1e2e) scattered across
        // pages with no shared name, so no page agreed with any other on
        // "the" background/card/border color. These are that single scale;
        // every page should reference surface-* by name, never a raw hex.
        surface: {
          950: '#07070d',  // outermost app shell (Layout root)
          900: '#0a0a0f',  // page background
          800: '#111118',  // card / panel background
          750: '#0d0d14',  // secondary panel, table stripe, nested chip
          700: '#1a1a27',  // raised surface, hover state
          600: '#222233',  // hairline borders
          500: '#2d2d44',  // stronger borders, scrollbar thumb
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
