import { createTheme } from '@mui/material/styles'

// ── Brand palette: "Warm Ink & Citrus" ───────────────────────
// Grafiki (გრაფიკი = "schedule") should feel like being warmly welcomed
// and confidently looked-after — not like a framework default. Confident
// near-ink charcoal-navy carries the brand; a citrus accent brings the
// energy; honey lifts prices and celebratory moments.

const INK = {
  900: '#161B26',
  800: '#181D29',
  700: '#1E2433', // brand ink — text, sidebar, headings
  600: '#2A3242',
  500: '#3A4253',
}

const CITRUS = {
  light: '#FF8B5E',
  main:  '#FF6B35', // signature accent — CTAs, selected states
  dark:  '#E55320',
  deep:  '#C2441A',
}

export const HONEY = '#F6B042' // second accent — price/total, celebratory sparkle

// rgb tuples for translucent shadows/tints
const CITRUS_RGB = '255,107,53'
const INK_RGB = '30,36,51'

// ── Shared design tokens ──────────────────────────────────────
// Single source of truth for the tinted shadows and brand surfaces
// that were previously re-typed inline across pages.

export const elevation = {
  card:      '0 1px 3px rgba(30,36,51,0.06), 0 1px 2px rgba(30,36,51,0.04)',
  cardHover: `0 8px 24px rgba(${CITRUS_RGB},0.12), 0 2px 8px rgba(30,36,51,0.05)`,
  glow:      `0 4px 16px rgba(${CITRUS_RGB},0.32)`,
  glowSoft:  `0 4px 12px rgba(${CITRUS_RGB},0.18)`,
  modal:     '0 24px 48px rgba(22,27,38,0.16), 0 0 0 1px rgba(30,36,51,0.06)',
}

// Flat brand surfaces (kept as a named map so page chrome stays consistent
// and lives in one place). Ink chrome lets the citrus accent stay the star.
export const gradient = {
  brand:   INK[700],
  topbar:  INK[700],
  sidebar: INK[800],
  panel:   '#FFFFFF',
}

// Subtle citrus tints for hover/selected surfaces (e.g. nav items).
export const tint = {
  hover:       `rgba(${CITRUS_RGB},0.06)`,
  hoverBorder: `rgba(${CITRUS_RGB},0.22)`,
}

// Warm display stack for headings (Georgian-capable serif → personality).
export const displayFont = '"Noto Serif Georgian", "Noto Serif", Georgia, serif'

// ── Layout width tokens ───────────────────────────────────────
// Named max-widths so page containers stay consistent within each
// context instead of drifting across hardcoded values (600/640/680…).
export const LAYOUT = {
  formPage:   720, // settings + content-form pages
  narrowCard: 460, // centered single-purpose cards (auth, confirmation)
  bookingStep: 560, // booking step column
}

const theme = createTheme({
  palette: {
    primary: {
      main:         CITRUS.main,
      light:        CITRUS.light,
      dark:         CITRUS.dark,
      contrastText: '#FFFFFF',
    },
    secondary: {
      main:         '#FFE9DD', // pale citrus tint — chip/avatar/empty-state surfaces
      contrastText: CITRUS.deep,
    },
    background: {
      default: '#FBF8F4', // warm chalk
      paper:   '#FFFFFF',
    },
    // ── Status palette ──────────────────────────────────────────
    // Tuned to sit warmly beside the citrus accent. Drive appointment
    // status presentation (see StatusChip): approved→success,
    // pending→warning, rejected→error, completed→info. `light` values
    // are pale tints used as surfaces.
    success: {
      main:         '#0E9F6E', // approved — pine green
      light:        '#D6F3E7',
      dark:         '#0A7D55',
      contrastText: '#FFFFFF',
    },
    warning: {
      main:         '#C8801F', // pending — warm amber
      light:        '#FBEFD8',
      dark:         '#9A5C0F',
      contrastText: '#FFFFFF',
    },
    error: {
      main:         '#DC3C45', // rejected — crimson (distinct from citrus orange)
      light:        '#FBE0E1',
      dark:         '#B82A33',
      contrastText: '#FFFFFF',
    },
    info: {
      main:         '#5B7A99', // completed — calm slate-blue (reads "done/archived")
      light:        '#E5ECF2',
      dark:         '#415D75',
      contrastText: '#FFFFFF',
    },
    text: {
      primary:   INK[700],
      secondary: '#5A6273', // slate
      disabled:  '#9AA1AE',
    },
    divider: `rgba(${INK_RGB},0.10)`,
  },

  typography: {
    // Body / UI face: Noto Sans Georgian (the only Georgian-capable Google
    // font besides the serif). It's paired with the serif display deliberately,
    // not left to chance: the larger sans roles below borrow the serif's tight,
    // negative tracking so the two families share a rhythm, while body copy
    // stays open and editorial. That shared rhythm is what makes a serif +
    // neutral-sans pairing read as "chosen" rather than mismatched.
    fontFamily: '"Google Sans", "Noto Sans Georgian", "Noto Sans", "Roboto", sans-serif',
    // Headings carry the personality — warm editorial serif. Applied through
    // h5 because pages use h4/h5 for titles (h1–h3 are unused).
    h1: { fontFamily: displayFont, fontWeight: 700, letterSpacing: '-0.25px' },
    h2: { fontFamily: displayFont, fontWeight: 700, letterSpacing: '-0.25px' },
    h3: { fontFamily: displayFont, fontWeight: 700, letterSpacing: '-0.15px' },
    h4: { fontFamily: displayFont, fontWeight: 700, letterSpacing: '-0.15px' },
    h5: { fontFamily: displayFont, fontWeight: 700, letterSpacing: '-0.1px' },
    // Sans subheads bridge the bold serif and the regular body: a semibold step
    // with a hair of negative tracking that echoes the serif above it.
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
          borderRadius: 10,
          padding: '10px 24px',
          fontWeight: 600,
          transition: 'all 0.18s ease',
          '&:active': { transform: 'scale(0.97)' },
        },
        contained: {
          boxShadow: `0 1px 3px rgba(${CITRUS_RGB},0.20)`,
          '&:hover': {
            boxShadow: `0 4px 16px rgba(${CITRUS_RGB},0.32)`,
            transform: 'translateY(-1px)',
          },
          '&:active': {
            boxShadow: `0 1px 3px rgba(${CITRUS_RGB},0.20)`,
            transform: 'scale(0.97) translateY(0)',
          },
        },
        outlined: {
          borderColor: `rgba(${CITRUS_RGB},0.40)`,
          '&:hover': {
            borderColor: CITRUS.dark,
            backgroundColor: `rgba(${CITRUS_RGB},0.05)`,
          },
        },
        text: {
          '&:hover': { backgroundColor: `rgba(${CITRUS_RGB},0.07)` },
        },
        sizeSmall: { padding: '6px 14px', fontSize: '0.8125rem' },
        sizeLarge: { padding: '14px 32px', fontSize: '1rem', borderRadius: 12 },
      },
    },

    MuiCard: {
      styleOverrides: {
        root: {
          boxShadow: '0 1px 3px rgba(30,36,51,0.06), 0 1px 2px rgba(30,36,51,0.04)',
          borderRadius: 16,
          border: `1px solid rgba(${INK_RGB},0.07)`,
          transition: 'box-shadow 0.2s ease, transform 0.2s ease',
          '&:hover': {
            boxShadow: `0 8px 24px rgba(${CITRUS_RGB},0.12), 0 2px 8px rgba(30,36,51,0.05)`,
            transform: 'translateY(-2px)',
          },
        },
      },
    },

    MuiTextField: {
      defaultProps: { variant: 'outlined' },
      styleOverrides: {
        root: {
          '& .MuiOutlinedInput-root': {
            borderRadius: 10,
            transition: 'box-shadow 0.15s ease',
            '&:hover .MuiOutlinedInput-notchedOutline': {
              borderColor: CITRUS.dark,
            },
            '&.Mui-focused': {
              boxShadow: `0 0 0 3px rgba(${CITRUS_RGB},0.14)`,
            },
            '&.Mui-focused .MuiOutlinedInput-notchedOutline': {
              borderColor: CITRUS.dark,
              borderWidth: '1.5px',
            },
          },
          '& .MuiInputLabel-root.Mui-focused': {
            color: CITRUS.dark,
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
          height: 4,
          borderRadius: 2,
          backgroundColor: `rgba(${CITRUS_RGB},0.12)`,
        },
        bar: {
          borderRadius: 2,
          backgroundColor: CITRUS.main,
          transition: 'transform 0.5s cubic-bezier(0.16,1,0.3,1)',
        },
      },
    },

    MuiStepIcon: {
      styleOverrides: {
        root: {
          color: `rgba(${INK_RGB},0.18)`,
          '&.Mui-active': {
            color: CITRUS.main,
            filter: `drop-shadow(0 2px 6px rgba(${CITRUS_RGB},0.35))`,
          },
          '&.Mui-completed': { color: '#0E9F6E' },
        },
      },
    },

    MuiStepConnector: {
      styleOverrides: {
        line: { borderColor: `rgba(${INK_RGB},0.15)` },
      },
    },

    MuiStepLabel: {
      styleOverrides: {
        label: {
          '&.Mui-active':    { fontWeight: 600, color: CITRUS.dark },
          '&.Mui-completed': { fontWeight: 500 },
        },
      },
    },

    MuiToggleButton: {
      styleOverrides: {
        root: {
          borderRadius: 10,
          textTransform: 'none',
          fontWeight: 500,
          transition: 'all 0.15s ease',
          '&.Mui-selected': {
            backgroundColor: `rgba(${CITRUS_RGB},0.10)`,
            color: CITRUS.deep,
            borderColor: CITRUS.main,
            fontWeight: 600,
            '&:hover': { backgroundColor: `rgba(${CITRUS_RGB},0.16)` },
          },
        },
      },
    },

    MuiToggleButtonGroup: {
      styleOverrides: {
        root: { borderRadius: 10 },
      },
    },

    MuiDialog: {
      styleOverrides: {
        paper: {
          borderRadius: 20,
          boxShadow: '0 24px 48px rgba(22,27,38,0.16), 0 0 0 1px rgba(30,36,51,0.06)',
        },
      },
    },

    MuiListItemButton: {
      styleOverrides: {
        root: {
          borderRadius: 10,
          transition: 'all 0.15s ease',
        },
      },
    },

    MuiTabs: {
      styleOverrides: {
        root: {
          borderRadius: 10,
          backgroundColor: '#F0EBE3',
          padding: '3px',
          minHeight: 40,
        },
        indicator: {
          height: '100%',
          borderRadius: 8,
          backgroundColor: '#FFFFFF',
          boxShadow: '0 1px 4px rgba(0,0,0,0.10)',
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
          color: '#5A6273',
          transition: 'color 0.15s ease',
          '&.Mui-selected': { color: INK[700], fontWeight: 600 },
        },
      },
    },

    // Clean rounded "pill" toggle — the thumb sits inside a full-radius track
    // (no overflowing Material shadow), so it reads as flat and modern like the
    // rest of the chrome. Off = ink tint, on = citrus.
    MuiSwitch: {
      styleOverrides: {
        root: {
          width: 42,
          height: 24,
          padding: 0,
        },
        switchBase: {
          padding: 0,
          margin: 3,
          transitionDuration: '250ms',
          color: '#FFFFFF',
          '&.Mui-checked': {
            transform: 'translateX(18px)',
            color: '#FFFFFF',
            '& + .MuiSwitch-track': {
              backgroundColor: CITRUS.main,
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
          boxShadow: '0 1px 2px rgba(30,36,51,0.25)',
        },
        track: {
          borderRadius: 12,
          backgroundColor: `rgba(${INK_RGB},0.22)`,
          opacity: 1,
          transition: 'background-color 250ms',
        },
      },
    },

    // The compact pill has no outer padding, so add a small gap to its label
    // when used in a FormControlLabel (scoped to switches; checkboxes keep theirs).
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

    MuiAccordion: {
      styleOverrides: {
        root: {
          borderRadius: '12px !important',
          border: `1px solid rgba(${INK_RGB},0.08)`,
          boxShadow: 'none',
          '&:before': { display: 'none' },
          '&.Mui-expanded': {
            boxShadow: `0 4px 16px rgba(${CITRUS_RGB},0.10)`,
          },
        },
      },
    },
  },
})

export default theme
