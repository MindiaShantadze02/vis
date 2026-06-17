import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import '@fontsource/noto-sans-georgian/400.css'
import '@fontsource/noto-sans-georgian/500.css'
import '@fontsource/noto-sans-georgian/600.css'
import '@fontsource/noto-sans-georgian/700.css'
import { ThemeProvider, CssBaseline } from '@mui/material'
import { LocalizationProvider } from '@mui/x-date-pickers'
import { AdapterDateFns } from '@mui/x-date-pickers/AdapterDateFns'
import { ka } from 'date-fns/locale'
import { I18nextProvider } from 'react-i18next'
import i18n from '@/lib/i18n'
import theme from '@/theme/theme'
import { AuthProvider } from '@/contexts/AuthContext'
import { OrgProvider } from '@/contexts/OrgContext'
import { ToastProvider } from '@/components/ui'
import App from './App.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <I18nextProvider i18n={i18n}>
      <ThemeProvider theme={theme}>
        <CssBaseline />
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
      </ThemeProvider>
    </I18nextProvider>
  </StrictMode>,
)
