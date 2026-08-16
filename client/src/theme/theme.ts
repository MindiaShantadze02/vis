import { createTheme } from '@mui/material/styles'

// ── Brand palette: "Deep Harbor" ─────────────────────────────
// The admin panel should feel calm, mature and precise — a clean near-white
// surface with the whole chrome living in ONE dark blue family: blue-navy ink
// for text and sidebars, and a dark Prussian/petrol accent (no bright SaaS
// blue anywhere) used sparingly (primary CTAs + active markers only). The
// louder colour lives on per-tenant booking pages (see bookingThemes.ts),
// not in the admin chrome.

export const INK = {
  900: '#0D1626',
  800: '#101B2D',
  700: '#16233A', // brand ink — text, headings, avatars
  600: '#21314D',
  500: '#32435F',
}

// Dark Prussian/petrol blue — deep and restrained (was the muted terracotta
// #C15F3E). Applied only to primary buttons, the active-nav marker, focus
// rings and the "on" switch/progress state.
const ACCENT = {
  light: '#4E7FA4',
  main:  '#1D5B84',
  dark:  '#164A6D',
  deep:  '#113A57',
}

export const HONEY = '#F6B042' // reserved accent — price/total on booking pages

// rgb tuples for translucent tints/shadows
const ACCENT_RGB = '29,91,132'
const INK_RGB = '22,35,58'

// Error red (palette.error.main) — needed as constants for the focused+error
// field overrides below.
const ERROR_MAIN = '#DC3C45'
const ERROR_RGB = '220,60,69'

// ── Shared design tokens ──────────────────────────────────────

// A single neutral hairline for every border/divider — kills the old boxy
// look of three near-identical ink alphas (0.07 / 0.08 / 0.10).
export const HAIRLINE = '#E3E7ED'

export const elevation = {
  card:      '0 1px 3px rgba(22,35,58,0.06), 0 1px 2px rgba(22,35,58,0.04)',
  cardHover: `0 8px 24px rgba(${ACCENT_RGB},0.12), 0 2px 8px rgba(22,35,58,0.05)`,
  glow:      `0 4px 16px rgba(${ACCENT_RGB},0.28)`,
  glowSoft:  `0 4px 12px rgba(${ACCENT_RGB},0.16)`,
  modal:     '0 24px 48px rgba(13,22,38,0.16), 0 0 0 1px rgba(22,35,58,0.06)',
}

// One small radius scale so nested elements share a rhythm (was 2/3/4/5/8/10/
// 12/16/20 scattered everywhere).
export const radii = { control: 10, card: 14, pill: 999 }

// Flat brand surfaces (dark chrome for onboarding/superadmin sidebars, logo).
export const gradient = {
  brand:   INK[700],
  topbar:  INK[700],
  sidebar: INK[800],
  panel:   '#FFFFFF',
}

// Neutral hover/selected tints for nav + rows (was citrus-tinted).
export const tint = {
  hover:       `rgba(${INK_RGB},0.04)`,
  hoverBorder: `rgba(${INK_RGB},0.10)`,
}

// Neutral surfaces — section/table headers, inset panels, row hovers. Cool and
// clean to match the near-white page (was warm chalk).
export const surface = {
  header: '#EFF2F6', // section/table headers
  subtle: '#F7F9FB', // inset summary panels
  hover:  `rgba(${INK_RGB},0.035)`, // row hover
}

// Warm display serif for headings (Georgian-capable → personality without loudness).
export const displayFont = '"Noto Serif Georgian", "Noto Serif", Georgia, serif'

// ── Layout width tokens ───────────────────────────────────────
// Settings pages are uncapped — they fill the content area like the calendar.
export const LAYOUT = {
  narrowCard: 460, // centered single-purpose cards (auth, confirmation)
  bookingStep: 560, // booking step column
}

const theme = createTheme({
  palette: {
    primary: {
      main:         ACCENT.main,
      light:        ACCENT.light,
      dark:         ACCENT.dark,
      contrastText: '#FFFFFF',
    },
    secondary: {
      main:         '#E7EEF4', // pale ice-blue tint — empty-state/selected surfaces
      contrastText: ACCENT.deep,
    },
    background: {
      default: '#F6F8FA', // clean cool near-white
      paper:   '#FFFFFF',
    },
    // Status palette — muted, semantic (StatusChip: approved→success,
    // rejected/no_show→error, completed→info, cancelled→default).
    success: {
      main:         '#0E9F6E',
      light:        '#D6F3E7',
      dark:         '#0A7D55',
      contrastText: '#FFFFFF',
    },
    warning: {
      main:         '#C8801F',
      light:        '#FBEFD8',
      dark:         '#9A5C0F',
      contrastText: '#FFFFFF',
    },
    error: {
      main:         ERROR_MAIN,
      light:        '#FBE0E1',
      dark:         '#B82A33',
      contrastText: '#FFFFFF',
    },
    info: {
      main:         '#5B7A99',
      light:        '#E5ECF2',
      dark:         '#415D75',
      contrastText: '#FFFFFF',
    },
    text: {
      primary:   INK[700],
      secondary: '#54627A', // cool slate
      disabled:  '#96A0B2',
    },
    divider: HAIRLINE,
  },

  typography: {
    fontFamily: '"Google Sans", "Noto Sans Georgian", "Noto Sans", "Roboto", sans-serif',
    h1: { fontFamily: displayFont, fontWeight: 700, letterSpacing: '-0.25px' },
    h2: { fontFamily: displayFont, fontWeight: 700, letterSpacing: '-0.25px' },
    h3: { fontFamily: displayFont, fontWeight: 700, letterSpacing: '-0.15px' },
    h4: { fontFamily: displayFont, fontWeight: 700, letterSpacing: '-0.15px' },
    h5: { fontFamily: displayFont, fontWeight: 700, letterSpacing: '-0.1px' },
    h6:        { fontWeight: 600, letterSpacing: '-0.15px' },
    subtitle1: { fontWeight: 600, letterSpacing: '-0.15px', lineHeight: 1.4 },
    subtitle2: { fontWeight: 600, letterSpacing: '-0.1px' },
    body1:   { lineHeight: 1.65, letterSpacing: '-0.05px' },
    body2:   { lineHeight: 1.55, letterSpacing: '-0.05px' },
    caption: { lineHeight: 1.45, letterSpacing: '0.1px' },
    button:  { textTransform: 'none', fontWeight: 600, letterSpacing: '-0.1px' },
  },

  shape: { borderRadius: 12 },

  components: {
    MuiButton: {
      styleOverrides: {
        root: {
          borderRadius: radii.control,
          padding: '10px 24px',
          fontWeight: 600,
          transition: 'background-color 0.15s ease, border-color 0.15s ease, color 0.15s ease',
        },
        // Flat: solid accent that simply darkens on hover — no glow, no lift.
        contained: {
          boxShadow: 'none',
          '&:hover': { boxShadow: 'none', backgroundColor: ACCENT.dark },
          '&:active': { boxShadow: 'none' },
        },
        outlined: {
          borderColor: `rgba(${INK_RGB},0.18)`,
          '&:hover': {
            borderColor: ACCENT.main,
            backgroundColor: `rgba(${INK_RGB},0.03)`,
          },
        },
        text: {
          '&:hover': { backgroundColor: `rgba(${INK_RGB},0.04)` },
        },
        sizeSmall: { padding: '6px 14px', fontSize: '0.8125rem' },
        sizeLarge: { padding: '13px 30px', fontSize: '1rem', borderRadius: 12 },
      },
    },

    // Flat hairline card: one faint border, no shadow, no hover-lift.
    MuiCard: {
      styleOverrides: {
        root: {
          boxShadow: 'none',
          borderRadius: radii.card,
          border: `1px solid ${HAIRLINE}`,
          backgroundImage: 'none',
        },
      },
    },

    MuiPaper: {
      styleOverrides: {
        // Keep elevated Paper (menus/popovers) from painting the tonal overlay,
        // so surfaces stay clean white.
        root: { backgroundImage: 'none' },
      },
    },

    MuiTextField: {
      defaultProps: { variant: 'outlined' },
      styleOverrides: {
        root: {
          '& .MuiOutlinedInput-root': {
            borderRadius: radii.control,
            transition: 'box-shadow 0.15s ease',
            '&:hover .MuiOutlinedInput-notchedOutline': {
              borderColor: `rgba(${INK_RGB},0.34)`,
            },
            '&.Mui-focused': {
              boxShadow: `0 0 0 3px rgba(${ACCENT_RGB},0.14)`,
            },
            '&.Mui-focused .MuiOutlinedInput-notchedOutline': {
              borderColor: ACCENT.main,
              borderWidth: '1.5px',
            },
            // An invalid field must stay red while focused (e.g. right after
            // submit focuses it), not flip to the accent blue.
            '&.Mui-error.Mui-focused': {
              boxShadow: `0 0 0 3px rgba(${ERROR_RGB},0.14)`,
            },
            '&.Mui-error.Mui-focused .MuiOutlinedInput-notchedOutline': {
              borderColor: ERROR_MAIN,
            },
          },
          '& .MuiInputLabel-root.Mui-focused': {
            color: ACCENT.dark,
          },
          '& .MuiInputLabel-root.Mui-focused.Mui-error': {
            color: ERROR_MAIN,
          },
        },
      },
    },

    MuiChip: {
      styleOverrides: {
        root: { borderRadius: 8, fontWeight: 500 },
      },
    },

    MuiLinearProgress: {
      styleOverrides: {
        root: {
          height: 6,
          borderRadius: 999,
          backgroundColor: `rgba(${INK_RGB},0.08)`,
        },
        bar: {
          borderRadius: 999,
          backgroundColor: ACCENT.main,
          transition: 'transform 0.5s cubic-bezier(0.16,1,0.3,1)',
        },
      },
    },

    MuiStepIcon: {
      styleOverrides: {
        root: {
          color: `rgba(${INK_RGB},0.18)`,
          '&.Mui-active': { color: ACCENT.main },
          '&.Mui-completed': { color: '#0E9F6E' },
        },
      },
    },

    MuiStepConnector: {
      styleOverrides: {
        line: { borderColor: HAIRLINE },
      },
    },

    MuiStepLabel: {
      styleOverrides: {
        label: {
          '&.Mui-active':    { fontWeight: 600, color: ACCENT.dark },
          '&.Mui-completed': { fontWeight: 500 },
        },
      },
    },

    // Neutral segmented control — the selected segment reads via a soft gray
    // fill + ink text, not a coloured wash.
    MuiToggleButton: {
      styleOverrides: {
        root: {
          borderRadius: radii.control,
          textTransform: 'none',
          fontWeight: 500,
          transition: 'all 0.15s ease',
          '&.Mui-selected': {
            backgroundColor: `rgba(${INK_RGB},0.06)`,
            color: INK[700],
            borderColor: `rgba(${INK_RGB},0.20)`,
            fontWeight: 600,
            '&:hover': { backgroundColor: `rgba(${INK_RGB},0.09)` },
          },
        },
      },
    },

    MuiToggleButtonGroup: {
      styleOverrides: {
        root: { borderRadius: radii.control },
      },
    },

    MuiDialog: {
      styleOverrides: {
        paper: {
          borderRadius: 16,
          boxShadow: '0 24px 48px rgba(13,22,38,0.16), 0 0 0 1px rgba(22,35,58,0.06)',
        },
      },
    },

    MuiListItemButton: {
      styleOverrides: {
        root: {
          borderRadius: radii.control,
          transition: 'all 0.15s ease',
        },
      },
    },

    MuiTabs: {
      styleOverrides: {
        root: {
          borderRadius: radii.control,
          backgroundColor: '#ECF0F5',
          padding: '3px',
          minHeight: 40,
        },
        indicator: {
          height: '100%',
          borderRadius: 8,
          backgroundColor: '#FFFFFF',
          boxShadow: '0 1px 3px rgba(0,0,0,0.08)',
          zIndex: 0,
        },
      },
    },

    MuiTab: {
      styleOverrides: {
        root: {
          textTransform: 'none',
          fontWeight: 500,
          minHeight: 34,
          padding: '6px 16px',
          borderRadius: 8,
          zIndex: 1,
          color: '#54627A',
          transition: 'color 0.15s ease',
          '&.Mui-selected': { color: INK[700], fontWeight: 600 },
        },
      },
    },

    // Flat pill switch — off = ink tint, on = muted accent.
    MuiSwitch: {
      styleOverrides: {
        root: { width: 42, height: 24, padding: 0 },
        switchBase: {
          padding: 0,
          margin: 3,
          transitionDuration: '250ms',
          color: '#FFFFFF',
          '&.Mui-checked': {
            transform: 'translateX(18px)',
            color: '#FFFFFF',
            '& + .MuiSwitch-track': {
              backgroundColor: ACCENT.main,
              opacity: 1,
              border: 0,
            },
          },
          '&.Mui-disabled + .MuiSwitch-track': { opacity: 0.4 },
        },
        thumb: {
          boxSizing: 'border-box',
          width: 18,
          height: 18,
          boxShadow: '0 1px 2px rgba(22,35,58,0.25)',
        },
        track: {
          borderRadius: 12,
          backgroundColor: `rgba(${INK_RGB},0.22)`,
          opacity: 1,
          transition: 'background-color 250ms',
        },
      },
    },

    MuiFormControlLabel: {
      styleOverrides: {
        root: {
          '& .MuiSwitch-root': { marginRight: 6 },
        },
      },
    },

    MuiAvatar: {
      styleOverrides: {
        root: {
          backgroundColor: INK[700],
          fontWeight: 700,
        },
      },
    },

    MuiAppBar: {
      styleOverrides: {
        root: { backgroundImage: 'none' },
      },
    },

    MuiBadge: {
      styleOverrides: {
        badge: { fontWeight: 700 },
      },
    },

    // Flat accordion — hairline border, no shadow (even when expanded).
    MuiAccordion: {
      styleOverrides: {
        root: {
          borderRadius: '12px !important',
          border: `1px solid ${HAIRLINE}`,
          boxShadow: 'none',
          '&:before': { display: 'none' },
        },
      },
    },
  },
})

export default theme
