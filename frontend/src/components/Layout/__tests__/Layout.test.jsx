import { render, screen } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import Layout from '../index'
import { useAuthStore } from '../../../store/auth'

beforeEach(() => {
  useAuthStore.setState({ token: 'fake-token', user: { username: 'admin', role: 'admin' } })
  global.fetch = vi.fn().mockResolvedValue({ ok: true })
})

function renderLayout() {
  return render(
    <MemoryRouter initialEntries={['/dashboard']}>
      <Routes>
        <Route path="/" element={<Layout />}>
          <Route path="dashboard" element={<div>Dashboard content</div>} />
        </Route>
      </Routes>
    </MemoryRouter>
  )
}

describe('Layout', () => {
  it('renders a skip-to-content link pointing at #main-content', () => {
    renderLayout()
    const skipLink = screen.getByText('Skip to main content')
    expect(skipLink).toHaveAttribute('href', '#main-content')
  })

  it('gives <main> the id the skip link targets, focusable via tabIndex', () => {
    renderLayout()
    const main = document.getElementById('main-content')
    expect(main).toBeInTheDocument()
    expect(main.tagName).toBe('MAIN')
    expect(main).toHaveAttribute('tabindex', '-1')
  })

  it('renders the routed page content inside <main>', () => {
    renderLayout()
    const main = document.getElementById('main-content')
    expect(main).toHaveTextContent('Dashboard content')
  })

  it('labels the sidebar nav for assistive tech', () => {
    renderLayout()
    expect(screen.getByRole('navigation', { name: 'Main navigation' })).toBeInTheDocument()
  })
})
