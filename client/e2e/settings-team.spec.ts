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

    // The pending invitation appears with that phone. exact:true — the send
    // snackbar ("მოწვევა შექმნილია ნომრისთვის <phone>") also contains the
    // phone and would trip strict mode.
    const inviteRow = page.getByText(invitePhone, { exact: true })
    await expect(inviteRow).toBeVisible()

    // Self-clean — cancel it.
    await page.getByTestId('invite-cancel').first().click()
    await expect(page.getByText(invitePhone, { exact: true })).toHaveCount(0)
  })

  // Invite-phone and professional-name gating are data-driven now — see
  // e2e/data/team.json + e2e/data-driven/team.spec.ts.

  test('the starter seat limit blocks a second bookable professional', async ({ page }) => {
    // The seed org is on starter (1 bookable seat, enforce_staff_limit trigger).
    const first = tag('E2E Seat One')
    const second = tag('E2E Seat Two')

    async function addProfessional(name: string) {
      await page.getByTestId('add-professional-btn').click()
      await page.getByTestId('professional-name').fill(name)
      await page.getByTestId('professional-save').click()
    }

    // First bookable professional fits the seat.
    await addProfessional(first)
    const row = page.getByTestId('professional-row').filter({ hasText: first })
    await expect(row).toBeVisible()

    // Second is rejected by the DB trigger → friendly upgrade prompt, no row.
    await addProfessional(second)
    await expect(page.getByTestId('team-error')).toBeVisible()
    await expect(page.getByText(second)).toHaveCount(0)

    // Self-clean
    await row.getByTestId('professional-delete').click()
    await expect(page.getByText(first)).toHaveCount(0)
  })
})
