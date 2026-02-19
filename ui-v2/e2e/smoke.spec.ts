import { test, expect, Page } from '@playwright/test'

/**
 * Smoke tests for RauskuClaw UI
 * Tests use network interception - no backend required
 */

const SESSION_STORAGE_KEY = 'rauskuclaw_api_key'

/**
 * Helper to set sessionStorage before page load
 */
async function setSessionStorageKey(page: Page, key: string | null) {
  await page.addInitScript((args) => {
    const { key, value } = args
    if (value === null) {
      sessionStorage.removeItem(key)
    } else {
      sessionStorage.setItem(key, value)
    }
  }, { key: SESSION_STORAGE_KEY, value: key })
}

/**
 * Helper to intercept whoami requests
 */
async function interceptWhoami(page: Page, response: { status: number; body: unknown }) {
  await page.route('**/v1/auth/whoami', async (route) => {
    await route.fulfill({
      status: response.status,
      contentType: 'application/json',
      body: JSON.stringify(response.body),
    })
  })
}

/**
 * Helper to check if session key exists
 */
async function getSessionStorageKey(page: Page): Promise<string | null> {
  return page.evaluate((key) => sessionStorage.getItem(key), SESSION_STORAGE_KEY)
}

// ============================================
// Test 1: No key => Gate visible
// ============================================
test('shows API key gate when no key is stored', async ({ page }) => {
  // Clear storage before navigation
  await setSessionStorageKey(page, null)
  
  // Navigate to app
  await page.goto('/')
  
  // Wait for app to bootstrap
  await page.waitForSelector('[data-testid="api-key-gate"]', { timeout: 10000 })
  
  // Assert gate is visible
  const gate = page.getByTestId('api-key-gate')
  await expect(gate).toBeVisible()
  
  // Assert the gate contains the expected content
  await expect(gate.getByRole('heading', { name: 'Enter API Key' })).toBeVisible()
  
  // Assert input is present and can receive input
  const input = gate.locator('input[placeholder="Enter your API key"]')
  await expect(input).toBeVisible()
  await input.fill('test-key')
  await expect(input).toHaveValue('test-key')
})

// ============================================
// Test 2: Valid key => Gate hidden + shell visible
// ============================================
test('hides gate and shows shell when key is valid', async ({ page }) => {
  // Set a stored key
  await setSessionStorageKey(page, 'valid-test-api-key')
  
  // Intercept whoami to return success
  await interceptWhoami(page, {
    status: 200,
    body: { auth: { role: 'user', queue_allowlist: [] } },
  })
  
  // Navigate to app
  await page.goto('/')
  
  // Wait for topbar to appear (authenticated state)
  await page.waitForSelector('[data-testid="topbar"]', { timeout: 10000 })
  
  // Assert gate is NOT visible
  const gate = page.getByTestId('api-key-gate')
  await expect(gate).not.toBeVisible()
  
  // Assert topbar is visible (shell rendered)
  const topbar = page.getByTestId('topbar')
  await expect(topbar).toBeVisible()
  
  // Assert logout button is visible (authenticated-only element)
  const logoutBtn = page.getByTestId('logout-btn')
  await expect(logoutBtn).toBeVisible()
})

// ============================================
// Test 3: Invalid key => Key cleared + Gate visible
// ============================================
test('clears key and shows gate when key is invalid (401)', async ({ page }) => {
  // Set a stored key that will be rejected
  await setSessionStorageKey(page, 'invalid-test-api-key')
  
  // Intercept whoami to return 401
  await interceptWhoami(page, {
    status: 401,
    body: { error: 'Unauthorized' },
  })
  
  // Navigate to app
  await page.goto('/')
  
  // Wait for gate to appear (invalid state)
  await page.waitForSelector('[data-testid="api-key-gate"]', { timeout: 10000 })
  
  // Assert gate is visible
  const gate = page.getByTestId('api-key-gate')
  await expect(gate).toBeVisible()
  
  // Assert the session key was cleared
  const storedKey = await getSessionStorageKey(page)
  expect(storedKey).toBeNull()
})

// ============================================
// Test 4: Network error preserves key, shows gate
// ============================================
test('preserves key and shows gate on network error', async ({ page }) => {
  // Set a stored key
  await setSessionStorageKey(page, 'test-api-key-network-test')
  
  // Intercept whoami to simulate network failure
  await page.route('**/v1/auth/whoami', async (route) => {
    await route.abort('failed')
  })
  
  // Navigate to app
  await page.goto('/')
  
  // Wait for gate to appear
  await page.waitForSelector('[data-testid="api-key-gate"]', { timeout: 10000 })
  
  // Assert gate is visible
  const gate = page.getByTestId('api-key-gate')
  await expect(gate).toBeVisible()
  
  // Assert the session key is STILL present (not cleared on network error)
  const storedKey = await getSessionStorageKey(page)
  expect(storedKey).toBe('test-api-key-network-test')
  
  // Assert error message mentions server unreachable
  await expect(gate.getByText(/server unreachable|Unable to verify/i)).toBeVisible()
})

// ============================================
// Test 5: Gate input validation works
// ============================================
test('validates API key through gate input', async ({ page }) => {
  // Start with no key
  await setSessionStorageKey(page, null)
  
  // Intercept whoami for validation
  let whoamiCallCount = 0
  await page.route('**/v1/auth/whoami', async (route) => {
    whoamiCallCount++
    const request = route.request()
    
    // Check for the API key header
    const apiKey = request.headers()['x-api-key']
    
    if (apiKey === 'correct-key') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ auth: { role: 'user' } }),
      })
    } else {
      await route.fulfill({
        status: 401,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'Invalid API key' }),
      })
    }
  })
  
  // Navigate to app
  await page.goto('/')
  
  // Wait for gate
  await page.waitForSelector('[data-testid="api-key-gate"]', { timeout: 10000 })
  
  const gate = page.getByTestId('api-key-gate')
  const input = gate.locator('input[placeholder="Enter your API key"]')
  const saveBtn = gate.getByRole('button', { name: 'Save' })
  
  // Try with wrong key
  await input.fill('wrong-key')
  await saveBtn.click()
  
  // Wait for validation to complete
  await page.waitForTimeout(500)
  
  // Should show error
  await expect(gate.getByText('Invalid API key')).toBeVisible()
  
  // Gate should still be visible
  await expect(gate).toBeVisible()
  
  // Now try with correct key
  await input.clear()
  await input.fill('correct-key')
  await saveBtn.click()
  
  // Wait for gate to disappear (successful auth)
  await expect(gate).not.toBeVisible({ timeout: 5000 })
  
  // Should show authenticated UI
  await expect(page.getByTestId('topbar')).toBeVisible()
  await expect(page.getByTestId('logout-btn')).toBeVisible()
})