import { test, expect } from '@playwright/test'
import { login, tag } from './helpers'

test.describe('Settings — Team', () => {
  test.beforeEach(async ({ page }) => {
    await login(page)
    await page.goto('/dashboard/settings/team')
    await expect(page.getByTestId('add-professional-btn')).toBeVisible()
  })

  test('add a non-login professional, then delete it', async ({ page }) => {
    const name = tag('E2E Pro')
    await page.getByTestId('add-professional-btn').click()
    await page.getByTestId('professional-name').fill(name)
    await page.getByTestId('professional-title').fill('Barber')
    await page.getByTestId('professional-save').click()

    const row = page.getByTestId('professional-row').filter({ hasText: name })
    await expect(row).toBeVisible()

    // Self-clean
    await row.getByTestId('professional-delete').click()
    await expect(page.getByText(name)).toHaveCount(0)
  })

  test('invite an admin by phone, then cancel the invite', async ({ page }) => {
    const invitePhone = '577000111'
    await page.getByTestId('team-invite-btn').click()
    await page.getByTestId('invite-phone').fill(invitePhone)
    await page.getByTestId('invite-send').click()

    // The pending invitation appears with that phone.
    const inviteRow = page.getByText(invitePhone)
    await expect(inviteRow).toBeVisible()

    // Self-clean — cancel it.
    await page.getByTestId('invite-cancel').first().click()
    await expect(page.getByText(invitePhone)).toHaveCount(0)
  })

  // --- edge cases ---

  test('invite send is disabled until the phone is valid', async ({ page }) => {
    await page.getByTestId('team-invite-btn').click()
    const send = page.getByTestId('invite-send')
    await expect(send).toBeDisabled()                       // empty
    await page.getByTestId('invite-phone').fill('123')      // invalid
    await expect(send).toBeDisabled()
    await page.getByTestId('invite-phone').fill('577000222')  // valid
    await expect(send).toBeEnabled()
  })

  test('add-professional save is disabled until the name is long enough', async ({ page }) => {
    await page.getByTestId('add-professional-btn').click()
    const save = page.getByTestId('professional-save')
    await expect(save).toBeDisabled()                       // empty
    await page.getByTestId('professional-name').fill('A')   // too short
    await expect(save).toBeDisabled()
    await page.getByTestId('professional-name').fill('Ana')
    await expect(save).toBeEnabled()
    // Nothing submitted.
  })
})
