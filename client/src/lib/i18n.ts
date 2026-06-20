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
      lookupLocalStorage: 'grafiki-lang',
    },
    backend: {
      loadPath: '/locales/{{lng}}/{{ns}}.json',
    },
    interpolation: {
      escapeValue: false,
    },
  })

export default i18n
