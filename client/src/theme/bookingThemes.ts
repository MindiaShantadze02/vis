import { createTheme, type Theme } from '@mui/material/styles'
import baseTheme from './theme'

// Per-organisation colour themes for the public booking pages (the flow your
// customers actually see). A curated set of five accent directions (see the
// "Customer Form Themes" design): Royal Blue (default) · Emerald · Terracotta ·
// Charcoal & Brass · Indigo.
//
// Each theme drives a single accent across the whole booking UI (buttons,
// inputs, selected cards, progress, staff pills, etc.) via a derived MUI theme
// (see makeBookingTheme). `deep` is a second, independent accent used only for
// the price/total — for most themes it's just a darker shade of the accent, but
// for "Charcoal & Brass" it's the brass gold that lifts the price off the
// charcoal UI.

export type BookingThemeKey = 'blue' | 'emerald' | 'terracotta' | 'brass' | 'indigo'

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
  /**
   * Second accent, used for the price/total. Usually equals `primaryDark`;
   * for the charcoal "brass" theme it's the gold that highlights the price.
   */
  deep: string
  /** Light tinted surface (chips, avatars, focus rings) — MUI `secondary.main`. */
  tint: string
  /** "r,g,b" of the accent — used for the translucent shadows/tints. */
  rgb: string
  /**
   * Optional colour shown in the settings picker dot. Defaults to `primary`.
   */
  swatch?: string
}

export const BOOKING_THEMES: Record<BookingThemeKey, BookingTheme> = {
  // Royal Blue — classic, trustworthy, professional. The current/default look.
  blue: {
    key: 'blue',
    label: 'ლურჯი',
    sidebar: '#1565C0',
    sidebarText: 'light',
    pageBg: '#F5F8FD',
    primary: '#1565C0',
    primaryLight: '#90CAF9',
    primaryDark: '#0D47A1',
    deep: '#0D47A1',
    tint: '#E3F2FD',
    rgb: '21,101,192',
  },
  // Emerald — clean and calming. Great for spas, clinics and wellness.
  emerald: {
    key: 'emerald',
    label: 'ზურმუხტისფერი',
    sidebar: '#0E9F6E',
    sidebarText: 'light',
    pageBg: '#F1FBF6',
    primary: '#0E9F6E',
    primaryLight: '#6EE7B7',
    primaryDark: '#047857',
    deep: '#047857',
    tint: '#E2F4EC',
    rgb: '14,159,110',
  },
  // Terracotta — warm and earthy, with a grooming/barber feel.
  terracotta: {
    key: 'terracotta',
    label: 'ტერაკოტა',
    sidebar: '#C4572F',
    sidebarText: 'light',
    pageBg: '#FDF6F2',
    primary: '#C4572F',
    primaryLight: '#F0AE90',
    primaryDark: '#9A3412',
    deep: '#9A3412',
    tint: '#F8EAE2',
    rgb: '196,87,47',
  },
  // Charcoal & Brass — premium and classic: a charcoal UI with a brass-gold
  // price. The only two-tone theme (accent ≠ deep).
  brass: {
    key: 'brass',
    label: 'გრაფიტი',
    sidebar: '#2C3138',
    sidebarText: 'light',
    pageBg: '#F7F8FA',
    primary: '#2C3138',
    primaryLight: '#9AA1A9',
    primaryDark: '#1A1E23',
    deep: '#A9803F',
    tint: '#ECEEF1',
    rgb: '44,49,56',
    swatch: '#A9803F',
  },
  // Indigo — modern and confident.
  indigo: {
    key: 'indigo',
    label: 'ინდიგო',
    sidebar: '#5B4BE0',
    sidebarText: 'light',
    pageBg: '#FAFAFF',
    primary: '#5B4BE0',
    primaryLight: '#C7BFFA',
    primaryDark: '#3F36B0',
    deep: '#3F36B0',
    tint: '#ECEAFB',
    rgb: '91,75,224',
  },
}

export const BOOKING_THEME_LIST: BookingTheme[] = Object.values(BOOKING_THEMES)

export const DEFAULT_BOOKING_THEME: BookingThemeKey = 'blue'

/** Resolve a stored key (possibly null/retired/unknown) to a theme, falling back to default. */
export function getBookingTheme(key: string | null | undefined): BookingTheme {
  return BOOKING_THEMES[(key as BookingThemeKey)] ?? BOOKING_THEMES[DEFAULT_BOOKING_THEME]
}

// Cache derived MUI themes so we don't rebuild on every render.
const muiThemeCache = new Map<BookingThemeKey, Theme>()

/**
 * Build an MUI theme variant whose accent (primary) and tint (secondary) follow
 * the booking theme. Re-points every base component override (buttons, inputs,
 * stepper, toggles, progress) at the theme's colour so the entire booking page
 * is themed, not just the sidebar.
 */
export function makeBookingTheme(bt: BookingTheme): Theme {
  const cached = muiThemeCache.get(bt.key)
  if (cached) return cached

  const { primary, primaryLight, primaryDark, tint, rgb, pageBg } = bt
  const theme = createTheme(baseTheme, {
    palette: {
      primary: { main: primary, light: primaryLight, dark: primaryDark, contrastText: '#FFFFFF' },
      // Light tinted surface (selected staff pill, OTP icon badge, empty-state
      // circle…) must follow the theme, not stay blue.
      secondary: { main: tint, contrastText: primaryDark },
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
