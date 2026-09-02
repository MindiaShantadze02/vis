import { test, expect, type Locator, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { brandOrg, passBookingOtp, uniquePhone } from './helpers';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Marketing screencasts, not assertions. One test per vertical, each recorded by
 * Playwright (`video: 'on'` + `slowMo: 1000` in playwright.config.ts) as an
 * uninterrupted signup → onboarding → branded booking page → confirmed
 * appointment run. Film one with:
 *
 *     npx playwright test e2e/demo.spec.ts --grep dental
 *
 * Everything that differs between verticals — copy, services, staff, photos,
 * brand colour — lives in e2e/data/demo-verticals.json, and the photos live in
 * e2e/images/<imageDir>/ (see that folder's CREDITS.md). To add a vertical, add
 * a fixture entry and a photo folder; this file shouldn't need to change.
 *
 * NOTE: each run creates a REAL org, user and booking on the hosted project —
 * see e2e/README.md for how to prune them afterwards.
 */

interface DemoService { name: string; duration: string; price: string; image: string }
interface DemoStaff { name: string; title: string; photo: string; services: number[] }
interface DemoVertical {
    key: string
    imageDir: string
    /** Custom brand colour (#RRGGBB), or null to keep the default booking theme. */
    themeHex: string | null
    org: { name: string; description: string; address: string }
    services: DemoService[]
    staff: DemoStaff[]
    customer: { firstName: string; lastName: string }
}

const VERTICALS: DemoVertical[] = JSON.parse(
    readFileSync(path.join(__dirname, 'data', 'demo-verticals.json'), 'utf8'),
);

/** Gitignored scratch space at the repo root, where the takes and stills land. */
const DEMOS_DIR = path.join(__dirname, '..', '..', 'demos');

const generateRandomEmail = (): string =>
    `demoemail${Math.floor(Math.random() * 100_000)}@gmail.com`;

/**
 * A held pause. `slowMo` spaces the *actions* out evenly, which is fine for
 * clicking through a form but leaves no room to actually look at the result —
 * so the moments worth reading (a finished booking page, the confirmation) get
 * an explicit beat on top.
 */
async function beat(page: Page, ms = 1400): Promise<void> {
    await page.waitForTimeout(ms);
}

/**
 * Scroll the window to `y` over `ms`, eased. Native `scrollTo` teleports and
 * `behavior: 'smooth'` runs at a fixed browser-chosen speed; neither reads as a
 * person on camera. easeInOutCubic accelerates, cruises, and settles, which is
 * roughly what a hand on a trackpad does.
 *
 * `y` is clamped to the document, so 1e9 means "the bottom" and a short page is
 * a no-op rather than an error.
 */
async function smoothScrollTo(page: Page, y: number, ms = 1600): Promise<void> {
    await page.evaluate(
        ({ y, ms }) =>
            new Promise<void>(resolve => {
                const doc = document.documentElement;
                const max = Math.max(0, doc.scrollHeight - window.innerHeight);
                const from = window.scrollY;
                const to = Math.max(0, Math.min(y, max));
                const dist = to - from;
                // Nothing worth animating — don't burn a second on a 10px nudge.
                if (Math.abs(dist) < 24) return resolve();
                const t0 = performance.now();
                const step = (now: number) => {
                    const p = Math.min(1, (now - t0) / ms);
                    const e = p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2;
                    window.scrollTo(0, from + dist * e);
                    if (p < 1) requestAnimationFrame(step);
                    else resolve();
                };
                requestAnimationFrame(step);
            }),
        { y, ms },
    );
}

/**
 * Read the page top to bottom and come back, the way someone deciding whether to
 * book would. Also the thing that makes the whole page's imagery show up in the
 * footage instead of only whatever is above the fold.
 */
async function scrollTour(page: Page): Promise<void> {
    await smoothScrollTo(page, 1e9, 2600);
    await beat(page, 1200);
    await smoothScrollTo(page, 0, 2000);
    await beat(page, 900);
}

/**
 * Bring an element into view *ourselves*, then click it.
 *
 * Playwright scrolls a target into view before clicking, but it does so in one
 * instant jump — the single most jarring thing in the old recordings. Easing it
 * into the middle of the viewport first means Playwright's own scroll finds
 * nothing left to do.
 */
async function revealAndClick(page: Page, locator: Locator, ms = 1100): Promise<void> {
    await locator.waitFor({ state: 'visible' });
    const box = await locator.boundingBox();
    if (box) {
        const centre = await page.evaluate(
            ({ top, height }) => window.scrollY + top + height / 2 - window.innerHeight / 2,
            { top: box.y, height: box.height },
        );
        await smoothScrollTo(page, centre, ms);
    }
    await locator.click();
}

/**
 * Hold until every image on the page has actually decoded. SkeletonImage keeps
 * the <img> at opacity 0 behind a pulsing skeleton until then, and its banners
 * are `loading="lazy"`, so without this the demo films a page of grey boxes and
 * the still comes out blank. Eases to the bottom to trigger the lazy ones, then
 * back to the top — the scroll is on camera, so it doubles as the page tour.
 *
 * Supabase's image-transform endpoint occasionally errors on an object uploaded
 * seconds earlier, so a straggler gets one page reload before we give up. And
 * giving up only warns: this is a screencast, and losing the whole take over one
 * slow banner is worse than filming it. Watch the run output — a warning means
 * that vertical is worth re-recording.
 */
async function waitForImages(page: Page, timeout = 20_000): Promise<void> {
    const settle = async (): Promise<string[]> => {
        await smoothScrollTo(page, 1e9, 1800);
        const deadline = Date.now() + timeout;
        let pending: string[] = [];
        do {
            pending = await page.evaluate(() =>
                Array.from(document.images)
                    .filter(img => !img.complete || img.naturalWidth === 0)
                    .map(img => img.currentSrc || img.src),
            );
            if (!pending.length) break;
            await page.waitForTimeout(250);
        } while (Date.now() < deadline);
        await smoothScrollTo(page, 0, 1400);
        return pending;
    };

    let pending = await settle();
    if (pending.length) {
        await page.reload();
        pending = await settle();
    }
    if (pending.length) {
        console.warn(`[demo] images never loaded — re-record this vertical:\n${pending.join('\n')}`);
    }
}

for (const v of VERTICALS) {
    test(`E2E demo of the app — ${v.key}`, async ({ page }) => {
        // The whole signup → onboarding → booking run at demo pacing, in one
        // test. Generous: DEMO_SLOW_MO is turned up for filming, and the eased
        // scrolls and held beats are deliberately unhurried.
        test.setTimeout(900_000);

        const image = (file: string) => path.join(__dirname, 'images', v.imageDir, file);

        // Go to register form
        await page.goto('http://localhost:5173/register');

        // Fill out registration details
        await page.getByTestId('login-phone').fill(uniquePhone());
        await page.getByTestId('login-password').fill('demo12345');
        await page.getByTestId('login-confirm-password').fill('demo12345');
        await page.getByTestId('register-consent').check();
        await page.getByTestId('login-submit').click();

        // Fill out and submit OTP — the form auto-submits once six digits land.
        await page.getByTestId('auth-otp-code').fill('000000');

        // Fill out business details, logo included: without it the booking
        // sidebar falls back to a letter avatar, which looks unfinished on camera.
        // The logo/photo inputs are display:none behind their own buttons, so
        // they take setInputFiles directly; the service picker is a real button
        // and still needs the file chooser.
        await page.getByTestId('biz-logo-input').setInputFiles(image('logo.png'));
        await page.getByTestId('biz-name').fill(v.org.name);
        await page.getByTestId('biz-description').fill(v.org.description);
        await page.getByTestId('biz-email').fill(generateRandomEmail());
        await beat(page);
        await revealAndClick(page, page.getByTestId('biz-next'));

        // Add services, each with its photo
        for (const s of v.services) {
            await page.getByTestId('onb-service-name').fill(s.name);
            await page.getByTestId('onb-service-duration').fill(s.duration);
            await page.getByTestId('onb-service-price').fill(s.price);
            const serviceChooser = page.waitForEvent('filechooser');
            await page.getByTestId('service-image-add').click();
            await (await serviceChooser).setFiles(image(s.image));
            await revealAndClick(page, page.getByTestId('onb-service-save'));
        }

        await beat(page);
        await revealAndClick(page, page.getByTestId('onb-services-next'));

        // Add specialists, with photos, bookable for the services they cover
        const serviceChips = page.getByTestId('onb-specialist-service-chip');

        for (const s of v.staff) {
            await page.getByTestId('onb-specialist-photo-input').setInputFiles(image(s.photo));
            await page.getByTestId('onb-specialist-name').fill(s.name);
            await page.getByTestId('onb-specialist-title').fill(s.title);
            for (const i of s.services) await revealAndClick(page, serviceChips.nth(i), 700);
            await revealAndClick(page, page.getByTestId('onb-specialist-save'));
        }

        await beat(page);
        await revealAndClick(page, page.getByTestId('onb-specialists-next'));

        // Working hours — read down the week, then create the business
        await scrollTour(page);
        await revealAndClick(page, page.getByTestId('hours-finish'));

        // Dashboard — wait for the share link to render (it's part of the shot),
        // but take the slug from the org row, not from that text. Onboarding
        // retries with a `-suffix` slug when the base one is taken, and the
        // rendered link can still show the pre-retry slug: booking against it
        // silently lands in whichever OTHER org owns that slug.
        await expect(page).toHaveURL(/\/dashboard/, { timeout: 20_000 });
        await expect(page.getByText(/vis\.ge\/book\//).first()).toBeVisible();
        await beat(page, 2000);
        const origin = new URL(page.url()).origin;

        // Cover banner + brand colour + address. Onboarding can't set these and
        // walking Settings → Booking page would interrupt the take, so they go
        // in off camera while the dashboard is on screen.
        const { slug } = await brandOrg(page, {
            coverPath: image('cover.jpg'),
            themeHex: v.themeHex,
            address: v.org.address,
        });
        const bookingUrl = `${origin}/book/${slug}`;

        // Book an appointment as a customer
        await page.goto(bookingUrl);

        // Still of the finished booking page — the cover, logo, brand colour and
        // service photos all in one frame. Useful as ad creative on its own, and
        // the quickest way to check a vertical's assets landed. demos/ is
        // gitignored scratch space.
        await expect(page.getByTestId('book-service').first()).toBeVisible();
        // Let the hero land before the tour pulls away from it — otherwise the
        // first thing the footage shows of the booking page is it already moving.
        await beat(page, 1500);
        await waitForImages(page);
        await page.screenshot({
            path: path.join(DEMOS_DIR, `demo-${v.key}-booking.png`),
            fullPage: true,
        });

        await beat(page, 1800);

        // Pick the service, then the specialist
        await revealAndClick(page, page.getByTestId('book-service').first());
        await revealAndClick(page, page.getByTestId('book-staff').last());

        // Walk the week strip until a day has a free slot, and take the first one
        const days = page.locator('[data-testid^="book-day-"][data-disabled="false"]');
        await expect(days.first()).toBeVisible();
        for (let i = 0, n = await days.count(); i < n; i++) {
            await revealAndClick(page, days.nth(i), 700);
            const slot = page.getByTestId('book-slot').first();
            const free = await slot.waitFor({ state: 'visible', timeout: 5_000 }).then(() => true).catch(() => false);
            if (free) {
                await beat(page, 900);
                await revealAndClick(page, slot);
                break;
            }
        }

        // Fill out the customer details and pay on site
        await page.getByTestId('book-first-name').fill(v.customer.firstName);
        await page.getByTestId('book-last-name').fill(v.customer.lastName);
        await page.getByTestId('book-phone').fill(uniquePhone());
        await revealAndClick(page, page.getByTestId('book-pay-on-site'));
        await page.getByTestId('book-consent').locator('input').check();
        await beat(page);
        await revealAndClick(page, page.getByTestId('book-submit'));

        // Fill out and submit the booking OTP — a no-op unless the org bought the
        // SMS add-on, which a freshly onboarded one has not.
        await passBookingOtp(page);
        await expect(page).toHaveURL(/\/booking-confirmation\//, { timeout: 30_000 });
        await waitForImages(page);
        await beat(page, 2500);

        // Back on the owner's dashboard, the new appointment is there. This also
        // proves the booking landed in THIS org rather than one that happens to
        // own a similar slug.
        await page.goto(origin + '/dashboard');
        await expect(page.getByTestId('appt-row').first()).toBeVisible({ timeout: 20_000 });
        await beat(page, 2500);
    })
}

/**
 * Keep the take. test-results/ is wiped at the start of every run, so a
 * recording left there survives only until the next one — and the whole point of
 * this spec is the file.
 *
 * The page must be CLOSED before saveAs: the recording is only finalised on
 * close, and calling saveAs while the page is still open blocks until it is —
 * which, from inside the test body, means blocking until the test times out.
 */
test.afterEach(async ({ page }, testInfo) => {
    const video = page.video();
    if (!video) return;
    await page.close();
    const key = testInfo.title.split('—').pop()!.trim();
    await video.saveAs(path.join(DEMOS_DIR, `demo-${key}.webm`));
});
