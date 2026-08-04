import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClientProvider } from '@tanstack/react-query'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import AssistantWidget from '../AssistantWidget'
import { createTestQueryClient } from '../../test/testQueryClient'

vi.mock('../../api/client', () => ({
  queryAssistant: vi.fn(),
}))

import { queryAssistant } from '../../api/client'

function renderWidget() {
  const queryClient = createTestQueryClient()
  return render(
    <QueryClientProvider client={queryClient}>
      <AssistantWidget />
    </QueryClientProvider>
  )
}

beforeEach(() => {
  queryAssistant.mockReset()
})

describe('AssistantWidget', () => {
  it('is closed by default, showing only the floating toggle button', () => {
    renderWidget()
    expect(screen.getByRole('button', { name: 'Open ops assistant' })).toBeInTheDocument()
    expect(screen.queryByText('Ops Assistant')).not.toBeInTheDocument()
  })

  it('opens the panel with suggested questions on click', async () => {
    renderWidget()
    await userEvent.click(screen.getByRole('button', { name: 'Open ops assistant' }))

    expect(screen.getByText('Ops Assistant')).toBeInTheDocument()
    expect(screen.getByText('Are any streams down right now?')).toBeInTheDocument()
  })

  it('sends a question and renders the answer', async () => {
    queryAssistant.mockResolvedValue({ answer: 'cam1 has been down for 4 minutes.' })
    renderWidget()
    await userEvent.click(screen.getByRole('button', { name: 'Open ops assistant' }))

    await userEvent.type(screen.getByPlaceholderText('Ask the ops assistant…'), 'why is cam1 down?')
    await userEvent.click(screen.getByRole('button', { name: 'Send question' }))

    expect(queryAssistant).toHaveBeenCalledWith('why is cam1 down?')
    expect(await screen.findByText('cam1 has been down for 4 minutes.')).toBeInTheDocument()
    expect(screen.getByText('why is cam1 down?')).toBeInTheDocument()
  })

  it('clicking a suggested question sends it directly', async () => {
    queryAssistant.mockResolvedValue({ answer: 'All streams are live.' })
    renderWidget()
    await userEvent.click(screen.getByRole('button', { name: 'Open ops assistant' }))
    await userEvent.click(screen.getByText('Are any streams down right now?'))

    expect(queryAssistant).toHaveBeenCalledWith('Are any streams down right now?')
    expect(await screen.findByText('All streams are live.')).toBeInTheDocument()
  })

  it('shows a readable error message (via getErrorMessage) instead of crashing on failure', async () => {
    queryAssistant.mockRejectedValue({
      response: { data: { detail: "The ops assistant isn't configured — set ANTHROPIC_API_KEY." } },
    })
    renderWidget()
    await userEvent.click(screen.getByRole('button', { name: 'Open ops assistant' }))

    await userEvent.type(screen.getByPlaceholderText('Ask the ops assistant…'), 'status?')
    await userEvent.click(screen.getByRole('button', { name: 'Send question' }))

    expect(await screen.findByText("The ops assistant isn't configured — set ANTHROPIC_API_KEY.")).toBeInTheDocument()
  })

  it('does not send an empty question', async () => {
    renderWidget()
    await userEvent.click(screen.getByRole('button', { name: 'Open ops assistant' }))

    expect(screen.getByRole('button', { name: 'Send question' })).toBeDisabled()
    await userEvent.click(screen.getByRole('button', { name: 'Send question' }))
    expect(queryAssistant).not.toHaveBeenCalled()
  })

  it('closes the panel via the close button', async () => {
    renderWidget()
    await userEvent.click(screen.getByRole('button', { name: 'Open ops assistant' }))
    await userEvent.click(screen.getByRole('button', { name: 'Close ops assistant' }))

    await waitFor(() => expect(screen.queryByText('Ops Assistant')).not.toBeInTheDocument())
  })
})
