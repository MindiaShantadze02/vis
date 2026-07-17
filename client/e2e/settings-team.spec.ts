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

  test('a solo org can add a second bookable professional (seats unlimited)', async ({ page }) => {
    // Seats are unlimited on both tiers since 2026-07-17 (migration 088 set
    // tier_staff_limits null/null), so the seed solo org can add more than one
    // bookable professional — the old 1-seat block is gone.
    const first = tag('E2E Seat One')
    const second = tag('E2E Seat Two')

    async function addProfessional(name: string) {
      await page.getByTestId('add-professional-btn').click()
      await page.getByTestId('professional-name').fill(name)
      // professional-bookable defaults on, so both take a bookable seat.
      await page.getByTestId('professional-save').click()
    }

    await addProfessional(first)
    const firstRow = page.getByTestId('professional-row').filter({ hasText: first })
    await expect(firstRow).toBeVisible()

    // Second bookable professional is now accepted — no seat-limit error.
    await addProfessional(second)
    const secondRow = page.getByTestId('professional-row').filter({ hasText: second })
    await expect(secondRow).toBeVisible()
    await expect(page.getByTestId('team-error')).toHaveCount(0)

    // Self-clean both.
    await secondRow.getByTestId('professional-delete').click()
    await expect(page.getByText(second)).toHaveCount(0)
    await firstRow.getByTestId('professional-delete').click()
    await expect(page.getByText(first)).toHaveCount(0)
  })
})
