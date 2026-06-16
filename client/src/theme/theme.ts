import { createTheme } from '@mui/material/styles'

const GRAPE = {
  50:  '#F5F0FF',
  100: '#EDE8FF',
  200: '#D8CCFF',
  300: '#BCA8FF',
  400: '#A78BFA',
  500: '#8B5CF6',
  600: '#7C3AED',
  700: '#5B21B6',
  800: '#4C1D95',
  900: '#2E1065',
}

// ── Shared design tokens ──────────────────────────────────────
// Single source of truth for the violet-tinted shadows and brand
// gradients that were previously re-typed inline across pages.

export const elevation = {
  card:     '0 1px 3px rgba(0,0,0,0.06), 0 1px 2px rgba(0,0,0,0.04)',
  cardHover: '0 8px 24px rgba(124,58,237,0.10), 0 2px 8px rgba(0,0,0,0.04)',
  glow:     '0 4px 16px rgba(124,58,237,0.30)',
  glowSoft: '0 4px 12px rgba(124,58,237,0.18)',
  modal:    '0 24px 48px rgba(0,0,0,0.12), 0 0 0 1px rgba(124,58,237,0.06)',
}

export const gradient = {
  brand:   `linear-gradient(135deg, ${GRAPE[600]} 0%, ${GRAPE[700]} 100%)`,
  topbar:  `linear-gradient(135deg, ${GRAPE[700]} 0%, ${GRAPE[600]} 100%)`,
  sidebar: `linear-gradient(160deg, ${GRAPE[900]} 0%, ${GRAPE[800]} 40%, ${GRAPE[600]} 100%)`,
  panel:   `linear-gradient(180deg, #FFFFFF 0%, #FAF8FF 100%)`,
}

// Subtle grape tints for hover/selected surfaces (e.g. nav items).
export const tint = {
  hover:       'rgba(124,58,237,0.05)',
  hoverBorder: 'rgba(124,58,237,0.20)',
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
      main:         GRAPE[600],
      light:        GRAPE[400],
      dark:         GRAPE[700],
      contrastText: '#FFFFFF',
    },
    secondary: {
      main:         '#F3EEFF',
      contrastText: GRAPE[700],
    },
    background: {
      default: '#FAF8FF',
      paper:   '#FFFFFF',
    },
    success: {
      main:         '#059669',
      light:        '#D1FAE5',
      dark:         '#047857',
      contrastText: '#FFFFFF',
    },
    warning: {
      main:         '#D97706',
      light:        '#FEF3C7',
      dark:         '#B45309',
      contrastText: '#FFFFFF',
    },
    error: {
      main:         '#DC2626',
      light:        '#FEE2E2',
      dark:         '#B91C1C',
      contrastText: '#FFFFFF',
    },
    info: {
      main:         '#0891B2',
      light:        '#CFFAFE',
      dark:         '#0E7490',
      contrastText: '#FFFFFF',
    },
    text: {
      primary:   '#1C0B38',
      secondary: '#6B6380',
      disabled:  '#A8A0B8',
    },
    divider: 'rgba(124,58,237,0.10)',
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
          boxShadow: '0 1px 3px rgba(124,58,237,0.18)',
          '&:hover': {
            boxShadow: '0 4px 16px rgba(124,58,237,0.30)',
            transform: 'translateY(-1px)',
          },
          '&:active': {
            boxShadow: '0 1px 3px rgba(124,58,237,0.18)',
            transform: 'scale(0.97) translateY(0)',
          },
        },
        outlined: {
          borderColor: 'rgba(124,58,237,0.35)',
          '&:hover': {
            borderColor: GRAPE[600],
            backgroundColor: 'rgba(124,58,237,0.04)',
          },
        },
        text: {
          '&:hover': { backgroundColor: 'rgba(124,58,237,0.06)' },
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
          border: '1px solid rgba(124,58,237,0.06)',
          transition: 'box-shadow 0.2s ease, transform 0.2s ease',
          '&:hover': {
            boxShadow: '0 8px 24px rgba(124,58,237,0.10), 0 2px 8px rgba(0,0,0,0.04)',
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
              borderColor: GRAPE[600],
            },
            '&.Mui-focused': {
              boxShadow: '0 0 0 3px rgba(124,58,237,0.12)',
            },
            '&.Mui-focused .MuiOutlinedInput-notchedOutline': {
              borderColor: GRAPE[600],
              borderWidth: '1.5px',
            },
          },
          '& .MuiInputLabel-root.Mui-focused': {
            color: GRAPE[600],
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
          backgroundColor: 'rgba(124,58,237,0.10)',
        },
        bar: {
          borderRadius: 2,
          background: `linear-gradient(90deg, ${GRAPE[600]} 0%, ${GRAPE[400]} 100%)`,
          transition: 'transform 0.5s cubic-bezier(0.16,1,0.3,1)',
        },
      },
    },

    MuiStepIcon: {
      styleOverrides: {
        root: {
          color: 'rgba(124,58,237,0.20)',
          '&.Mui-active': {
            color: GRAPE[600],
            filter: 'drop-shadow(0 2px 6px rgba(124,58,237,0.35))',
          },
          '&.Mui-completed': { color: '#059669' },
        },
      },
    },

    MuiStepConnector: {
      styleOverrides: {
        line: { borderColor: 'rgba(124,58,237,0.20)' },
      },
    },

    MuiStepLabel: {
      styleOverrides: {
        label: {
          '&.Mui-active':    { fontWeight: 600, color: GRAPE[600] },
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
            backgroundColor: 'rgba(124,58,237,0.10)',
            color: GRAPE[700],
            borderColor: GRAPE[600],
            fontWeight: 600,
            '&:hover': { backgroundColor: 'rgba(124,58,237,0.15)' },
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
          boxShadow: '0 24px 48px rgba(0,0,0,0.12), 0 0 0 1px rgba(124,58,237,0.06)',
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
          backgroundColor: '#F0EDF8',
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
          color: '#6B6380',
          transition: 'color 0.15s ease',
          '&.Mui-selected': { color: '#1C0B38', fontWeight: 600 },
        },
      },
    },

    MuiSwitch: {
      styleOverrides: {
        switchBase: {
          '&.Mui-checked': {
            color: GRAPE[600],
            '& + .MuiSwitch-track': {
              backgroundColor: GRAPE[600],
              opacity: 0.5,
            },
          },
        },
      },
    },

    MuiAvatar: {
      styleOverrides: {
        root: {
          background: `linear-gradient(135deg, ${GRAPE[600]} 0%, ${GRAPE[400]} 100%)`,
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
          border: '1px solid rgba(124,58,237,0.08)',
          boxShadow: 'none',
          '&:before': { display: 'none' },
          '&.Mui-expanded': {
            boxShadow: '0 4px 16px rgba(124,58,237,0.08)',
          },
        },
      },
    },
  },
})

export default theme
