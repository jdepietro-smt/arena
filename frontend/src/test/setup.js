import '@testing-library/jest-dom'

// jsdom doesn't implement IntersectionObserver (StreamCard.jsx uses it to
// lazily connect WHEP only when a card scrolls into view) — a minimal
// stub is enough since no test needs it to actually fire.
if (typeof globalThis.IntersectionObserver === 'undefined') {
  globalThis.IntersectionObserver = class IntersectionObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
}
