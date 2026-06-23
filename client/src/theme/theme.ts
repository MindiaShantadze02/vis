import { createTheme } from '@mui/material/styles'

const INDIGO = {
  50:  '#EEF2FF',
  100: '#E0E7FF',
  200: '#C7D2FE',
  300: '#A5B4FC',
  400: '#818CF8',
  500: '#6366F1',
  600: '#4F46E5',
  700: '#4338CA',
  800: '#3730A3',
  900: '#312E81',
}

// "r,g,b" of the brand indigo (INDIGO[600]). Single source for the
// translucent shadows/tints reused across the component overrides below,
// so re-skinning the brand is a one-line change.
const BRAND_RGB = '79,70,229'

// ── Shared design tokens ──────────────────────────────────────
// Single source of truth for the brand-tinted shadows and surfaces that
// were previously re-typed inline across pages.

export const elevation = {
  card:     '0 1px 3px rgba(0,0,0,0.06), 0 1px 2px rgba(0,0,0,0.04)',
  cardHover: `0 8px 24px rgba(${BRAND_RGB},0.10), 0 2px 8px rgba(0,0,0,0.04)`,
  glow:     `0 4px 16px rgba(${BRAND_RGB},0.30)`,
  glowSoft: `0 4px 12px rgba(${BRAND_RGB},0.18)`,
  modal:    `0 24px 48px rgba(0,0,0,0.12), 0 0 0 1px rgba(${BRAND_RGB},0.06)`,
}

// Flat brand surfaces (gradients removed — kept as a named map so page
// backgrounds stay consistent and in one place).
export const gradient = {
  brand:   INDIGO[600],
  topbar:  INDIGO[600],
  sidebar: INDIGO[800],
  panel:   '#FFFFFF',
}

// Subtle indigo tints for hover/selected surfaces (e.g. nav items).
export const tint = {
  hover:       `rgba(${BRAND_RGB},0.05)`,
  hoverBorder: `rgba(${BRAND_RGB},0.20)`,
}

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
      main:         INDIGO[600],
      light:        INDIGO[400],
      dark:         INDIGO[800],
      contrastText: '#FFFFFF',
    },
    secondary: {
      main:         INDIGO[50],
      contrastText: INDIGO[800],
    },
    background: {
      default: '#F5F5FF',
      paper:   '#FFFFFF',
    },
    // ── Status palette ──────────────────────────────────────────
    // Cool, harmonized status tones tuned to sit calmly beside the
    // indigo brand. Drive appointment status presentation (see
    // StatusChip): approved→success, pending→warning, rejected→error,
    // completed→info. `light` values are pale tints used as surfaces.
    success: {
      main:         '#0E9F6E', // approved — teal-green
      light:        '#D6F3E7',
      dark:         '#0A7D55',
      contrastText: '#FFFFFF',
    },
    warning: {
      main:         '#B7791F', // pending — muted amber
      light:        '#FBF1DD',
      dark:         '#8C5A12',
      contrastText: '#FFFFFF',
    },
    error: {
      main:         '#E0524B', // rejected — soft coral-red
      light:        '#FBE2E0',
      dark:         '#BE3B34',
      contrastText: '#FFFFFF',
    },
    info: {
      main:         INDIGO[500], // completed — brand indigo
      light:        '#E8E9FD',
      dark:         INDIGO[700],
      contrastText: '#FFFFFF',
    },
    text: {
      primary:   '#0D2137',
      secondary: '#5B6B7B',
      disabled:  '#A4B0BC',
    },
    divider: `rgba(${BRAND_RGB},0.10)`,
  },

  typography: {
    fontFamily: '"Noto Sans Georgian", "Noto Sans", "Roboto", sans-serif',
    h1: { fontWeight: 700, letterSpacing: '-0.5px' },
    h2: { fontWeight: 700, letterSpacing: '-0.5px' },
    h3: { fontWeight: 600, letterSpacing: '-0.3px' },
    h4: { fontWeight: 600, letterSpacing: '-0.3px' },
    h5: { fontWeight: 600, letterSpacing: '-0.2px' },
    h6: { fontWeight: 600 },
    body1: { lineHeight: 1.6 },
    body2: { lineHeight: 1.5 },
    caption: { lineHeight: 1.4 },
    button: { textTransform: 'none', fontWeight: 600 },
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
          boxShadow: `0 1px 3px rgba(${BRAND_RGB},0.18)`,
          '&:hover': {
            boxShadow: `0 4px 16px rgba(${BRAND_RGB},0.30)`,
            transform: 'translateY(-1px)',
          },
          '&:active': {
            boxShadow: `0 1px 3px rgba(${BRAND_RGB},0.18)`,
            transform: 'scale(0.97) translateY(0)',
          },
        },
        outlined: {
          borderColor: `rgba(${BRAND_RGB},0.35)`,
          '&:hover': {
            borderColor: INDIGO[600],
            backgroundColor: `rgba(${BRAND_RGB},0.04)`,
          },
        },
        text: {
          '&:hover': { backgroundColor: `rgba(${BRAND_RGB},0.06)` },
        },
        sizeSmall: { padding: '6px 14px', fontSize: '0.8125rem' },
        sizeLarge: { padding: '14px 32px', fontSize: '1rem', borderRadius: 12 },
      },
    },

    MuiCard: {
      styleOverrides: {
        root: {
          boxShadow: '0 1px 3px rgba(0,0,0,0.06), 0 1px 2px rgba(0,0,0,0.04)',
          borderRadius: 16,
          border: `1px solid rgba(${BRAND_RGB},0.06)`,
          transition: 'box-shadow 0.2s ease, transform 0.2s ease',
          '&:hover': {
            boxShadow: `0 8px 24px rgba(${BRAND_RGB},0.10), 0 2px 8px rgba(0,0,0,0.04)`,
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
              borderColor: INDIGO[600],
            },
            '&.Mui-focused': {
              boxShadow: `0 0 0 3px rgba(${BRAND_RGB},0.12)`,
            },
            '&.Mui-focused .MuiOutlinedInput-notchedOutline': {
              borderColor: INDIGO[600],
              borderWidth: '1.5px',
            },
          },
          '& .MuiInputLabel-root.Mui-focused': {
            color: INDIGO[600],
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
          backgroundColor: `rgba(${BRAND_RGB},0.10)`,
        },
        bar: {
          borderRadius: 2,
          backgroundColor: INDIGO[600],
          transition: 'transform 0.5s cubic-bezier(0.16,1,0.3,1)',
        },
      },
    },

    MuiStepIcon: {
      styleOverrides: {
        root: {
          color: `rgba(${BRAND_RGB},0.20)`,
          '&.Mui-active': {
            color: INDIGO[600],
            filter: `drop-shadow(0 2px 6px rgba(${BRAND_RGB},0.35))`,
          },
          '&.Mui-completed': { color: '#0E9F6E' },
        },
      },
    },

    MuiStepConnector: {
      styleOverrides: {
        line: { borderColor: `rgba(${BRAND_RGB},0.20)` },
      },
    },

    MuiStepLabel: {
      styleOverrides: {
        label: {
          '&.Mui-active':    { fontWeight: 600, color: INDIGO[600] },
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
            backgroundColor: `rgba(${BRAND_RGB},0.10)`,
            color: INDIGO[700],
            borderColor: INDIGO[600],
            fontWeight: 600,
            '&:hover': { backgroundColor: `rgba(${BRAND_RGB},0.15)` },
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
          boxShadow: `0 24px 48px rgba(0,0,0,0.12), 0 0 0 1px rgba(${BRAND_RGB},0.06)`,
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
          backgroundColor: '#ECEAFB',
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
          color: '#5B6B7B',
          transition: 'color 0.15s ease',
          '&.Mui-selected': { color: '#0D2137', fontWeight: 600 },
        },
      },
    },

    MuiSwitch: {
      styleOverrides: {
        switchBase: {
          '&.Mui-checked': {
            color: INDIGO[600],
            '& + .MuiSwitch-track': {
              backgroundColor: INDIGO[600],
              opacity: 0.5,
            },
          },
        },
      },
    },

    MuiAvatar: {
      styleOverrides: {
        root: {
          backgroundColor: INDIGO[600],
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
          border: `1px solid rgba(${BRAND_RGB},0.08)`,
          boxShadow: 'none',
          '&:before': { display: 'none' },
          '&.Mui-expanded': {
            boxShadow: `0 4px 16px rgba(${BRAND_RGB},0.08)`,
          },
        },
      },
    },
  },
})

export default theme
