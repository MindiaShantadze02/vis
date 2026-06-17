import { createTheme, type Theme } from '@mui/material/styles'
import baseTheme from './theme'

// Per-organisation colour themes for the public booking pages (the flow your
// customers actually see). Deliberately a small, curated set — ranging from
// professional/business to fresh/sporty, plus a clean white — so owners get
// personality without an overwhelming colour-picker.
//
// Each theme drives the *whole* booking page: the sidebar gradient, the page
// background, AND the accent colour applied to buttons, inputs, the stepper,
// selected cards, etc. via a derived MUI theme (see makeBookingTheme).

export type BookingThemeKey = 'classic' | 'ocean' | 'sunset' | 'sporty' | 'white'

export interface BookingTheme {
  key: BookingThemeKey
  /** Georgian label shown in the settings picker. */
  label: string
  /** Gradient for the booking sidebar panel. */
  sidebar: string
  /** Whether the sidebar content (logo, name, text) is light or dark. */
  sidebarText: 'light' | 'dark'
  /** Background colour for the main booking content column. */
  pageBg: string
  /** Accent palette applied across the booking UI. */
  primary: string
  primaryLight: string
  primaryDark: string
  /** "r,g,b" of the accent — used for the translucent shadows/tints. */
  rgb: string
}

export const BOOKING_THEMES: Record<BookingThemeKey, BookingTheme> = {
  // Violet — the app default. Polished and professional.
  classic: {
    key: 'classic',
    label: 'კლასიკური',
    sidebar: 'linear-gradient(160deg, #2E1065 0%, #4C1D95 40%, #7C3AED 100%)',
    sidebarText: 'light',
    pageBg: '#FAF8FF',
    primary: '#7C3AED',
    primaryLight: '#A78BFA',
    primaryDark: '#5B21B6',
    rgb: '124,58,237',
  },
  // Blue — calm and corporate.
  ocean: {
    key: 'ocean',
    label: 'ოკეანე',
    sidebar: 'linear-gradient(160deg, #0C2D48 0%, #145374 40%, #2E8BC0 100%)',
    sidebarText: 'light',
    pageBg: '#F4FAFE',
    primary: '#1F7FB0',
    primaryLight: '#5FB0D9',
    primaryDark: '#145374',
    rgb: '31,127,176',
  },
  // Warm pink → orange. Friendly and inviting.
  sunset: {
    key: 'sunset',
    label: 'მზის ჩასვლა',
    sidebar: 'linear-gradient(160deg, #6A1B4D 0%, #C2185B 40%, #FF7043 100%)',
    sidebarText: 'light',
    pageBg: '#FFF7F3',
    primary: '#E64A19',
    primaryLight: '#FF8A65',
    primaryDark: '#AC2D0E',
    rgb: '230,74,25',
  },
  // Emerald green. Fresh and energetic.
  sporty: {
    key: 'sporty',
    label: 'სპორტული',
    sidebar: 'linear-gradient(160deg, #0B3D2E 0%, #11734A 40%, #2ECC71 100%)',
    sidebarText: 'light',
    pageBg: '#F3FBF6',
    primary: '#0E9E55',
    primaryLight: '#4ED88A',
    primaryDark: '#0B7A41',
    rgb: '14,158,85',
  },
  // Clean white — minimal, with a slate accent and a light sidebar.
  white: {
    key: 'white',
    label: 'თეთრი',
    sidebar: 'linear-gradient(160deg, #F9FAFB 0%, #EEF1F4 100%)',
    sidebarText: 'dark',
    pageBg: '#FFFFFF',
    primary: '#1F2937',
    primaryLight: '#6B7280',
    primaryDark: '#111827',
    rgb: '31,41,55',
  },
}

export const BOOKING_THEME_LIST: BookingTheme[] = Object.values(BOOKING_THEMES)

export const DEFAULT_BOOKING_THEME: BookingThemeKey = 'classic'

/** Resolve a stored key (possibly null/unknown) to a theme, falling back to default. */
export function getBookingTheme(key: string | null | undefined): BookingTheme {
  return BOOKING_THEMES[(key as BookingThemeKey)] ?? BOOKING_THEMES[DEFAULT_BOOKING_THEME]
}

// Cache derived MUI themes so we don't rebuild on every render.
const muiThemeCache = new Map<BookingThemeKey, Theme>()

/**
 * Build an MUI theme variant whose accent (primary) follows the booking theme.
 * Re-points every violet-hardcoded component override (buttons, inputs, stepper,
 * toggles, progress) at the theme's colour so the entire booking page is themed,
 * not just the sidebar.
 */
export function makeBookingTheme(bt: BookingTheme): Theme {
  const cached = muiThemeCache.get(bt.key)
  if (cached) return cached

  const { primary, primaryLight, primaryDark, rgb, pageBg } = bt
  const theme = createTheme(baseTheme, {
    palette: {
      primary: { main: primary, light: primaryLight, dark: primaryDark, contrastText: '#FFFFFF' },
      background: { default: pageBg, paper: '#FFFFFF' },
    },
    components: {
      MuiButton: {
        styleOverrides: {
          contained: {
            boxShadow: `0 1px 3px rgba(${rgb},0.18)`,
            '&:hover': { boxShadow: `0 4px 16px rgba(${rgb},0.30)` },
            '&:active': { boxShadow: `0 1px 3px rgba(${rgb},0.18)` },
          },
          outlined: {
            borderColor: `rgba(${rgb},0.35)`,
            '&:hover': { borderColor: primary, backgroundColor: `rgba(${rgb},0.04)` },
          },
          text: { '&:hover': { backgroundColor: `rgba(${rgb},0.06)` } },
        },
      },
      MuiCard: {
        styleOverrides: {
          root: {
            '&:hover': { boxShadow: `0 8px 24px rgba(${rgb},0.10), 0 2px 8px rgba(0,0,0,0.04)` },
          },
        },
      },
      MuiTextField: {
        styleOverrides: {
          root: {
            '& .MuiOutlinedInput-root': {
              '&:hover .MuiOutlinedInput-notchedOutline': { borderColor: primary },
              '&.Mui-focused': { boxShadow: `0 0 0 3px rgba(${rgb},0.12)` },
              '&.Mui-focused .MuiOutlinedInput-notchedOutline': { borderColor: primary },
            },
            '& .MuiInputLabel-root.Mui-focused': { color: primary },
          },
        },
      },
      MuiStepIcon: {
        styleOverrides: {
          root: {
            color: `rgba(${rgb},0.20)`,
            '&.Mui-active': { color: primary, filter: `drop-shadow(0 2px 6px rgba(${rgb},0.35))` },
            '&.Mui-completed': { color: '#059669' },
          },
        },
      },
      MuiStepConnector: { styleOverrides: { line: { borderColor: `rgba(${rgb},0.20)` } } },
      MuiStepLabel: {
        styleOverrides: {
          label: {
            '&.Mui-active': { fontWeight: 600, color: primary },
            '&.Mui-completed': { fontWeight: 500 },
          },
        },
      },
      MuiToggleButton: {
        styleOverrides: {
          root: {
            '&.Mui-selected': {
              backgroundColor: `rgba(${rgb},0.10)`,
              color: primaryDark,
              borderColor: primary,
              '&:hover': { backgroundColor: `rgba(${rgb},0.15)` },
            },
          },
        },
      },
      MuiLinearProgress: {
        styleOverrides: {
          root: { backgroundColor: `rgba(${rgb},0.10)` },
          bar: { background: `linear-gradient(90deg, ${primary} 0%, ${primaryLight} 100%)` },
        },
      },
      MuiAvatar: {
        styleOverrides: {
          root: { background: `linear-gradient(135deg, ${primary} 0%, ${primaryLight} 100%)` },
        },
      },
    },
  })

  muiThemeCache.set(bt.key, theme)
  return theme
}
