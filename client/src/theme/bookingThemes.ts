import { createTheme, lighten, darken, getLuminance, hexToRgb, type Theme } from '@mui/material/styles'
import baseTheme, { elevation } from './theme'

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

export type BookingThemeKey = 'citrus' | 'emerald' | 'terracotta' | 'brass' | 'indigo'

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
}

export const BOOKING_THEMES: Record<BookingThemeKey, BookingTheme> = {
  // Ink & Citrus — the Vis signature: a confident ink sidebar with a warm
  // citrus accent and a honey-gold price. Welcoming and energetic. The default.
  citrus: {
    key: 'citrus',
    label: 'ციტრუსი',
    sidebar: '#1E2433',
    sidebarText: 'light',
    pageBg: '#FBF8F4',
    primary: '#FF6B35',
    primaryLight: '#FF8B5E',
    primaryDark: '#E55320',
    deep: '#F6B042', // honey — lifts the price off the page
    tint: '#FFE9DD',
    rgb: '255,107,53',
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

export const DEFAULT_BOOKING_THEME: BookingThemeKey = 'citrus'

/** A stored booking_theme is a custom brand colour when it's a #RRGGBB hex. */
const HEX_RE = /^#[0-9a-f]{6}$/i
export function isCustomBookingColor(key: string | null | undefined): boolean {
  return !!key && HEX_RE.test(key)
}

/**
 * Build a full booking theme from a single brand colour (the business's custom
 * accent). Derives the light/dark/tint shades so one colour themes the entire
 * booking UI — buttons, inputs, cards, progress, staff pills — exactly like a
 * preset. `key` is the hex itself so makeBookingTheme's cache keys per colour.
 */
export function customBookingTheme(hex: string): BookingTheme {
  const rgb = hexToRgb(hex).replace(/^rgb\(|\)$/g, '') // "r, g, b" → strip wrapper
  // Light brand colours (pale) need dark sidebar text to stay legible.
  const light = getLuminance(hex) > 0.5
  return {
    key: hex as BookingThemeKey,
    label: hex.toUpperCase(),
    sidebar: hex,
    sidebarText: light ? 'dark' : 'light',
    pageBg: lighten(hex, 0.94),
    primary: hex,
    primaryLight: lighten(hex, 0.35),
    primaryDark: darken(hex, 0.25),
    deep: darken(hex, 0.25),
    tint: lighten(hex, 0.85),
    rgb: rgb.replace(/\s/g, ''),
  }
}

/** Resolve a stored value to a theme: a custom hex, a preset key, or the default. */
export function getBookingTheme(key: string | null | undefined): BookingTheme {
  if (key && HEX_RE.test(key)) return customBookingTheme(key)
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
      // The admin theme is flat/mature; the booking pages keep their softer,
      // lifted look — so we re-specify the button + card here rather than inherit
      // the flattened base (the user considers the booking flow finished).
      MuiButton: {
        styleOverrides: {
          root: { transition: 'all 0.18s ease', '&:active': { transform: 'scale(0.97)' } },
          contained: {
            boxShadow: `0 1px 2px rgba(${rgb},0.12)`,
            '&:hover': { boxShadow: `0 3px 10px rgba(${rgb},0.18)`, transform: 'translateY(-1px)' },
            '&:active': { boxShadow: `0 1px 2px rgba(${rgb},0.12)`, transform: 'scale(0.97) translateY(0)' },
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
            boxShadow: elevation.card,
            borderRadius: 16,
            border: '1px solid rgba(30,36,51,0.07)',
            transition: 'box-shadow 0.2s ease, transform 0.2s ease',
            '&:hover': {
              transform: 'translateY(-2px)',
              boxShadow: `0 8px 24px rgba(${rgb},0.10), 0 2px 8px rgba(0,0,0,0.04)`,
            },
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
              // An invalid field must stay red while focused (e.g. right after
              // submit focuses it), not flip to the tenant accent colour.
              '&.Mui-error.Mui-focused': { boxShadow: '0 0 0 3px rgba(211,47,47,0.12)' },
              '&.Mui-error.Mui-focused .MuiOutlinedInput-notchedOutline': { borderColor: '#d32f2f' },
            },
            '& .MuiInputLabel-root.Mui-focused': { color: primary },
            '& .MuiInputLabel-root.Mui-focused.Mui-error': { color: '#d32f2f' },
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
