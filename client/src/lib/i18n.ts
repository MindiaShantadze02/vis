import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import HttpBackend from 'i18next-http-backend'
import LanguageDetector from 'i18next-browser-languagedetector'

export const SUPPORTED_LANGUAGES = [
  { code: 'ka', label: 'ქართული', country: 'GE' },
  { code: 'ru', label: 'Русский', country: 'RU' },
  { code: 'en', label: 'English', country: 'GB' },
] as const

export type LanguageCode = (typeof SUPPORTED_LANGUAGES)[number]['code']

// One-time migration: the language key predates the Grafiki → Vis rename.
try {
  const legacy = localStorage.getItem('grafiki-lang')
  if (legacy && !localStorage.getItem('vis-lang')) localStorage.setItem('vis-lang', legacy)
  localStorage.removeItem('grafiki-lang')
} catch { /* storage unavailable (SSR/private mode) — detector falls back to ka */ }

i18n
  .use(HttpBackend)
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    fallbackLng: 'ka',
    supportedLngs: SUPPORTED_LANGUAGES.map(l => l.code),
    defaultNS: 'translation',
    detection: {
      // Remember the admin's choice across reloads; fall back to Georgian.
      order: ['localStorage'],
      caches: ['localStorage'],
      lookupLocalStorage: 'vis-lang',
    },
    backend: {
      loadPath: '/locales/{{lng}}/{{ns}}.json',
    },
    interpolation: {
      escapeValue: false,
    },
  })

// Keep <html lang> in sync with the active language (SEO/a11y — index.html
// ships a static lang="ka"). Fires once when detection resolves at init and
// again on every switch.
i18n.on('languageChanged', lng => {
  document.documentElement.lang = lng
})

export default i18n
