import type { ReactNode } from 'react'
import { Box, Typography } from '@mui/material'
import { LAYOUT, displayFont, radii } from '@/theme/theme'
import { anim } from '@/theme/animations'
import { LanguageSwitcher } from '@/components/ui'
import VisLogo from '@/components/VisLogo'

interface Props {
  /** Serif page heading shown above the form (e.g. "Sign in"). */
  title: string
  /** Optional one-liner under the heading. */
  subtitle?: ReactNode
  children: ReactNode
}

/**
 * Shared frame for /login, /register and /forgot-password: the dashboard's own
 * near-white surface with a single flat hairline card — the same chrome the
 * owner lives in after signing in, so auth reads as the first page of the app
 * rather than a marketing gate. No copy beyond the form itself.
 */
export default function AuthShell({ title, subtitle, children }: Props) {
  return (
    <Box
      sx={{
        minHeight: '100vh', bgcolor: 'background.default',
        display: 'flex', flexDirection: 'column', alignItems: 'center',
        px: 2, position: 'relative',
      }}
    >
      <Box sx={{ position: 'absolute', top: 12, right: 16 }}>
        <LanguageSwitcher />
      </Box>

      <Box
        sx={{
          width: '100%', maxWidth: LAYOUT.narrowCard,
          // Optically centred: fixed top offset instead of vertical centering,
          // so the card doesn't jump when validation/error rows change height.
          mt: { xs: 9, sm: '14vh' }, mb: 6,
          animation: anim.fadeInUp,
          '@media (prefers-reduced-motion: reduce)': { animation: 'none' },
        }}
      >
        {/* Brand wordmark (shared VisLogo SVG). */}
        <Box sx={{ mb: 3, px: 0.5 }}>
          <VisLogo height={26} />
        </Box>

        <Box
          sx={{
            bgcolor: 'background.paper',
            border: '1px solid', borderColor: 'divider',
            borderRadius: `${radii.card}px`,
            p: { xs: 3, sm: 4 },
          }}
        >
          <Typography
            sx={{
              fontFamily: displayFont, fontWeight: 700,
              fontSize: { xs: 24, sm: 26 }, letterSpacing: '-0.3px', lineHeight: 1.3,
            }}
          >
            {title}
          </Typography>
          {subtitle && (
            <Typography variant="body2" sx={{ color: 'text.secondary', mt: 0.5 }}>
              {subtitle}
            </Typography>
          )}
          <Box sx={{ mt: 3 }}>{children}</Box>
        </Box>
      </Box>
    </Box>
  )
}
