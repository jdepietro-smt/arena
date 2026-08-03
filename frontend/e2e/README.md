# E2E smoke tests

Read-only Playwright tests against a real, running ArenaHub instance — no
mocked APIs, unlike the `src/**/__tests__` vitest suite. **Never wired into
CI** (`.github/workflows/frontend-tests.yml`): these hit a real server
(production by default) with real credentials, so they're a deliberate,
local-only, human-triggered check, not something that should run
unattended on every push.

## What these do and don't do

- Every test is read-only: navigate, assert on what's rendered, log out.
  Nothing creates, deletes, toggles, or uploads anything.
- The login test logs in **once** per run with valid credentials and
  never deliberately submits a wrong password — the backend has a
  5-failed-attempt IP lockout (`services/login_limiter.py`), and this
  suite runs from a shared IP, so a wrong-password test here risks
  locking out a real operator working from the same network.

## Setup

Set three environment variables before running (never commit them):

```bash
export E2E_BASE_URL=http://5.78.236.254:8001   # defaults to this if unset
export E2E_USERNAME=your-username
export E2E_PASSWORD=your-password
```

Or drop them in a git-ignored `.env.e2e` file in this directory and load it
into your shell before running (`.env.e2e` is already covered by
`frontend/.gitignore`'s `*.env.e2e` entry).

## Running

```bash
npx playwright test
```

Runs headless against `E2E_BASE_URL` with a single worker (see
`playwright.config.js` — `fullyParallel: false`, since every test after
login shares that one session, and running them concurrently would just
be racing tabs against the same cookie for no benefit here).
