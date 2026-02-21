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
  await setSessionStorageKey(page, 'test-e2e-chat-key')
  await interceptWhoami(page, {
    status: 200,
    body: { auth: { role: 'admin', queue_allowlist: [] } },
  })

  // Mock /v1/jobs POST endpoint - return job ID
  await page.route('**/v1/jobs', async (route) => {
    if (route.request().method() === 'POST') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ id: 'job_1' }),
      })
      return
    }
    // Let other /v1/jobs requests fall through to default handler
    route.fallback()
  })

  // Mock /v1/jobs/:id GET endpoint
  // Use a timing-based approach: first request within 500ms of test start = running
  // All subsequent requests = succeeded
  const testStartTime = Date.now()
  let requestCount = 0

  await page.route('**/v1/jobs/job_1', async (route) => {
    requestCount++
    const elapsed = Date.now() - testStartTime

    // First request = running, rest = succeeded
    if (requestCount === 1) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          job: {
            id: 'job_1',
            type: 'ai.chat.generate',
            status: 'running',
            queue: 'default',
            priority: 5,
            timeout_sec: 60,
            attempts: 1,
            max_attempts: 3,
            callback_url: null,
            tags: ['chat'],
            input: { prompt: 'hello' },
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
            id: 'job_1',
            type: 'ai.chat.generate',
            status: 'succeeded',
            queue: 'default',
            priority: 5,
            timeout_sec: 60,
            attempts: 1,
            max_attempts: 3,
            callback_url: null,
            tags: ['chat'],
            input: { prompt: 'hello' },
            result: { output_text: 'hello from job' },
            error: null,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          },
        }),
      })
    }
  })
})

test('chat: sends message and receives response', async ({ page }) => {
  await page.goto('/projects/yleischat/chat')

  // Page should be visible
  await expect(page.getByTestId('project-chat-page')).toBeVisible()

  // Chat input should be visible and enabled
  const chatInput = page.getByTestId('chat-input')
  await expect(chatInput).toBeVisible()
  await expect(chatInput).toBeEnabled()

  // Send button should be visible
  const sendButton = page.getByTestId('chat-send')
  await expect(sendButton).toBeVisible()

  // Type a message
  await chatInput.fill('hello')

  // Send button should now be enabled
  await expect(sendButton).toBeEnabled()

  // Click send
  await sendButton.click()

  // User message should appear
  await expect(page.getByTestId('chat-msg-user')).toBeVisible()
  await expect(page.getByTestId('chat-msg-user')).toContainText('hello')

  // Pending indicator should be visible briefly
  await expect(page.getByTestId('chat-assistant-pending')).toBeVisible()

  // Assistant response should eventually appear (may take a couple seconds due to polling interval)
  await expect(page.getByTestId('chat-msg-assistant')).toBeVisible()
  await expect(page.getByTestId('chat-msg-assistant')).toContainText('hello from job', { timeout: 10000 })

  // Pending indicator should be gone
  await expect(page.getByTestId('chat-assistant-pending')).not.toBeVisible()
})

test('chat: disables input while pending', async ({ page }) => {
  await page.goto('/projects/yleischat/chat')

  const chatInput = page.getByTestId('chat-input')
  const sendButton = page.getByTestId('chat-send')

  // Type and send first message
  await chatInput.fill('test message')
  await sendButton.click()

  // Wait for pending state
  await expect(page.getByTestId('chat-assistant-pending')).toBeVisible()

  // Input should be disabled while pending
  await expect(chatInput).toBeDisabled()

  // Send button should be disabled
  await expect(sendButton).toBeDisabled()

  // Wait for completion (may take a couple seconds due to polling interval)
  await expect(page.getByTestId('chat-msg-assistant')).toContainText('hello from job', { timeout: 10000 })

  // Input should be re-enabled after completion
  await expect(chatInput).toBeEnabled({ timeout: 5000 })
})

test('chat: shows empty state initially', async ({ page }) => {
  // Clear any existing localStorage for this test
  await page.addInitScript(() => {
    localStorage.removeItem('oc_chat_v1')
  })

  await page.goto('/projects/yleischat/chat')

  // Timeline should be visible
  await expect(page.getByTestId('chat-timeline')).toBeVisible()

  // No messages should exist
  await expect(page.getByTestId('chat-msg-user')).not.toBeVisible()
  await expect(page.getByTestId('chat-msg-assistant')).not.toBeVisible()

  // Empty state should be visible (check for the icon text)
  await expect(page.getByText('Start a conversation')).toBeVisible()
})

test('chat: sends message on Enter key', async ({ page }) => {
  await page.goto('/projects/yleischat/chat')

  const chatInput = page.getByTestId('chat-input')

  // Type and press Enter
  await chatInput.fill('enter test')
  await chatInput.press('Enter')

  // User message should appear
  await expect(page.getByTestId('chat-msg-user')).toBeVisible()
  await expect(page.getByTestId('chat-msg-user')).toContainText('enter test')

  // Assistant response should appear
  await expect(page.getByTestId('chat-msg-assistant')).toContainText('hello from job', { timeout: 10000 })
})

test('chat: allows multiline with Shift+Enter', async ({ page }) => {
  await page.goto('/projects/yleischat/chat')

  const chatInput = page.getByTestId('chat-input')

  // Type first line
  await chatInput.fill('line 1')

  // Press Shift+Enter to add new line
  await chatInput.press('Shift+Enter')

  // Type second line
  await chatInput.type('line 2')

  // Input should contain both lines
  await expect(chatInput).toHaveValue(/line 1\nline 2/)

  // No message should be sent yet
  await expect(page.getByTestId('chat-msg-user')).not.toBeVisible()

  // Now press Enter to send
  await chatInput.press('Enter')

  // Message should be sent
  await expect(page.getByTestId('chat-msg-user')).toBeVisible()
})
