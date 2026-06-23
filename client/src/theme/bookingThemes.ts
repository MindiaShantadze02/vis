import { createTheme, type Theme } from '@mui/material/styles'
import baseTheme from './theme'

// Per-organisation colour themes for the public booking pages (the flow your
// customers actually see). Deliberately a small, curated set — ranging from
// professional/business to fresh/sporty, plus a clean white — so owners get
// personality without an overwhelming colour-picker.
//
// All themes are flat (no gradients). Most use a rich, confident solid colour
// panel with light text; 'white' is a clean minimal light panel. Each pairs the
// sidebar with a near-white page background and a refined accent colour applied
// to buttons, inputs, the stepper, selected cards, etc. via a derived MUI theme
// (see makeBookingTheme).

export type BookingThemeKey = 'indigo' | 'blue' | 'ocean' | 'sunset' | 'sporty' | 'rose' | 'white'

export interface BookingTheme {
  key: BookingThemeKey
  /** Georgian label shown in the settings picker. */
  label: string
  /** Solid (flat) background colour for the booking sidebar panel. */
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
  /**
   * Optional colour shown in the settings picker dot. Defaults to `primary`.
   * Override when the accent doesn't represent the theme's name — e.g. the
   * 'white' theme's accent is near-black slate, so its dot shows white.
   */
  swatch?: string
}

export const BOOKING_THEMES: Record<BookingThemeKey, BookingTheme> = {
  // Indigo-violet — the app default. Light & airy: a soft lavender panel with
  // dark text and a gentle indigo accent, so the customer-facing flow feels
  // calm and welcoming while still echoing the admin brand.
  indigo: {
    key: 'indigo',
    label: 'ინდიგო',
    sidebar: '#EEF2FF',
    sidebarText: 'dark',
    pageBg: '#FAFAFF',
    primary: '#6366F1',
    primaryLight: '#C7D2FE',
    primaryDark: '#4F46E5',
    rgb: '99,102,241',
  },
  // Azure blue — classic, trustworthy, professional.
  blue: {
    key: 'blue',
    label: 'ლურჯი',
    sidebar: '#1D4ED8',
    sidebarText: 'light',
    pageBg: '#F5F8FE',
    primary: '#2563EB',
    primaryLight: '#93C5FD',
    primaryDark: '#1E40AF',
    rgb: '37,99,235',
  },
  // Deep teal — calm, fresh and clean. Great for spas and clinics.
  ocean: {
    key: 'ocean',
    label: 'ფირუზისფერი',
    sidebar: '#0E7490',
    sidebarText: 'light',
    pageBg: '#F1FAFC',
    primary: '#0891B2',
    primaryLight: '#67E8F9',
    primaryDark: '#155E75',
    rgb: '8,145,178',
  },
  // Burnt amber — warm and inviting, with a premium feel.
  sunset: {
    key: 'sunset',
    label: 'ნარინჯისფერი',
    sidebar: '#C2410C',
    sidebarText: 'light',
    pageBg: '#FFF7F2',
    primary: '#EA580C',
    primaryLight: '#FDBA74',
    primaryDark: '#9A3412',
    rgb: '234,88,12',
  },
  // Emerald green — fresh and energetic without being loud.
  sporty: {
    key: 'sporty',
    label: 'მწვანე',
    sidebar: '#047857',
    sidebarText: 'light',
    pageBg: '#F1FBF6',
    primary: '#059669',
    primaryLight: '#6EE7B7',
    primaryDark: '#065F46',
    rgb: '5,150,105',
  },
  // Rose — warm and stylish, great for beauty and wellness. Light & airy: a
  // soft blush panel with dark text and a gentle rose accent.
  rose: {
    key: 'rose',
    label: 'ვარდისფერი',
    sidebar: '#FFF1F5',
    sidebarText: 'dark',
    pageBg: '#FFFAFB',
    primary: '#E5446A',
    primaryLight: '#FBCFE0',
    primaryDark: '#BE2C54',
    rgb: '229,68,106',
  },
  // Minimal — a clean light panel separated from the white content by a
  // hairline border, with a sleek near-black slate accent.
  white: {
    key: 'white',
    label: 'თეთრი',
    sidebar: '#F8FAFC',
    sidebarText: 'dark',
    pageBg: '#FFFFFF',
    primary: '#1E293B',
    primaryLight: '#94A3B8',
    primaryDark: '#0F172A',
    rgb: '30,41,59',
    swatch: '#FFFFFF',
  },
}

export const BOOKING_THEME_LIST: BookingTheme[] = Object.values(BOOKING_THEMES)

export const DEFAULT_BOOKING_THEME: BookingThemeKey = 'indigo'

/** Resolve a stored key (possibly null/unknown) to a theme, falling back to default. */
export function getBookingTheme(key: string | null | undefined): BookingTheme {
  return BOOKING_THEMES[(key as BookingThemeKey)] ?? BOOKING_THEMES[DEFAULT_BOOKING_THEME]
}

// Cache derived MUI themes so we don't rebuild on every render.
const muiThemeCache = new Map<BookingThemeKey, Theme>()

/**
 * Build an MUI theme variant whose accent (primary) follows the booking theme.
 * Re-points every base component override (buttons, inputs, stepper, toggles,
 * progress) at the theme's colour so the entire booking page is themed, not
 * just the sidebar.
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
            '&.Mui-completed': { color: '#0E9F6E' },
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
          bar: { backgroundColor: primary },
        },
      },
      MuiAvatar: {
        styleOverrides: {
          root: { backgroundColor: primary },
        },
      },
    },
  })

  muiThemeCache.set(bt.key, theme)
  return theme
}
