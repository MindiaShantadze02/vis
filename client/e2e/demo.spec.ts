import { test, expect } from '@playwright/test';
import path from 'path';
import { fileURLToPath } from 'url';
import { passBookingOtp } from './helpers';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const generateRandomDigit = (): number => {
    return Math.floor(Math.random() * 10);
}

const generateRandomPhoneNumber = (): string => {
    let result: string = "555";

    for (let i = 0; i < 6; i++) {
        const randomDigit: number = generateRandomDigit();
        result += randomDigit;
    }

    return result;
}

const generateRandomEmail = (): string => {
    let base = 'demoemail';

    for (let i: number = 0; i < 5; i++) {
        base += generateRandomDigit();
    }

    return base + '@gmail.com'
}


test('E2E demo of the app', async ({ page }) => {
    // The whole signup → onboarding → booking run at slowMo, in one test.
    test.setTimeout(600_000);

    // Go to register form
    await page.goto('http://localhost:5173/register');

    // Fill out registration details
    await page.getByTestId('login-phone').fill(generateRandomPhoneNumber());
    await page.getByTestId('login-password').fill('demo12345');
    await page.getByTestId('login-confirm-password').fill('demo12345');
    await page.getByTestId('register-consent').check();
    await page.getByTestId('login-submit').click();

    // Fill out and submit OTP
    await page.getByTestId('auth-otp-code').fill('000000');
    // await page.getByTestId('auth-otp-verify').click();

    // Fill out business details
    await page.getByTestId('biz-name').fill("Demo Barbershop");
    await page.getByTestId('biz-description').fill(`Established in 2018, Demo Barbershop brings classic grooming traditions back to the neighborhood. We specialize in precision scissor cuts, sharp fades, and traditional hot-towel shaves. Step into a timeless space where every cut is tailored, every detail matters, and every client leaves looking clean and refined. Sit back, relax, and let our master barbers elevate your everyday routine.
555555555`);
    await page.getByTestId('biz-email').fill(generateRandomEmail());
    await page.getByTestId('biz-next').click();

    // Add Services
    await page.getByTestId('onb-service-name').fill('თმის შეჭრა');
    await page.getByTestId('onb-service-duration').fill('20');
    await page.getByTestId('onb-service-price').fill('30');
    const fileChooserPromise1 = page.waitForEvent('filechooser');
    await page.getByTestId('service-image-add').click();
    const fileChooser1 = await fileChooserPromise1;
    await fileChooser1.setFiles(path.join(__dirname, 'images', 'demo1.jpg'));
    await page.getByTestId('onb-service-save').click();

    await page.getByTestId('onb-service-name').fill('წვერის გაპარსვა');
    await page.getByTestId('onb-service-duration').fill('20');
    await page.getByTestId('onb-service-price').fill('20');
    const fileChooserPromise2 = page.waitForEvent('filechooser');
    await page.getByTestId('service-image-add').click();
    const fileChooser2 = await fileChooserPromise2;
    await fileChooser2.setFiles(path.join(__dirname, 'images', 'demo2.jpg'));
    await page.getByTestId('onb-service-save').click();

    await page.getByTestId('onb-services-next').click();

    // Add specialists, bookable for both services
    const serviceChips = page.getByTestId('onb-specialist-service-chip');

    await page.getByTestId('onb-specialist-name').fill('გიორგი');
    await page.getByTestId('onb-specialist-title').fill('ბარბერი');
    await serviceChips.nth(0).click();
    await serviceChips.nth(1).click();
    await page.getByTestId('onb-specialist-save').click();

    await page.getByTestId('onb-specialist-name').fill('ლევანი');
    await page.getByTestId('onb-specialist-title').fill('ბარბერი');
    await serviceChips.nth(0).click();
    await serviceChips.nth(1).click();
    await page.getByTestId('onb-specialist-save').click();

    await page.getByTestId('onb-specialists-next').click();

    // Working hours — keep the defaults and create the business
    await page.getByTestId('hours-finish').click();

    // Dashboard — the booking link is shown as vis.ge/book/<slug>; swap the
    // hard-coded production domain for whatever domain this run is on.
    await expect(page).toHaveURL(/\/dashboard/, { timeout: 20_000 });
    const bookingLink = page.getByText(/vis\.ge\/book\//).first();
    await expect(bookingLink).toBeVisible();
    const linkText = (await bookingLink.innerText()).trim();
    const origin = new URL(page.url()).origin;
    const bookingUrl = origin + linkText.replace('vis.ge', '');

    // Book an appointment as a customer
    await page.goto(bookingUrl);

    // Pick the service, then the specialist
    await page.getByTestId('book-service').first().click();
    await page.getByTestId('book-staff').last().click();

    // Walk the week strip until a day has a free slot, and take the first one
    const days = page.locator('[data-testid^="book-day-"][data-disabled="false"]');
    await expect(days.first()).toBeVisible();
    for (let i = 0, n = await days.count(); i < n; i++) {
        await days.nth(i).click();
        const slot = page.getByTestId('book-slot').first();
        const free = await slot.waitFor({ state: 'visible', timeout: 5_000 }).then(() => true).catch(() => false);
        if (free) {
            await slot.click();
            break;
        }
    }

    // Fill out the customer details and pay on site
    await page.getByTestId('book-first-name').fill('ნიკა');
    await page.getByTestId('book-last-name').fill('აბაშიძე');
    await page.getByTestId('book-phone').fill(generateRandomPhoneNumber());
    await page.getByTestId('book-pay-on-site').click();
    await page.getByTestId('book-consent').locator('input').check();
    await page.getByTestId('book-submit').click();

    // Fill out and submit the booking OTP — a no-op unless the org bought the
    // SMS add-on, which a freshly onboarded one has not.
    await passBookingOtp(page);
    await expect(page).toHaveURL(/\/booking-confirmation\//, { timeout: 30_000 });

    // Back on the owner's dashboard, the new appointment is there
    await page.goto(origin + '/dashboard');
    await expect(page.getByTestId('appt-row').first()).toBeVisible({ timeout: 20_000 });
})
