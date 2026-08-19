import type { ReactNode } from 'react'
import { Box, Container, Typography, Button, Divider } from '@mui/material'
import { ArrowBackIosNew as ArrowBackIosNewIcon } from '@/components/icons'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { radii } from '@/theme/theme'
import { useDocumentMeta } from '@/lib/seo'

// Public developer documentation for the embeddable booking widget, linked from
// the homepage. Like the legal pages, content is plain structured data (no
// markdown dependency) and language-aware (ka/en/ru). Each block carries all
// three languages side by side so the structure can't drift between
// translations.

type Lang = 'en' | 'ka' | 'ru'

/** One string in all three UI languages. */
type L = Record<Lang, string>

/** Prose supports inline `code` and **bold** markers. */
type Block =
  | { h2: L }
  | { p: L }
  | { bullets: L[] }
  | { code: string }

const MONO = 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace'

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

/* ── Widget code samples ──────────────────────────────────────── */

const CODE = {
  embedSnippet: `<iframe data-vis src="https://vis.ge/book/YOUR-SLUG?embed=1&lang=ka"
        style="width:100%;border:0"></iframe>
<script src="https://vis.ge/embed.js" async></script>`,
  bookedEvent: `document.querySelector('iframe[data-vis]')
  .addEventListener('vis:booked', (e) => {
    // e.detail = { status: "approved" }
    console.log('booked', e.detail)
  })`,
}

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

]

/* ── Page ─────────────────────────────────────────────────────── */

function DocBlock({ block, lang }: { block: Block; lang: Lang }) {
  if ('h2' in block) {
    return (
      <Typography variant="h6" sx={{ fontWeight: 700, mt: 4, mb: 1 }}>
        {block.h2[lang]}
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
  return <CodeBlock>{block.code}</CodeBlock>
}

/** Public, standalone developer docs page (no auth), linked from the homepage.
 *  Language-aware via i18n, falling back to Georgian (the app's fallbackLng). */
export default function DevDocsPage() {
  const navigate = useNavigate()
  const { t, i18n } = useTranslation()
  const resolved = i18n.resolvedLanguage ?? i18n.language
  const lang: Lang = resolved === 'en' ? 'en' : resolved === 'ru' ? 'ru' : 'ka'

  useDocumentMeta({
    title: t('seo.docsWidgetTitle'),
    canonicalPath: '/docs/widget',
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
          {WIDGET_TITLE[lang]}
        </Typography>

        <Divider sx={{ my: 3 }} />

        {WIDGET_BLOCKS.map((block, i) => (
          <DocBlock key={i} block={block} lang={lang} />
        ))}
      </Container>
    </Box>
  )
}
