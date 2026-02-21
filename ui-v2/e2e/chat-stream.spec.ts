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

test.beforeEach(async ({ page }) => {
  // Close inspector panel to avoid blocking clicks
  await page.addInitScript(() => {
    localStorage.setItem('rauskuclaw-ui-v2', JSON.stringify({
      devMode: false,
      sidebarCollapsed: false,
      inspectorOpen: false,
    }))
  })

  // Set up authentication (valid API key)
  await setSessionStorageKey(page, 'test-e2e-chat-stream-key')
  await interceptWhoami(page, {
    status: 200,
    body: { auth: { role: 'admin', queue_allowlist: [] } },
  })

  // Mock POST /v1/jobs - return job ID
  await page.route('**/v1/jobs', async (route) => {
    if (route.request().method() === 'POST') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ id: 'job_stream_1' }),
      })
      return
    }
    route.fallback()
  })

  // Mock GET /v1/jobs/:id/stream - return 404 (triggers fallback)
  await page.route('**/v1/jobs/*/stream', async (route) => {
    await route.fulfill({
      status: 404,
      contentType: 'application/json',
      body: JSON.stringify({ ok: false, error: { code: 'NOT_FOUND', message: 'Stream not found' } }),
    })
  })

  // Mock GET /v1/jobs/:id for polling fallback
  const testStartTime = Date.now()
  let requestCount = 0

  await page.route('**/v1/jobs/job_stream_1', async (route) => {
    requestCount++
    const elapsed = Date.now() - testStartTime

    // First request = running, rest = succeeded
    if (requestCount === 1) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          job: {
            id: 'job_stream_1',
            type: 'ai.chat.generate',
            status: 'running',
            queue: 'default',
            priority: 5,
            timeout_sec: 60,
            attempts: 1,
            max_attempts: 3,
            callback_url: null,
            tags: ['chat'],
            input: { prompt: 'stream test' },
            result: null,
            error: null,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          },
        }),
      })
    } else {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          job: {
            id: 'job_stream_1',
            type: 'ai.chat.generate',
            status: 'succeeded',
            queue: 'default',
            priority: 5,
            timeout_sec: 60,
            attempts: 1,
            max_attempts: 3,
            callback_url: null,
            tags: ['chat'],
            input: { prompt: 'stream test' },
            result: { output_text: 'fallback response from polling' },
            error: null,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          },
        }),
      })
    }
  })
})

test('chat: falls back to polling when stream fails', async ({ page }) => {
  await page.goto('/projects/yleischat/chat')

  const chatInput = page.getByTestId('chat-input')
  const sendButton = page.getByTestId('chat-send')

  // Send message
  await chatInput.fill('stream test')
  await sendButton.click()

  // User message appears
  await expect(page.getByTestId('chat-msg-user')).toBeVisible()
  await expect(page.getByTestId('chat-msg-user')).toContainText('stream test')

  // Should transition from pending to success via polling
  await expect(page.getByTestId('chat-msg-assistant')).toBeVisible()
  await expect(page.getByTestId('chat-msg-assistant')).toContainText('fallback response from polling', { timeout: 15000 })

  // No pending indicator after completion
  await expect(page.getByTestId('chat-assistant-pending')).not.toBeVisible()
})

test('chat: handles stream timeout gracefully', async ({ page }) => {
  // Override stream to hang (timeout scenario)
  await page.route('**/v1/jobs/*/stream', async (route) => {
    // Never respond - triggers 3s timeout
    // EventSource will timeout and fall back to polling
  })

  await page.goto('/projects/yleischat/chat')

  const chatInput = page.getByTestId('chat-input')
  await chatInput.fill('timeout test')
  await page.getByTestId('chat-send').click()

  // Should eventually complete via polling after stream timeout
  await expect(page.getByTestId('chat-msg-assistant')).toContainText('fallback response from polling', { timeout: 20000 })
})

test('chat: streaming status transitions to success', async ({ page }) => {
  await page.goto('/projects/yleischat/chat')

  const chatInput = page.getByTestId('chat-input')
  const sendButton = page.getByTestId('chat-send')

  // Send message
  await chatInput.fill('status test')
  await sendButton.click()

  // Assistant message should appear (with pending initially, then success)
  await expect(page.getByTestId('chat-msg-assistant')).toBeVisible()

  // After completion, should not have streaming status (stream failed, fell back to polling)
  await expect(page.getByTestId('chat-msg-assistant')).toContainText('fallback response from polling', { timeout: 15000 })

  // Verify final state is success (not streaming or pending)
  await expect(page.getByTestId('chat-assistant-pending')).not.toBeVisible()
})
