import { ka, ru, enUS, type Locale } from 'date-fns/locale'
import i18n from '@/lib/i18n'

const LOCALES: Record<string, Locale> = { ka, ru, en: enUS }

/**
 * date-fns locale matching the active UI language, for `format(...)` calls.
 * Falls back to Georgian. Components that call this must subscribe to i18n
 * (e.g. via useTranslation) so they re-render when the language changes.
 */
export function dateLocale(): Locale {
  return LOCALES[i18n.language?.split('-')[0]] ?? ka
}
