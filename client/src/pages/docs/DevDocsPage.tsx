import type { ReactNode } from 'react'
import { Box, Container, Typography, Button, Divider } from '@mui/material'
import { ArrowBackIosNew as ArrowBackIosNewIcon } from '@/components/icons'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { radii } from '@/theme/theme'
import { useDocumentMeta } from '@/lib/seo'

// Public developer documentation for the REST API and the embeddable booking
// widget, linked from the homepage. Like the legal pages, content is plain
// structured data (no markdown dependency) and language-aware (ka/en/ru).
// Each block carries all three languages side by side so the structure can't
// drift between translations; code samples and endpoint signatures are shared.
// Keep the API page in sync with docs/PUBLIC_API.md (the reviewable source).

export type DevDocType = 'api' | 'widget'

type Lang = 'en' | 'ka' | 'ru'

/** One string in all three UI languages. */
type L = Record<Lang, string>

/** Prose supports inline `code` and **bold** markers. */
type Block =
  | { h2: L }
  | { h3: string } // endpoint signature — intentionally not localized
  | { p: L }
  | { bullets: L[] }
  | { code: string }
  | { errors: true } // the API error table

const MONO = 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace'

const API_BASE = 'https://dnmecnpugjxkjonqsfxx.supabase.co/functions/v1/api'

/* ── Rendering primitives ─────────────────────────────────────── */

function Code({ children }: { children: ReactNode }) {
  return (
    <Box component="code" sx={{ fontFamily: MONO, fontSize: '0.9em', bgcolor: 'action.hover', px: 0.5, py: 0.25, borderRadius: '4px' }}>
      {children}
    </Box>
  )
}

/** Renders a prose string, turning `code` and **bold** spans into elements. */
function rich(text: string): ReactNode {
  return text.split(/(`[^`]*`|\*\*[^*]+\*\*)/g).map((part, i) => {
    if (part.startsWith('`') && part.endsWith('`')) return <Code key={i}>{part.slice(1, -1)}</Code>
    if (part.startsWith('**') && part.endsWith('**')) return <b key={i}>{part.slice(2, -2)}</b>
    return part
  })
}

function CodeBlock({ children }: { children: string }) {
  return (
    <Box
      component="pre"
      sx={{
        bgcolor: 'background.paper',
        border: '1px solid', borderColor: 'divider',
        borderRadius: `${radii.card}px`,
        p: 2, my: 1.5,
        overflowX: 'auto',
        fontFamily: MONO, fontSize: 13, lineHeight: 1.6,
        color: 'text.primary',
      }}
    >
      {children}
    </Box>
  )
}

/* ── API error table ──────────────────────────────────────────── */

const ERROR_HEADERS: [string, string, L] = ['HTTP', 'code', {
  en: 'meaning', ka: 'მნიშვნელობა', ru: 'значение',
}]

const API_ERRORS: [string, string, L][] = [
  ['401', 'invalid_key', {
    en: 'missing, unknown or revoked key',
    ka: 'გასაღები აკლია, უცნობია ან გაუქმებულია',
    ru: 'ключ отсутствует, неизвестен или отозван',
  }],
  ['429', 'rate_limited', {
    en: 'over 60 requests/min for this key',
    ka: 'ამ გასაღებზე 60 მოთხოვნა/წუთზე მეტი',
    ru: 'больше 60 запросов/мин для этого ключа',
  }],
  ['404', 'service_not_found', {
    en: "not your organisation's active service",
    ka: 'არ არის შენი ორგანიზაციის აქტიური სერვისი',
    ru: 'не активная услуга вашей организации',
  }],
  ['404', 'not_found', {
    en: 'unknown route',
    ka: 'უცნობი მისამართი',
    ru: 'неизвестный маршрут',
  }],
  ['409', 'slot_unavailable', {
    en: 'requested time not free (race or stale slot list)',
    ka: 'მოთხოვნილი დრო დაკავებულია (რბოლა ან მოძველებული სია)',
    ru: 'запрошенное время занято (гонка или устаревший список слотов)',
  }],
  ['403', 'billing_blocked', {
    en: 'the organisation is not currently accepting bookings (unpaid balance)',
    ka: 'ორგანიზაცია ამჟამად არ იღებს ჯავშნებს (გადაუხდელი ბალანსი)',
    ru: 'организация сейчас не принимает записи (неоплаченный баланс)',
  }],
  ['422', 'invalid_* / staff_not_available / too_far_in_advance', {
    en: 'validation failures',
    ka: 'ვალიდაციის შეცდომები',
    ru: 'ошибки валидации',
  }],
  ['500', 'internal', {
    en: 'unexpected server error (details logged server-side, never returned)',
    ka: 'სერვერის მოულოდნელი შეცდომა (დეტალები იწერება მხოლოდ სერვერის ჟურნალში)',
    ru: 'непредвиденная ошибка сервера (детали пишутся только в серверные логи)',
  }],
]

function ErrorTable({ lang }: { lang: Lang }) {
  return (
    <Box sx={{ overflowX: 'auto', my: 1.5 }}>
      <Box component="table" sx={{ borderCollapse: 'collapse', width: '100%', minWidth: 480 }}>
        <Box component="thead">
          <Box component="tr">
            {[ERROR_HEADERS[0], ERROR_HEADERS[1], ERROR_HEADERS[2][lang]].map(h => (
              <Box
                key={h}
                component="th"
                sx={{ textAlign: 'left', fontSize: 13, fontWeight: 600, p: 1, borderBottom: '1px solid', borderColor: 'divider' }}
              >
                {h}
              </Box>
            ))}
          </Box>
        </Box>
        <Box component="tbody">
          {API_ERRORS.map(([http, code, meaning]) => (
            <Box component="tr" key={http + code}>
              <Box component="td" sx={{ fontSize: 13, p: 1, borderBottom: '1px solid', borderColor: 'divider', color: 'text.secondary' }}>
                {http}
              </Box>
              <Box component="td" sx={{ fontFamily: MONO, fontSize: 12.5, p: 1, borderBottom: '1px solid', borderColor: 'divider' }}>
                {code}
              </Box>
              <Box component="td" sx={{ fontSize: 13, p: 1, borderBottom: '1px solid', borderColor: 'divider', color: 'text.secondary' }}>
                {meaning[lang]}
              </Box>
            </Box>
          ))}
        </Box>
      </Box>
    </Box>
  )
}

/* ── Shared code samples ──────────────────────────────────────── */

const CODE = {
  auth: `curl -H "x-api-key: grf_..." \\\n  "${API_BASE}/v1/services"`,
  organisation: `{ "organisation": { "id": "…", "name": "…", "slug": "…", "description": "…",
                    "contact_phone": "595…", "logo_url": "…" } }`,
  services: `{ "services": [ { "id": "…", "name": "Consultation", "duration_minutes": 30,
                  "price": 50, "max_per_slot": 1 } ] }`,
  slots: `{ "service_id": "…", "date": "2026-07-15", "timezone": "+04:00",
  "slots": [ { "time": "09:00", "remaining": 1, "total": 1 }, … ] }`,
  createBooking: `curl -X POST -H "x-api-key: grf_..." -H "content-type: application/json" \\
  -d '{
    "service_id": "f3578227-…",
    "date": "2026-07-15",
    "time": "11:00",
    "customer": { "first_name": "Nino", "last_name": "K.", "phone": "555123456" },
    "staff_id": null,
    "notes": "prefers window seat"
  }' \\
  "${API_BASE}/v1/bookings"`,
  bookingResponse: `{ "booking": { "id": "…", "status": "approved",
               "scheduled_at": "2026-07-15T07:00:00+00:00", "staff_id": "…" } }`,
  embedSnippet: `<iframe data-vis src="https://vis.ge/book/YOUR-SLUG?embed=1&lang=ka"
        style="width:100%;border:0"></iframe>
<script src="https://vis.ge/embed.js" async></script>`,
  bookedEvent: `document.querySelector('iframe[data-vis]')
  .addEventListener('vis:booked', (e) => {
    // e.detail = { appointmentId: "…", status: "approved" }
    console.log('booked', e.detail)
  })`,
}

/* ── API doc content ──────────────────────────────────────────── */

const API_TITLE: L = {
  en: 'Vis Public REST API (v1)',
  ka: 'Vis-ის საჯარო REST API (v1)',
  ru: 'Публичный REST API Vis (v1)',
}

const API_BLOCKS: Block[] = [
  { p: {
    en: 'Integrate Vis booking into your own website, app, or backend. The API exposes the same availability and booking rules as your public booking page.',
    ka: 'ჩააშენე Vis-ის დაჯავშნა შენს ვებგვერდში, აპლიკაციაში ან ბექენდში. API იყენებს იმავე ხელმისაწვდომობისა და დაჯავშნის წესებს, რასაც შენი საჯარო ჯავშნის გვერდი.',
    ru: 'Интегрируйте запись Vis в свой сайт, приложение или бэкенд. API использует те же правила доступности и записи, что и ваша публичная страница записи.',
  } },
  { bullets: [
    {
      en: `Base URL: \`${API_BASE}\``,
      ka: `საბაზისო URL: \`${API_BASE}\``,
      ru: `Базовый URL: \`${API_BASE}\``,
    },
    {
      en: 'Auth: per-organisation API key, minted in **Dashboard → Settings → API keys**',
      ka: 'ავტორიზაცია: ორგანიზაციის API გასაღები, რომელიც იქმნება **პანელი → პარამეტრები → API გასაღებები** გვერდზე',
      ru: 'Авторизация: API-ключ организации, создаётся в **Панель → Настройки → API-ключи**',
    },
    {
      en: 'Format: JSON in/out, UTF-8',
      ka: 'ფორმატი: JSON შეყვანა/გამოტანა, UTF-8',
      ru: 'Формат: JSON на вход и выход, UTF-8',
    },
    {
      en: 'Timezone: all dates and times are Georgia business time (UTC+4)',
      ka: 'დროის სარტყელი: ყველა თარიღი და დრო არის საქართველოს ბიზნეს-დრო (UTC+4)',
      ru: 'Часовой пояс: все даты и время — грузинское бизнес-время (UTC+4)',
    },
  ] },
  { p: {
    en: '**Keep your key server-side.** Requests must come from your backend. A key embedded in browser or mobile code can be extracted and used by anyone — revoke it immediately if that happens (Settings → API keys → Revoke).',
    ka: '**შეინახე გასაღები მხოლოდ სერვერზე.** მოთხოვნები შენი ბექენდიდან უნდა მოდიოდეს. ბრაუზერის ან მობილურის კოდში ჩაშენებული გასაღების ამოღება და გამოყენება ნებისმიერს შეუძლია — ასეთ შემთხვევაში დაუყოვნებლივ გააუქმე იგი (პარამეტრები → API გასაღებები → გაუქმება).',
    ru: '**Храните ключ только на сервере.** Запросы должны идти с вашего бэкенда. Ключ, встроенный в браузерный или мобильный код, может извлечь и использовать кто угодно — в таком случае немедленно отзовите его (Настройки → API-ключи → Отозвать).',
  } },

  { h2: { en: 'Authentication', ka: 'ავტორიზაცია', ru: 'Аутентификация' } },
  { p: {
    en: 'Pass the key in the `x-api-key` header (or `Authorization: Bearer <key>`):',
    ka: 'გადაეცი გასაღები `x-api-key` ჰედერში (ან `Authorization: Bearer <key>`):',
    ru: 'Передавайте ключ в заголовке `x-api-key` (или `Authorization: Bearer <key>`):',
  } },
  { code: CODE.auth },
  { p: {
    en: 'The key identifies your organisation — every endpoint is automatically scoped to it. Up to 5 active keys per organisation; revocation is immediate.',
    ka: 'გასაღები განსაზღვრავს შენს ორგანიზაციას — ყველა endpoint ავტომატურად შემოიფარგლება მისით. ორგანიზაციაზე დასაშვებია 5-მდე აქტიური გასაღები; გაუქმება ძალაში შედის მყისიერად.',
    ru: 'Ключ идентифицирует вашу организацию — каждый endpoint автоматически ограничен ею. До 5 активных ключей на организацию; отзыв действует мгновенно.',
  } },
  { p: {
    en: 'Rate limit: 60 requests per key per minute (HTTP 429 when exceeded).',
    ka: 'ლიმიტი: 60 მოთხოვნა გასაღებზე წუთში (გადაჭარბებისას — HTTP 429).',
    ru: 'Лимит: 60 запросов на ключ в минуту (при превышении — HTTP 429).',
  } },

  { h2: { en: 'Endpoints', ka: 'Endpoint-ები', ru: 'Эндпоинты' } },

  { h3: 'GET /v1/organisation' },
  { p: {
    en: "Your organisation's public profile.",
    ka: 'შენი ორგანიზაციის საჯარო პროფილი.',
    ru: 'Публичный профиль вашей организации.',
  } },
  { code: CODE.organisation },

  { h3: 'GET /v1/services' },
  { p: {
    en: 'Active services, in your configured display order.',
    ka: 'აქტიური სერვისები, შენ მიერ განსაზღვრული თანმიმდევრობით.',
    ru: 'Активные услуги в настроенном вами порядке отображения.',
  } },
  { code: CODE.services },

  { h3: 'GET /v1/slots?service_id=<uuid>&date=YYYY-MM-DD[&staff_id=<uuid>]' },
  { p: {
    en: 'Free start times for one day, honouring working hours, per-day overrides, existing bookings, per-service capacity, staff availability, and your advance booking window. Past times are excluded automatically.',
    ka: 'თავისუფალი დროები ერთი დღისთვის — გათვალისწინებულია სამუშაო საათები, კონკრეტული დღის ცვლილებები, არსებული ჯავშნები, სერვისის ტევადობა, თანამშრომელთა ხელმისაწვდომობა და წინასწარ დაჯავშნის ფანჯარა. წარსული დროები ავტომატურად გამოირიცხება.',
    ru: 'Свободное время начала на один день — с учётом рабочих часов, переопределений на отдельные дни, существующих записей, вместимости услуги, доступности сотрудников и окна предварительной записи. Прошедшее время исключается автоматически.',
  } },
  { code: CODE.slots },
  { p: {
    en: '`remaining`/`total` reflect slot capacity (`max_per_slot` × staff availability). Omit `staff_id` for "any available staff member".',
    ka: '`remaining`/`total` ასახავს სლოტის ტევადობას (`max_per_slot` × ხელმისაწვდომი თანამშრომლები). გამოტოვე `staff_id`, თუ გინდა „ნებისმიერი თავისუფალი თანამშრომელი“.',
    ru: '`remaining`/`total` отражают вместимость слота (`max_per_slot` × доступность сотрудников). Опустите `staff_id`, чтобы выбрать «любого свободного сотрудника».',
  } },

  { h3: 'POST /v1/bookings' },
  { p: {
    en: 'Creates an in-person booking (the API equivalent of your public booking page).',
    ka: 'ქმნის ჯავშანს (შენი საჯარო ჯავშნის გვერდის API-ეკვივალენტი).',
    ru: 'Создаёт запись (API-эквивалент вашей публичной страницы записи).',
  } },
  { code: CODE.createBooking },
  { bullets: [
    {
      en: '`phone` — Georgian number (`5XXXXXXXX`, `+995` prefix accepted).',
      ka: '`phone` — ქართული ნომერი (`5XXXXXXXX`, `+995` პრეფიქსი დასაშვებია).',
      ru: '`phone` — грузинский номер (`5XXXXXXXX`, допускается префикс `+995`).',
    },
    {
      en: '`staff_id` — optional; omitted/null means "any available" (the API pins a concrete free member, like the booking page).',
      ka: '`staff_id` — არასავალდებულო; გამოტოვებული/null ნიშნავს „ნებისმიერ თავისუფალს“ (API თავად ირჩევს კონკრეტულ თავისუფალ თანამშრომელს, ჯავშნის გვერდის მსგავსად).',
      ru: '`staff_id` — необязателен; отсутствие/null означает «любой свободный» (API сам закрепляет конкретного свободного сотрудника, как и страница записи).',
    },
    {
      en: 'Bookings are always created `approved` — there is no approval queue. Sending a `status` field returns **422**.',
      ka: 'ჯავშანი ყოველთვის იქმნება `approved` სტატუსით — დასადასტურებელი რიგი აღარ არსებობს. `status` ველის გაგზავნა აბრუნებს **422**-ს.',
      ru: 'Записи всегда создаются со статусом `approved` — очереди на подтверждение больше нет. Передача поля `status` возвращает **422**.',
    },
    {
      en: 'The requested time is re-validated server-side against live availability just before insert; a taken slot returns **409**.',
      ka: 'მოთხოვნილი დრო ჩაწერამდე ხელახლა მოწმდება სერვერზე რეალური ხელმისაწვდომობის მიხედვით; დაკავებული დრო აბრუნებს **409**-ს.',
      ru: 'Запрошенное время повторно проверяется на сервере по актуальной доступности непосредственно перед записью; занятый слот возвращает **409**.',
    },
  ] },
  { p: { en: 'Response `201`:', ka: 'პასუხი `201`:', ru: 'Ответ `201`:' } },
  { code: CODE.bookingResponse },
  { bullets: [
    {
      en: "**No customer OTP** is required on this path — your API key is the trusted credential. By calling this endpoint you confirm the customer consented to the booking and to Vis's privacy terms (the consent timestamp/version is recorded on the customer record).",
      ka: '**კლიენტის OTP საჭირო არ არის** ამ გზაზე — სანდო კრედენციალი შენი API გასაღებია. ამ endpoint-ის გამოძახებით ადასტურებ, რომ კლიენტი დათანხმდა ჯავშანსა და Vis-ის კონფიდენციალურობის პირობებს (თანხმობის დრო/ვერსია ინახება კლიენტის ჩანაწერზე).',
      ru: '**OTP клиента не требуется** на этом пути — доверенным учётным данным является ваш API-ключ. Вызывая этот endpoint, вы подтверждаете, что клиент согласился на запись и с условиями конфиденциальности Vis (время/версия согласия сохраняются в записи клиента).',
    },
    {
      en: 'SMS behaviour matches the booking page: the customer is texted a confirmation immediately.',
      ka: 'SMS-ქცევა ჯავშნის გვერდის იდენტურია: კლიენტი დადასტურების SMS-ს იღებს მაშინვე.',
      ru: 'SMS работает как на странице записи: клиент сразу получает подтверждение по SMS.',
    },
    {
      en: "Bookings count against your plan's monthly appointment quota (403 when full).",
      ka: 'ჯავშნები ითვლება შენი გეგმის ყოველთვიურ ლიმიტში (ამოწურვისას — 403).',
      ru: 'Записи учитываются в месячной квоте вашего тарифа (403 при исчерпании).',
    },
  ] },

  { h2: { en: 'Errors', ka: 'შეცდომები', ru: 'Ошибки' } },
  { p: {
    en: 'Uniform shape: `{ "error": "<code>", "message": "<human readable>" }`',
    ka: 'ერთიანი ფორმატი: `{ "error": "<code>", "message": "<human readable>" }`',
    ru: 'Единый формат: `{ "error": "<code>", "message": "<human readable>" }`',
  } },
  { errors: true },
  { p: {
    en: '**Race window:** like the booking page, availability is checked immediately before insert but not locked — two bookings for the same last slot within the same instant can, in principle, both succeed. Treat 409 as "refresh slots and retry".',
    ka: '**რბოლის ფანჯარა:** ჯავშნის გვერდის მსგავსად, ხელმისაწვდომობა მოწმდება უშუალოდ ჩაწერის წინ, მაგრამ არ იბლოკება — ერთსა და იმავე ბოლო სლოტზე ერთდროულად გაკეთებულმა ორმა ჯავშანმა, პრინციპში, შეიძლება ორივემ გაიაროს. 409 აღიქვი როგორც „განაახლე სლოტები და სცადე თავიდან“.',
    ru: '**Окно гонки:** как и на странице записи, доступность проверяется непосредственно перед записью, но не блокируется — две записи на один и тот же последний слот в один момент, в принципе, могут пройти обе. Трактуйте 409 как «обновите слоты и повторите».',
  } },
]

/* ── Widget doc content ───────────────────────────────────────── */

const WIDGET_TITLE: L = {
  en: 'Embeddable booking widget',
  ka: 'ჩასაშენებელი ჯავშნის ვიჯეტი',
  ru: 'Встраиваемый виджет записи',
}

const WIDGET_BLOCKS: Block[] = [
  { p: {
    en: 'Embed your Vis booking form directly into your own website with two lines of HTML. Clients book without leaving your site, and the widget stays in sync with your services, staff and working hours automatically.',
    ka: 'ჩააშენე Vis-ის ჯავშნის ფორმა პირდაპირ შენს ვებგვერდში HTML-ის ორი ხაზით. კლიენტები ჯავშნიან შენი საიტიდან გაუსვლელად, ვიჯეტი კი ავტომატურად სინქრონდება შენს სერვისებთან, თანამშრომლებთან და სამუშაო საათებთან.',
    ru: 'Встройте форму записи Vis прямо в свой сайт двумя строками HTML. Клиенты записываются, не покидая ваш сайт, а виджет автоматически синхронизируется с вашими услугами, сотрудниками и рабочими часами.',
  } },

  { h2: { en: 'Quick start', ka: 'სწრაფი დაწყება', ru: 'Быстрый старт' } },
  { p: {
    en: 'Paste this where the form should appear, replacing `YOUR-SLUG` with your booking page slug:',
    ka: 'ჩასვი ეს იქ, სადაც ფორმა უნდა გამოჩნდეს, და `YOUR-SLUG` შეცვალე შენი ჯავშნის გვერდის მისამართით (slug):',
    ru: 'Вставьте это там, где должна появиться форма, заменив `YOUR-SLUG` на slug вашей страницы записи:',
  } },
  { code: CODE.embedSnippet },
  { p: {
    en: 'A ready-to-copy snippet with your slug filled in is available in **Dashboard → Settings → Booking page**.',
    ka: 'მზა კოდი, შენი slug-ით შევსებული, ხელმისაწვდომია **პანელი → პარამეტრები → ჯავშნის გვერდი** განყოფილებაში.',
    ru: 'Готовый фрагмент с уже подставленным slug доступен в **Панель → Настройки → Страница записи**.',
  } },

  { h2: { en: 'URL parameters', ka: 'URL პარამეტრები', ru: 'Параметры URL' } },
  { bullets: [
    {
      en: '`embed=1` — renders the bare booking form, without the standalone page chrome. Required for embedding.',
      ka: '`embed=1` — აჩვენებს მხოლოდ ჯავშნის ფორმას, ცალკე გვერდის გარსის გარეშე. ჩაშენებისთვის აუცილებელია.',
      ru: '`embed=1` — отображает только форму записи, без оформления отдельной страницы. Обязателен для встраивания.',
    },
    {
      en: "`lang=ka|en|ru` — the widget's language. Omit it to use the visitor's saved/browser language.",
      ka: '`lang=ka|en|ru` — ვიჯეტის ენა. გამოტოვების შემთხვევაში გამოიყენება ვიზიტორის შენახული/ბრაუზერის ენა.',
      ru: '`lang=ka|en|ru` — язык виджета. Если не указан, используется сохранённый язык посетителя или язык браузера.',
    },
  ] },

  { h2: { en: 'What embed.js does', ka: 'რას აკეთებს embed.js', ru: 'Что делает embed.js' } },
  { bullets: [
    {
      en: 'Auto-sizes every `iframe[data-vis]` on the page to fit its content — no scrollbars inside the widget, and several widgets on one page are fine.',
      ka: 'ავტომატურად არგებს გვერდზე არსებულ ყველა `iframe[data-vis]`-ს შიგთავსის სიმაღლეს — ვიჯეტში სქროლბარები არ ჩნდება, და ერთ გვერდზე რამდენიმე ვიჯეტიც მუშაობს.',
      ru: 'Автоматически подгоняет каждый `iframe[data-vis]` на странице под высоту содержимого — без полос прокрутки внутри виджета; несколько виджетов на одной странице тоже работают.',
    },
    {
      en: 'Breaks online-payment redirects out of the iframe to the top window (payment gateways refuse to load embedded).',
      ka: 'ონლაინ გადახდის გადამისამართებას iframe-დან ზედა ფანჯარაში გადააქვს (გადახდის სისტემები iframe-ში ჩატვირთვაზე უარს ამბობენ).',
      ru: 'Выводит редиректы онлайн-оплаты из iframe в верхнее окно (платёжные шлюзы отказываются загружаться во встроенном виде).',
    },
    {
      en: "Only accepts messages coming from the iframe's own origin.",
      ka: 'იღებს შეტყობინებებს მხოლოდ iframe-ის საკუთარი origin-იდან.',
      ru: 'Принимает сообщения только с собственного origin iframe.',
    },
  ] },

  { h2: {
    en: 'Reacting to a completed booking',
    ka: 'დასრულებულ ჯავშანზე რეაგირება',
    ru: 'Реакция на завершённую запись',
  } },
  { p: {
    en: 'When a client finishes booking, the iframe element dispatches a `vis:booked` DOM event, so your page can show its own confirmation, fire analytics, etc.:',
    ka: 'როცა კლიენტი ჯავშანს ასრულებს, iframe ელემენტი აგზავნის `vis:booked` DOM ივენთს — შენს გვერდს შეუძლია აჩვენოს საკუთარი დადასტურება, გაუშვას ანალიტიკა და ა.შ.:',
    ru: 'Когда клиент завершает запись, элемент iframe отправляет DOM-событие `vis:booked` — ваша страница может показать собственное подтверждение, отправить аналитику и т.д.:',
  } },
  { code: CODE.bookedEvent },

  { h2: { en: 'Prefer full control?', ka: 'სრული კონტროლი გირჩევნია?', ru: 'Нужен полный контроль?' } },
  { p: {
    en: 'If you want to build your own booking UI instead of embedding ours, use the Public REST API — see the API documentation linked from the homepage, and mint a key in Dashboard → Settings → API keys.',
    ka: 'თუ ჩვენი ფორმის ჩაშენების ნაცვლად საკუთარი ჯავშნის ინტერფეისის აწყობა გინდა, გამოიყენე საჯარო REST API — იხილე API დოკუმენტაცია მთავარი გვერდიდან, გასაღები კი შექმენი პანელი → პარამეტრები → API გასაღებები განყოფილებაში.',
    ru: 'Если вместо встраивания нашей формы вы хотите собрать собственный интерфейс записи, используйте публичный REST API — см. документацию API на главной странице, а ключ создайте в Панель → Настройки → API-ключи.',
  } },
]

/* ── Page ─────────────────────────────────────────────────────── */

const DOCS: Record<DevDocType, { title: L; blocks: Block[] }> = {
  api: { title: API_TITLE, blocks: API_BLOCKS },
  widget: { title: WIDGET_TITLE, blocks: WIDGET_BLOCKS },
}

function DocBlock({ block, lang }: { block: Block; lang: Lang }) {
  if ('h2' in block) {
    return (
      <Typography variant="h6" sx={{ fontWeight: 700, mt: 4, mb: 1 }}>
        {block.h2[lang]}
      </Typography>
    )
  }
  if ('h3' in block) {
    return (
      <Typography variant="subtitle1" sx={{ fontWeight: 600, mt: 3, mb: 0.75, fontFamily: MONO, fontSize: 15 }}>
        {block.h3}
      </Typography>
    )
  }
  if ('p' in block) {
    return (
      <Typography variant="body2" sx={{ color: 'text.secondary', lineHeight: 1.7, mb: 1.5 }}>
        {rich(block.p[lang])}
      </Typography>
    )
  }
  if ('bullets' in block) {
    return (
      <Box component="ul" sx={{ pl: 3, my: 1 }}>
        {block.bullets.map((item, i) => (
          <Typography key={i} component="li" variant="body2" sx={{ color: 'text.secondary', lineHeight: 1.7, mb: 0.75 }}>
            {rich(item[lang])}
          </Typography>
        ))}
      </Box>
    )
  }
  if ('code' in block) return <CodeBlock>{block.code}</CodeBlock>
  return <ErrorTable lang={lang} />
}

/** Public, standalone developer docs page (no auth), linked from the homepage.
 *  Language-aware via i18n, falling back to Georgian (the app's fallbackLng). */
export default function DevDocsPage({ type }: { type: DevDocType }) {
  const navigate = useNavigate()
  const { t, i18n } = useTranslation()
  const resolved = i18n.resolvedLanguage ?? i18n.language
  const lang: Lang = resolved === 'en' ? 'en' : resolved === 'ru' ? 'ru' : 'ka'
  const doc = DOCS[type]

  useDocumentMeta({
    title: t(type === 'api' ? 'seo.docsApiTitle' : 'seo.docsWidgetTitle'),
    canonicalPath: type === 'api' ? '/docs/api' : '/docs/widget',
  })

  return (
    <Box sx={{ minHeight: '100vh', bgcolor: 'background.default', py: { xs: 3, md: 6 } }}>
      <Container maxWidth="md">
        <Button
          startIcon={<ArrowBackIosNewIcon sx={{ fontSize: 14 }} />}
          onClick={() => (window.history.length > 1 ? navigate(-1) : navigate('/'))}
          size="small"
          sx={{ mb: 2, color: 'text.secondary' }}
        >
          {t('common.back')}
        </Button>

        <Typography variant="h4" sx={{ fontWeight: 800, letterSpacing: '-0.5px', mb: 0.5 }}>
          {doc.title[lang]}
        </Typography>

        <Divider sx={{ my: 3 }} />

        {doc.blocks.map((block, i) => (
          <DocBlock key={i} block={block} lang={lang} />
        ))}
      </Container>
    </Box>
  )
}
