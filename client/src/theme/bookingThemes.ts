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
  // Soft indigo-violet — the app default. Calm and professional.
  classic: {
    key: 'classic',
    label: 'კლასიკური',
    sidebar: 'linear-gradient(160deg, #474270 0%, #6B5DD3 100%)',
    sidebarText: 'light',
    pageBg: '#FAF9FE',
    primary: '#6B5DD3',
    primaryLight: '#A9A0E8',
    primaryDark: '#564AA8',
    rgb: '107,93,211',
  },
  // Muted slate-blue — calm and corporate.
  ocean: {
    key: 'ocean',
    label: 'ოკეანე',
    sidebar: 'linear-gradient(160deg, #314F66 0%, #4886AE 100%)',
    sidebarText: 'light',
    pageBg: '#F6FAFD',
    primary: '#4886AE',
    primaryLight: '#93BBD6',
    primaryDark: '#356781',
    rgb: '72,134,174',
  },
  // Soft terracotta — warm and inviting, without the neon.
  sunset: {
    key: 'sunset',
    label: 'მზის ჩასვლა',
    sidebar: 'linear-gradient(160deg, #7E5A57 0%, #BE7860 100%)',
    sidebarText: 'light',
    pageBg: '#FFF8F4',
    primary: '#C76B54',
    primaryLight: '#E6A892',
    primaryDark: '#9E4F3B',
    rgb: '199,107,84',
  },
  // Sage green — fresh but understated.
  sporty: {
    key: 'sporty',
    label: 'სპორტული',
    sidebar: 'linear-gradient(160deg, #3A5749 0%, #45986C 100%)',
    sidebarText: 'light',
    pageBg: '#F6FBF8',
    primary: '#45986C',
    primaryLight: '#8AC6A5',
    primaryDark: '#327150',
    rgb: '69,152,108',
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
            boxShadow: `0 1px 2px rgba(${rgb},0.12)`,
            '&:hover': { boxShadow: `0 3px 10px rgba(${rgb},0.18)` },
            '&:active': { boxShadow: `0 1px 2px rgba(${rgb},0.12)` },
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
              '&.Mui-focused': { boxShadow: `0 0 0 3px rgba(${rgb},0.10)` },
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
            '&.Mui-active': { color: primary, filter: `drop-shadow(0 2px 5px rgba(${rgb},0.22))` },
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
