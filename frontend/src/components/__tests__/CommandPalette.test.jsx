import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { QueryClientProvider } from '@tanstack/react-query'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import CommandPalette from '../CommandPalette'
import { createTestQueryClient } from '../../test/testQueryClient'

vi.mock('../../api/client', () => ({
  getStreams: vi.fn(),
}))

import { getStreams } from '../../api/client'

function renderPalette() {
  const queryClient = createTestQueryClient()
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/dashboard']}>
        <Routes>
          <Route path="/dashboard" element={<><div>Dashboard content</div><CommandPalette /></>} />
          <Route path="/alerts" element={<><div>Alerts content</div><CommandPalette /></>} />
          <Route path="/stats" element={<div>Stats content</div>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  )
}

beforeEach(() => {
  getStreams.mockReset().mockResolvedValue([])
})

describe('CommandPalette', () => {
  it('is closed by default', () => {
    renderPalette()
    expect(screen.queryByRole('dialog', { name: 'Command palette' })).not.toBeInTheDocument()
  })

  it('opens on Ctrl+K and focuses the search input', async () => {
    renderPalette()
    await userEvent.keyboard('{Control>}k{/Control}')

    expect(screen.getByRole('dialog', { name: 'Command palette' })).toBeInTheDocument()
    await waitFor(() => expect(screen.getByLabelText('Search pages and streams')).toHaveFocus())
  })

  it('toggles closed on a second Ctrl+K', async () => {
    renderPalette()
    await userEvent.keyboard('{Control>}k{/Control}')
    expect(screen.getByRole('dialog', { name: 'Command palette' })).toBeInTheDocument()

    await userEvent.keyboard('{Control>}k{/Control}')
    expect(screen.queryByRole('dialog', { name: 'Command palette' })).not.toBeInTheDocument()
  })

  it('closes on Escape', async () => {
    renderPalette()
    await userEvent.keyboard('{Control>}k{/Control}')
    await userEvent.keyboard('{Escape}')

    expect(screen.queryByRole('dialog', { name: 'Command palette' })).not.toBeInTheDocument()
  })

  it('filters pages by typed text and navigates on click', async () => {
    renderPalette()
    await userEvent.keyboard('{Control>}k{/Control}')

    await userEvent.type(screen.getByLabelText('Search pages and streams'), 'alert')
    expect(screen.getByText('Alerts')).toBeInTheDocument()
    expect(screen.queryByText('Dashboard')).not.toBeInTheDocument()

    await userEvent.click(screen.getByText('Alerts'))

    expect(await screen.findByText('Alerts content')).toBeInTheDocument()
    expect(screen.queryByRole('dialog', { name: 'Command palette' })).not.toBeInTheDocument()
  })

  it('includes live streams in the results and jumps to their stats view', async () => {
    getStreams.mockResolvedValue([{ path: 'cam1', name: 'Camera 1' }])
    renderPalette()
    await userEvent.keyboard('{Control>}k{/Control}')

    await userEvent.type(screen.getByLabelText('Search pages and streams'), 'camera')
    const streamResult = await screen.findByText('Camera 1')
    expect(streamResult).toBeInTheDocument()
    expect(screen.getByText('Stream')).toBeInTheDocument()

    await userEvent.click(streamResult)
    expect(await screen.findByText('Stats content')).toBeInTheDocument()
  })

  it('navigates with arrow keys and Enter', async () => {
    renderPalette()
    await userEvent.keyboard('{Control>}k{/Control}')
    const input = screen.getByLabelText('Search pages and streams')

    await userEvent.type(input, 'a')
    // "Overview", "Dashboard"... — narrow to something unambiguous first.
    await userEvent.clear(input)
    await userEvent.type(input, 'alert')
    await userEvent.keyboard('{Enter}')

    expect(await screen.findByText('Alerts content')).toBeInTheDocument()
  })

  it('shows "No matches" for a query that hits nothing', async () => {
    renderPalette()
    await userEvent.keyboard('{Control>}k{/Control}')
    await userEvent.type(screen.getByLabelText('Search pages and streams'), 'zzzznotarealthing')

    expect(screen.getByText('No matches')).toBeInTheDocument()
  })

  it('resets the query each time it reopens', async () => {
    renderPalette()
    await userEvent.keyboard('{Control>}k{/Control}')
    await userEvent.type(screen.getByLabelText('Search pages and streams'), 'alert')
    await userEvent.keyboard('{Escape}')

    await userEvent.keyboard('{Control>}k{/Control}')
    expect(screen.getByLabelText('Search pages and streams')).toHaveValue('')
    expect(screen.getByText('Dashboard')).toBeInTheDocument()
  })
})
