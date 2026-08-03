import { QueryClient } from '@tanstack/react-query'

// The real app's QueryClient (main.jsx) sets refetchInterval: 3000 and
// retries on failure — both would leave timers/retries running past a
// test's lifetime and cause flakiness or open-handle warnings. Tests get
// a client with both disabled instead.
export function createTestQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, refetchInterval: false },
      mutations: { retry: false },
    },
  })
}
