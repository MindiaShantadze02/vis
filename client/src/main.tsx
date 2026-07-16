import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
// Subset-scoped font imports: the bare `<weight>.css` entries pull EVERY
// script subset (Ethiopic, Bengali, Thai…) into the build — hundreds of
// @font-face rules and >1 MB of emitted font assets the app never renders.
// We serve Georgian + Latin UIs, so import exactly those subsets. Georgian
// glyphs resolve via Google Sans' own georgian subset first (same as before —
// the theme stack is "Google Sans", "Noto Sans Georgian", …), with Noto as
// the fallback.
import '@fontsource/noto-sans-georgian/georgian-400.css'
import '@fontsource/noto-sans-georgian/georgian-500.css'
import '@fontsource/noto-sans-georgian/georgian-600.css'
import '@fontsource/noto-sans-georgian/georgian-700.css'
import '@fontsource/noto-serif-georgian/georgian-700.css'
import '@fontsource/noto-serif-georgian/georgian-800.css'
import '@fontsource/google-sans/latin-400.css'
import '@fontsource/google-sans/latin-500.css'
import '@fontsource/google-sans/latin-600.css'
import '@fontsource/google-sans/latin-700.css'
import '@fontsource/google-sans/latin-ext-400.css'
import '@fontsource/google-sans/latin-ext-500.css'
import '@fontsource/google-sans/latin-ext-600.css'
import '@fontsource/google-sans/latin-ext-700.css'
import '@fontsource/google-sans/georgian-400.css'
import '@fontsource/google-sans/georgian-500.css'
import '@fontsource/google-sans/georgian-600.css'
import '@fontsource/google-sans/georgian-700.css'
import { ThemeProvider, CssBaseline, GlobalStyles } from '@mui/material'
import { MotionConfig } from 'framer-motion'
import { IconContext } from '@phosphor-icons/react'
import { LocalizationProvider } from '@mui/x-date-pickers'
import { AdapterDateFns } from '@mui/x-date-pickers/AdapterDateFns'
import { ka } from 'date-fns/locale'
import { I18nextProvider } from 'react-i18next'
import i18n from '@/lib/i18n'
import { initSentry } from '@/lib/sentry'
import theme from '@/theme/theme'
import { AuthProvider } from '@/contexts/AuthContext'
import { OrgProvider } from '@/contexts/OrgContext'
import { ToastProvider } from '@/components/ui'
import App from './App.tsx'

// No-op without VITE_SENTRY_DSN (see lib/sentry.ts).
initSentry()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <I18nextProvider i18n={i18n}>
      <ThemeProvider theme={theme}>
        <CssBaseline />
        {/* Honour the OS "reduce motion" setting for the hand-rolled CSS
            keyframes/transitions (Framer is gated separately via MotionConfig). */}
        <GlobalStyles
          styles={{
            '@media (prefers-reduced-motion: reduce)': {
              '*, *::before, *::after': {
                animationDuration: '0.01ms !important',
                animationIterationCount: '1 !important',
                transitionDuration: '0.01ms !important',
                scrollBehavior: 'auto !important',
              },
            },
          }}
        />
        {/* `reducedMotion="user"` makes every Framer animation collapse to its
            final state when the user requests reduced motion. */}
        {/* Global icon defaults. NB: this value REPLACES Phosphor's context
            defaults, so we must re-state size/color/mirrored — otherwise icons
            lose their `size: '1em'` and render unconstrained. Only `weight` is
            our change (duotone echoes the ink+citrus brand); switch it here to
            restyle every icon at once. */}
        <IconContext.Provider value={{ color: 'currentColor', size: '1em', mirrored: false, weight: 'duotone' }}>
        <MotionConfig reducedMotion="user">
        <ToastProvider>
          <LocalizationProvider
            dateAdapter={AdapterDateFns}
            adapterLocale={ka}
            localeText={{
              fieldDayPlaceholder: () => 'დღე',
              fieldMonthPlaceholder: params => (params.contentType === 'letter' ? 'თვე' : 'თვ'),
              fieldYearPlaceholder: () => 'წელი',
            }}
          >
            <BrowserRouter>
              <AuthProvider>
                <OrgProvider>
                  <App />
                </OrgProvider>
              </AuthProvider>
            </BrowserRouter>
          </LocalizationProvider>
        </ToastProvider>
        </MotionConfig>
        </IconContext.Provider>
      </ThemeProvider>
    </I18nextProvider>
  </StrictMode>,
)
