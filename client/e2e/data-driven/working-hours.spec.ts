import { test, expect } from '@playwright/test'
import { login, fillStable } from '../helpers'
import data from '../data/working-hours.json' with { type: 'json' }

/**
 * Data-driven working-hours validation (cases in e2e/data/working-hours.json).
 * Invalid advance-window values and broken day schedules are blocked before any
 * DB write; the two valid advance boundaries REALLY save and are restored to
 * the original value afterwards (self-cleaning submit — the only rows in the
 * data-driven suite that persist).
 */
test.describe('Data-driven — Working hours', () => {
  test.beforeEach(async ({ page }) => {
    await login(page)
    await page.goto('/dashboard/settings/hours')
    await expect(page.getByTestId('wh-save')).toBeVisible()
  })

  test('advance-booking window BVA (invalid blocked; boundaries saved and restored)', async ({ page }) => {
    const max = page.getByTestId('wh-max-advance')
    const save = page.getByTestId('wh-save')
    const error = page.getByTestId('wh-error')
    const original = await max.inputValue()

    for (const c of data.advanceCases.filter(c => !c.valid)) {
      await test.step(`[${c.technique}] ${c.id} — ${c.note}`, async () => {
        await fillStable(max, c.value)
        await save.click()
        // The field flags itself inline (helperText carries the 1–730 rule).
        await expect(max).toHaveAttribute('aria-invalid', 'true')
        await expect(page.getByText('1–730')).toBeVisible()
      })
    }

    // Valid boundaries: persist (wait for the saved-toast — the write is
    // async), verify across a reload, then restore. The reload also clears the
    // toast so the next iteration can't match a stale one.
    for (const c of data.advanceCases.filter(c => c.valid && c.submit)) {
      await test.step(`[${c.technique}] ${c.id} — ${c.note}`, async () => {
        await fillStable(max, c.value)
        await save.click()
        await expect(error).toHaveCount(0)
        await expect(page.getByText('ცვლილებები შენახულია')).toBeVisible({ timeout: 20_000 })
        await page.reload()
        await expect(page.getByTestId('wh-max-advance')).toHaveValue(c.value, { timeout: 20_000 })
      })
    }

    await test.step(`restore original advance window ('${original}')`, async () => {
      await fillStable(page.getByTestId('wh-max-advance'), original)
      await page.getByTestId('wh-save').click()
      await expect(page.getByTestId('wh-error')).toHaveCount(0)
      await expect(page.getByText('ცვლილებები შენახულია')).toBeVisible({ timeout: 20_000 })
      await page.reload()
      await expect(page.getByTestId('wh-max-advance')).toHaveValue(original, { timeout: 20_000 })
    })
  })

  test('day-schedule decision table (endBeforeStart / breakOutsideHours / rangeOverlap)', async ({ page }) => {
    for (const c of data.scheduleCases) {
      await test.step(`[${c.technique}] ${c.id} — ${c.note}`, async () => {
        // Fresh load per case — blocked saves persist nothing, so a reload
        // resets the local edits from the previous case.
        await page.goto('/dashboard/settings/hours')
        const open = page.getByTestId('wh-monday-open')
        await expect(open).toBeVisible()
        await open.fill(c.open)
        await page.getByTestId('wh-monday-close').fill(c.close)

        // Breaks have no testids: the seed schedule has none, so after adding
        // breaks on Monday every non-testid time input on the page is a break
        // field (pairs of start/end in order).
        for (let i = 0; i < c.breaks.length; i++) {
          await page.getByRole('button', { name: 'შესვენების დამატება' }).first().click()
        }
        const breakInputs = page.locator('input[type="time"]:not([data-testid])')
        await expect(breakInputs).toHaveCount(c.breaks.length * 2)
        for (let i = 0; i < c.breaks.length; i++) {
          await breakInputs.nth(i * 2).fill(c.breaks[i][0])
          await breakInputs.nth(i * 2 + 1).fill(c.breaks[i][1])
        }

        await page.getByTestId('wh-save').click()
        // The offending time fields flag themselves inline; the issue text
        // appears as a field helperText instead of a banner.
        await expect(page.locator('[aria-invalid="true"]').first()).toBeVisible()
        await expect(page.getByText(c.errorText).first()).toBeVisible()
        // Save was blocked — nothing persisted.
      })
    }

    const clamp = data.breakClampCase
    await test.step(`[${clamp.technique}] ${clamp.id} — ${clamp.note}`, async () => {
      // breakOutsideHours can't be produced through the UI: break times are
      // clamped into the working window on input. Assert the clamp itself; the
      // validator branch is covered logically in consistency.spec.ts.
      await page.goto('/dashboard/settings/hours')
      await expect(page.getByTestId('wh-monday-open')).toBeVisible()
      await page.getByRole('button', { name: 'შესვენების დამატება' }).first().click()
      const breakStart = page.locator('input[type="time"]:not([data-testid])').first()
      await breakStart.fill(clamp.type)
      await expect(breakStart).toHaveValue(clamp.expectValue)
      // Nothing saved — local state only.
    })
  })
})
