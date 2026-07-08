import { test, expect } from '@playwright/test'
import { login, fillStable } from '../helpers'
import data from '../data/services.json' with { type: 'json' }

const FIELD_TESTIDS: Record<string, string> = {
  name: 'service-name',
  duration: 'service-duration',
  price: 'service-price',
  capacity: 'service-max-per-slot',
}

/**
 * Data-driven save gating of the service editor (cases in
 * e2e/data/services.json — BVA on name/duration/price/capacity + pairwise
 * online × meeting-link). The dialog is filled with a valid base, each case
 * applies its deltas, asserts the save state, and restores the base. Nothing
 * is ever saved — the create/edit/delete flow in settings-services.spec.ts is
 * the representative submit.
 */
test.describe('Data-driven — Services', () => {
  test('save gating across all field boundaries and partitions', async ({ page }) => {
    await login(page)
    await page.goto('/dashboard/settings/services')
    await page.getByTestId('service-add').click()
    const save = page.getByTestId('service-save')

    // Valid base — sanity-check it enables save before iterating.
    for (const [field, value] of Object.entries(data.base)) {
      await fillStable(page.getByTestId(FIELD_TESTIDS[field]), value)
    }
    await expect(save).toBeEnabled()

    const onlineBtn = page.getByRole('button', { name: 'ონლაინ', exact: true })
    const inPersonBtn = page.getByRole('button', { name: 'ადგილზე', exact: true })
    // The meeting-link field only exists while the service is online.
    const meetingLink = page.locator('input[inputmode="url"]')

    for (const c of data.cases) {
      await test.step(`[${c.technique}] ${c.id} — ${c.note}`, async () => {
        const f = c.fields as { online?: boolean; link?: string } & Record<string, unknown>

        if (f.link !== undefined) {
          // The link can only be typed while online; for in-person × stale-link
          // we set it online first, then switch back.
          await onlineBtn.click()
          await fillStable(meetingLink, f.link)
          if (f.online === false) await inPersonBtn.click()
        } else if (f.online !== undefined) {
          await (f.online ? onlineBtn : inPersonBtn).click()
        }
        for (const [field, value] of Object.entries(c.fields)) {
          if (field === 'online' || field === 'link') continue
          await fillStable(page.getByTestId(FIELD_TESTIDS[field]), String(value))
        }

        if (c.valid) await expect(save).toBeEnabled()
        else await expect(save).toBeDisabled()

        // Restore the base for everything this case touched.
        if (f.online !== undefined || f.link !== undefined) await inPersonBtn.click()
        for (const field of Object.keys(c.fields)) {
          if (field === 'online' || field === 'link') continue
          await fillStable(
            page.getByTestId(FIELD_TESTIDS[field]),
            data.base[field as keyof typeof data.base],
          )
        }
      })
    }
    // Dialog is abandoned unsaved — no service created.
  })
})
