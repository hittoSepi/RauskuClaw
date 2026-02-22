import { test, expect, Page } from '@playwright/test'

const SESSION_STORAGE_KEY = 'rauskuclaw_api_key'

async function setSessionStorageKey(page: Page, key: string | null) {
  await page.addInitScript((args) => {
    const { storageKey, value } = args
    if (value === null) sessionStorage.removeItem(storageKey)
    else sessionStorage.setItem(storageKey, value)
  }, { storageKey: SESSION_STORAGE_KEY, value: key })
}

async function interceptWhoami(page: Page, response: { status: number; body: unknown }) {
  await page.route('**/v1/auth/whoami', async (route) => {
    await route.fulfill({
      status: response.status,
      contentType: 'application/json',
      body: JSON.stringify(response.body),
    })
  })
}

async function interceptChatPreflightDefaults(page: Page) {
  await page.route('**/v1/job-types', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        types: [
          { name: 'ai.chat.generate', enabled: true },
          { name: 'codex.chat.generate', enabled: true },
        ],
      }),
    })
  })

  await page.route('**/v1/runtime/providers', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        providers: {
          openai: { enabled: true },
          codex: { enabled: true },
        },
      }),
    })
  })
}

async function getSessionStorageKey(page: Page): Promise<string | null> {
  return page.evaluate((key) => sessionStorage.getItem(key), SESSION_STORAGE_KEY)
}

test.beforeEach(async ({ page }) => {
  // NOTE:
  // - Route order matters: last registered wins.
  // - We register a catch-all for /v1/** that FAILS FAST.
  // - Then we register a default /v1/auth/whoami mock (401) that overrides the catch-all.
  // - Individual tests can still override whoami by calling interceptWhoami(page, ...)

  // Fail fast on any unexpected API call (keeps “no backend required” true)
  await page.route('**/v1/**', async (route) => {
    const url = route.request().url()
    if (
      url.includes('/v1/auth/whoami')
      || url.includes('/v1/job-types')
      || url.includes('/v1/runtime/providers')
    ) {
      // Let the dedicated whoami handler (registered below, or overridden by a test) handle this.
      return route.fallback()
    }

    // If something else hits /v1, your app is leaking real API calls into smoke.
    await route.fulfill({
      status: 500,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: false,
        error: { code: 'E2E_UNEXPECTED_API_CALL', message: `Unexpected API call: ${url}` },
      }),
    })
  })

  // Default: whoami returns 401 unless test overrides it
  await page.route('**/v1/auth/whoami', async (route) => {
    await route.fulfill({
      status: 401,
      contentType: 'application/json',
      body: JSON.stringify({ error: 'Unauthorized' }),
    })
  })

  await interceptChatPreflightDefaults(page)
})

// Test 1
test('shows API key gate when no key is stored', async ({ page }) => {
  await setSessionStorageKey(page, null)
  await page.goto('/')

  const gate = page.getByTestId('api-key-gate')
  await expect(gate).toBeVisible()
  await expect(gate.getByRole('heading', { name: 'Enter API Key' })).toBeVisible()

  const input = gate.locator('input[placeholder="Enter your API key"]')
  await input.fill('test-key')
  await expect(input).toHaveValue('test-key')
})

// Test 2
test('hides gate and shows shell when key is valid', async ({ page }) => {
  await setSessionStorageKey(page, 'valid-test-api-key')
  await interceptWhoami(page, {
    status: 200,
    body: { auth: { role: 'user', queue_allowlist: [] } },
  })

  await page.goto('/')
  await expect(page.getByTestId('topbar')).toBeVisible()

  await expect(page.getByTestId('api-key-gate')).not.toBeVisible()
  await expect(page.getByTestId('logout-btn')).toBeVisible()
})

// Test 3
test('clears key and shows gate when key is invalid (401)', async ({ page }) => {
  await setSessionStorageKey(page, 'invalid-test-api-key')
  // default beforeEach already returns 401

  await page.goto('/')
  const gate = page.getByTestId('api-key-gate')
  await expect(gate).toBeVisible()

  const storedKey = await getSessionStorageKey(page)
  expect(storedKey).toBeNull()
})

// Test 4
test('preserves key and shows gate on network error', async ({ page }) => {
  await setSessionStorageKey(page, 'test-api-key-network-test')

  await page.unroute('**/v1/auth/whoami')
  await page.route('**/v1/auth/whoami', async (route) => {
    await route.abort('failed')
  })

  await page.goto('/')
  const gate = page.getByTestId('api-key-gate')
  await expect(gate).toBeVisible()

  const storedKey = await getSessionStorageKey(page)
  expect(storedKey).toBe('test-api-key-network-test')

  await expect(gate.getByText(/server unreachable|unable to verify/i)).toBeVisible()
})

// Test 5
test('validates API key through gate input', async ({ page }) => {
  await setSessionStorageKey(page, null)

  let whoamiCallCount = 0
  await page.unroute('**/v1/auth/whoami')
  await page.route('**/v1/auth/whoami', async (route) => {
    whoamiCallCount++
    const apiKey = route.request().headers()['x-api-key']

    if (apiKey === 'correct-key') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ auth: { role: 'user' } }),
      })
    }

    return route.fulfill({
      status: 401,
      contentType: 'application/json',
      body: JSON.stringify({ error: 'Invalid API key' }),
    })
  })

  await page.goto('/')

  const gate = page.getByTestId('api-key-gate')
  const input = gate.locator('input[placeholder="Enter your API key"]')
  const saveBtn = gate.getByRole('button', { name: 'Save' })

  await input.fill('wrong-key')
  await saveBtn.click()
  await expect(gate.getByText(/invalid api key/i)).toBeVisible()
  await expect(gate).toBeVisible()

  await input.fill('correct-key')
  await saveBtn.click()

  await expect(gate).not.toBeVisible()
  await expect(page.getByTestId('topbar')).toBeVisible()

  expect(whoamiCallCount).toBeGreaterThan(0)
})
