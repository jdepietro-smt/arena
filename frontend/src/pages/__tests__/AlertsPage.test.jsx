import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { act } from 'react'
import { QueryClientProvider } from '@tanstack/react-query'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import AlertsPage from '../AlertsPage'
import ToastStack from '../../components/ui/Toast'
import { useToastStore } from '../../store/toast'
import { createTestQueryClient } from '../../test/testQueryClient'

vi.mock('../../api/client', () => ({
  getStreams: vi.fn(),
  getAlertStatus: vi.fn(),
  getAlertRules: vi.fn(),
  createAlertRule: vi.fn(),
  toggleAlertRule: vi.fn(),
  deleteAlertRule: vi.fn(),
  getRedundancyStatus: vi.fn(),
  getRedundancyGateways: vi.fn(),
  createRedundancyGateway: vi.fn(),
  toggleRedundancyGateway: vi.fn(),
  deleteRedundancyGateway: vi.fn(),
}))

import {
  getStreams, getAlertStatus, getAlertRules, toggleAlertRule, deleteAlertRule,
  getRedundancyStatus, getRedundancyGateways, toggleRedundancyGateway, deleteRedundancyGateway,
} from '../../api/client'

function renderAlertsPage() {
  const queryClient = createTestQueryClient()
  return render(
    <QueryClientProvider client={queryClient}>
      <AlertsPage />
      <ToastStack />
    </QueryClientProvider>
  )
}

beforeEach(() => {
  getStreams.mockReset().mockResolvedValue([])
  getAlertStatus.mockReset().mockResolvedValue({ down_streams: [], firing_rule_ids: [] })
  getAlertRules.mockReset().mockResolvedValue([])
  toggleAlertRule.mockReset()
  deleteAlertRule.mockReset()
  getRedundancyStatus.mockReset().mockResolvedValue({ gateways: [] })
  getRedundancyGateways.mockReset().mockResolvedValue([])
  toggleRedundancyGateway.mockReset()
  deleteRedundancyGateway.mockReset()
  act(() => useToastStore.setState({ toasts: [] }))
})

describe('AlertsPage — alert rules', () => {
  it('shows the empty state when there are no rules', async () => {
    renderAlertsPage()
    expect(await screen.findByText(/No alert rules configured/)).toBeInTheDocument()
  })

  it('shows a connection-error message instead of the empty state when the rules query fails', async () => {
    getAlertRules.mockRejectedValue(new Error('network error'))
    renderAlertsPage()

    expect(await screen.findByText('Could not load alert rules. Retrying…')).toBeInTheDocument()
    expect(screen.queryByText(/No alert rules configured/)).not.toBeInTheDocument()
  })

  it('toggles a rule and shows a success toast', async () => {
    getAlertRules.mockResolvedValue([
      { id: 1, stream_path: 'cam1', metric: 'bitrate', operator: 'lt', threshold: 500, is_active: true },
    ])
    toggleAlertRule.mockResolvedValue({ id: 1, is_active: false })
    renderAlertsPage()
    await screen.findByText('cam1')

    await userEvent.click(screen.getByRole('button', { name: 'Enabled' }))

    await waitFor(() => expect(toggleAlertRule).toHaveBeenCalled())
    expect(toggleAlertRule.mock.calls[0][0]).toBe(1)
    expect(await screen.findByText('Rule disabled')).toBeInTheDocument()
  })

  it('shows an error toast when toggling a rule fails', async () => {
    getAlertRules.mockResolvedValue([
      { id: 1, stream_path: 'cam1', metric: 'bitrate', operator: 'lt', threshold: 500, is_active: true },
    ])
    toggleAlertRule.mockRejectedValue({ response: { data: { detail: 'Rule not found' } } })
    renderAlertsPage()
    await screen.findByText('cam1')

    await userEvent.click(screen.getByRole('button', { name: 'Enabled' }))

    expect(await screen.findByText('Rule not found')).toBeInTheDocument()
  })

  it('deletes a rule after confirming in the dialog, and does nothing if cancelled', async () => {
    getAlertRules.mockResolvedValue([
      { id: 1, stream_path: 'cam1', metric: 'bitrate', operator: 'lt', threshold: 500, is_active: true },
    ])
    deleteAlertRule.mockResolvedValue({})
    renderAlertsPage()
    await screen.findByText('cam1')

    await userEvent.click(screen.getByRole('button', { name: '✕' }))
    const dialog = screen.getByRole('dialog')
    expect(within(dialog).getByText('Delete the rule for "cam1"?')).toBeInTheDocument()

    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    expect(deleteAlertRule).not.toHaveBeenCalled()

    await userEvent.click(screen.getByRole('button', { name: '✕' }))
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Delete' }))

    await waitFor(() => expect(deleteAlertRule).toHaveBeenCalled())
    expect(deleteAlertRule.mock.calls[0][0]).toBe(1)
    expect(await screen.findByText('Alert rule deleted')).toBeInTheDocument()
  })
})

describe('AlertsPage — redundancy gateways', () => {
  it('shows the empty state when there are no gateways', async () => {
    renderAlertsPage()
    expect(await screen.findByText(/No redundancy gateways registered/)).toBeInTheDocument()
  })

  it('shows a connection-error message instead of the empty state when the gateways query fails', async () => {
    getRedundancyGateways.mockRejectedValue(new Error('network error'))
    renderAlertsPage()

    expect(await screen.findByText('Could not load redundancy gateways. Retrying…')).toBeInTheDocument()
    expect(screen.queryByText(/No redundancy gateways registered/)).not.toBeInTheDocument()
  })

  it('deletes a gateway after confirming in the dialog', async () => {
    getRedundancyGateways.mockResolvedValue([
      { id: 9, name: 'Truck 1', stats_url: 'http://10.0.1.5:6400/', is_active: true },
    ])
    deleteRedundancyGateway.mockResolvedValue({})
    renderAlertsPage()
    await screen.findByRole('button', { name: '✕' })

    await userEvent.click(screen.getByRole('button', { name: '✕' }))
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Delete' }))

    await waitFor(() => expect(deleteRedundancyGateway).toHaveBeenCalled())
    expect(deleteRedundancyGateway.mock.calls[0][0]).toBe(9)
    expect(await screen.findByText('Redundancy gateway deleted')).toBeInTheDocument()
  })

  it('shows an error toast when deleting a gateway fails', async () => {
    getRedundancyGateways.mockResolvedValue([
      { id: 9, name: 'Truck 1', stats_url: 'http://10.0.1.5:6400/', is_active: true },
    ])
    deleteRedundancyGateway.mockRejectedValue({ response: { data: { detail: 'Gateway not found' } } })
    renderAlertsPage()
    await screen.findByRole('button', { name: '✕' })

    await userEvent.click(screen.getByRole('button', { name: '✕' }))
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Delete' }))

    expect(await screen.findByText('Gateway not found')).toBeInTheDocument()
  })
})
