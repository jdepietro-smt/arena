import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import LoginPage from '../LoginPage'
import { useAuthStore } from '../../store/auth'
import { login } from '../../api/client'

vi.mock('../../api/client', () => ({
  login: vi.fn(),
}))

function renderLoginPage() {
  return render(
    <MemoryRouter>
      <LoginPage />
    </MemoryRouter>
  )
}

beforeEach(() => {
  useAuthStore.setState({ token: null, user: null })
  login.mockReset()
})

describe('LoginPage', () => {
  it('shows a validation message instead of calling the API when fields are empty', async () => {
    renderLoginPage()

    await userEvent.click(screen.getByRole('button', { name: /sign in/i }))

    expect(await screen.findByText(/enter your username and password/i)).toBeInTheDocument()
    expect(login).not.toHaveBeenCalled()
  })

  it('stores the token and user on successful login', async () => {
    login.mockResolvedValue({
      access_token: 'fake-jwt',
      user: { username: 'admin', role: 'admin' },
    })
    renderLoginPage()

    await userEvent.type(screen.getByPlaceholderText('your-username'), 'admin')
    await userEvent.type(screen.getByPlaceholderText('••••••••'), 'admin123')
    await userEvent.click(screen.getByRole('button', { name: /sign in/i }))

    await waitFor(() => {
      expect(useAuthStore.getState().token).toBe('fake-jwt')
      expect(useAuthStore.getState().user).toEqual({ username: 'admin', role: 'admin' })
    })
    expect(login).toHaveBeenCalledWith('admin', 'admin123')
  })

  it('shows "Invalid username or password" on a 401, not a generic error', async () => {
    login.mockRejectedValue({ response: { status: 401 } })
    renderLoginPage()

    await userEvent.type(screen.getByPlaceholderText('your-username'), 'admin')
    await userEvent.type(screen.getByPlaceholderText('••••••••'), 'wrong')
    await userEvent.click(screen.getByRole('button', { name: /sign in/i }))

    expect(await screen.findByText(/invalid username or password/i)).toBeInTheDocument()
    expect(useAuthStore.getState().token).toBeNull()
  })

  it('shows the server-provided lockout message on a 429, not a generic error', async () => {
    login.mockRejectedValue({
      response: { status: 429, data: { detail: 'Too many failed login attempts. Try again in 15 minute(s).' } },
    })
    renderLoginPage()

    await userEvent.type(screen.getByPlaceholderText('your-username'), 'admin')
    await userEvent.type(screen.getByPlaceholderText('••••••••'), 'wrong')
    await userEvent.click(screen.getByRole('button', { name: /sign in/i }))

    expect(await screen.findByText(/too many failed login attempts/i)).toBeInTheDocument()
  })

  it('shows a network-error message when the server is unreachable', async () => {
    login.mockRejectedValue(new Error('Network Error'))
    renderLoginPage()

    await userEvent.type(screen.getByPlaceholderText('your-username'), 'admin')
    await userEvent.type(screen.getByPlaceholderText('••••••••'), 'admin123')
    await userEvent.click(screen.getByRole('button', { name: /sign in/i }))

    expect(await screen.findByText(/could not reach the server/i)).toBeInTheDocument()
  })

  it('redirects to /dashboard without ever rendering the form when already authenticated', () => {
    useAuthStore.setState({ token: 'already-logged-in', user: { username: 'admin' } })
    renderLoginPage()
    expect(screen.queryByPlaceholderText('your-username')).not.toBeInTheDocument()
  })
})
