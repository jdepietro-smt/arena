import { test, expect } from '@playwright/test'

// See README.md for setup — never runs in CI, hits a real server.
const USERNAME = process.env.E2E_USERNAME
const PASSWORD = process.env.E2E_PASSWORD

test.beforeAll(() => {
  if (!USERNAME || !PASSWORD) {
    throw new Error(
      'E2E_USERNAME and E2E_PASSWORD must be set — see frontend/e2e/README.md. ' +
      'Refusing to guess or fall back to a default credential against a real server.'
    )
  }
})

test.describe('unauthenticated', () => {
  test('login page renders with no console errors', async ({ page }) => {
    const errors = []
    page.on('console', (msg) => { if (msg.type() === 'error') errors.push(msg.text()) })
    page.on('pageerror', (err) => errors.push(err.message))

    await page.goto('/login')

    await expect(page.getByPlaceholder('your-username')).toBeVisible()
    await expect(page.getByPlaceholder('••••••••')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible()
    expect(errors).toEqual([])
  })

  test('an unauthenticated visit to a protected route redirects to login', async ({ page }) => {
    await page.goto('/dashboard')
    await expect(page).toHaveURL(/\/login$/)
  })
})

test.describe('authenticated smoke walk', () => {
  // One shared login for the whole file — see README on why this suite
  // never deliberately submits a wrong password (login lockout risk).
  test.beforeEach(async ({ page }) => {
    await page.goto('/login')
    await page.getByPlaceholder('your-username').fill(USERNAME)
    await page.getByPlaceholder('••••••••').fill(PASSWORD)
    await page.getByRole('button', { name: 'Sign in' }).click()
    await expect(page).toHaveURL(/\/dashboard$/, { timeout: 10_000 })
  })

  test('logs in and lands on the Dashboard with the summary cards visible', async ({ page }) => {
    const main = page.locator('main')
    await expect(main.getByText('Active Streams')).toBeVisible()
    await expect(main.getByText('Total Bitrate')).toBeVisible()
    await expect(main.getByText('Recordings')).toBeVisible()
    await expect(main.getByText('Connected Viewers')).toBeVisible()
  })

  for (const [linkName, headingText] of [
    ['Streams', 'Streams'],
    ['Router', 'Signal Router'],
    ['Recordings', 'Recordings'],
    ['Statistics', 'Live Monitoring'],
    ['Alerts', 'Alerts'],
    ['Settings', 'Settings'],
  ]) {
    test(`navigates to ${linkName} and it renders without console errors`, async ({ page }) => {
      const errors = []
      page.on('console', (msg) => { if (msg.type() === 'error') errors.push(msg.text()) })
      page.on('pageerror', (err) => errors.push(err.message))

      await page.getByRole('link', { name: linkName }).click()
      // Scoped to <main> — the sidebar nav link itself also contains this
      // text, so an unscoped match would pass even if the page never
      // actually rendered.
      await expect(page.locator('main').getByText(headingText).first()).toBeVisible({ timeout: 10_000 })
      expect(errors, `console errors on ${linkName}`).toEqual([])
    })
  }

  test('signs out and returns to the login page', async ({ page }) => {
    await page.getByText(USERNAME).click()
    await page.getByRole('menuitem', { name: 'Sign out' }).click()
    await expect(page).toHaveURL(/\/login$/)
  })
})
