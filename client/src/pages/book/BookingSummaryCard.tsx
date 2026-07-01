import { Box, Typography } from '@mui/material'
import type { ReactNode } from 'react'
import { anim } from '@/theme/animations'

export interface SummaryRow {
  icon: ReactNode
  primary: ReactNode
  secondary?: ReactNode
}

interface Props {
  /** Small uppercase caption above the card (e.g. "YOUR BOOKING"). */
  label: string
  /** Colour for the caption — the sidebar's foreground colour. */
  labelColor: string
  rows: SummaryRow[]
  /** Running total. When omitted, the perforation + total row are hidden. */
  total?: ReactNode
  totalLabel?: string
  /** Accent colour for the total (usually the theme's honey/deep accent). */
  priceColor?: string
  /** Colour of the punched notches — must match the sidebar background. */
  notchColor: string
}

/**
 * The live "your booking" summary shown in the booking sidebar: a white ticket
 * card being filled in as the customer progresses, with a perforated divider and
 * the running total. Extracted from the appointment flow so restaurant/hotel
 * render an identical summary (see BookingShell).
 */
export default function BookingSummaryCard({
  label, labelColor, rows, total, totalLabel, priceColor, notchColor,
}: Props) {
  return (
    <Box sx={{ animation: anim.fadeInUp, position: 'relative', mt: 1 }}>
      <Typography
        variant="caption"
        sx={{
          display: 'block', fontWeight: 700, letterSpacing: '1px',
          textTransform: 'uppercase', color: labelColor, opacity: 0.55, mb: 1.25,
        }}
      >
        {label}
      </Typography>
      <Box
        sx={{
          bgcolor: '#FFFFFF',
          color: 'text.primary',
          borderRadius: 2.5,
          p: 2,
          boxShadow: '0 10px 28px rgba(0,0,0,0.22)',
        }}
      >
        {rows.map((r, i) => (
          <Box
            key={i}
            sx={{ display: 'flex', alignItems: 'flex-start', gap: 1, mb: i < rows.length - 1 ? 1.25 : 0 }}
          >
            <Box sx={{ color: 'primary.main', display: 'flex', mt: 0.25, flexShrink: 0 }}>{r.icon}</Box>
            <Box sx={{ minWidth: 0 }}>
              <Typography variant="body2" sx={{ fontWeight: 600 }}>{r.primary}</Typography>
              {r.secondary && (
                <Typography variant="caption" sx={{ color: 'text.secondary' }}>{r.secondary}</Typography>
              )}
            </Box>
          </Box>
        ))}

        {total != null && (
          <>
            {/* Perforation — notches punched in the sidebar colour. */}
            <Box
              aria-hidden
              sx={{
                position: 'relative',
                borderTop: '1.5px dashed rgba(30,36,51,0.18)',
                mx: -2,
                my: 1.75,
                '&::before, &::after': {
                  content: '""', position: 'absolute', top: '-7px',
                  width: 14, height: 14, borderRadius: '50%', bgcolor: notchColor,
                },
                '&::before': { left: -7 },
                '&::after': { right: -7 },
              }}
            />
            <Box sx={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
              <Typography variant="body2" sx={{ color: 'text.secondary', fontWeight: 600 }}>{totalLabel}</Typography>
              <Typography variant="h6" sx={{ fontWeight: 800, color: priceColor }}>{total}</Typography>
            </Box>
          </>
        )}
      </Box>
    </Box>
  )
}
