import { Box, Typography } from '@mui/material'
import type { ReactNode } from 'react'
import { Check as CheckIcon } from '@/components/icons'
import { anim } from '@/theme/animations'
import { displayFont } from '@/theme/theme'

export interface SummaryRow {
  /** Small uppercase field label (e.g. "Service", "Time"). */
  label: string
  primary: ReactNode
  secondary?: ReactNode
}

interface Props {
  /** Small uppercase caption above the list (e.g. "YOUR BOOKING"). */
  label: string
  /** The sidebar's foreground colour. */
  fg: string
  /** The sidebar's overlay token — `rgba(fg, a)` for hairlines and tints. */
  overlay: (a: number) => string
  rows: SummaryRow[]
  /** Running price. When omitted, the price line is hidden. */
  price?: ReactNode
  priceLabel?: string
}

/**
 * The live "your booking" summary shown in the booking sidebar: each confirmed
 * choice ticked off on hairline-separated rows, closing with the price.
 *
 * Deliberately card-less — it used to be a white ticket with a drop shadow and
 * punched notches, which made a two-line recap of choices the customer had just
 * made the loudest object on the page. Drawing it straight onto the branded
 * panel keeps it a quiet progress trail, and it needs no per-theme tuning: every
 * colour here derives from the sidebar's own foreground.
 */
export default function BookingSummaryCard({
  label, fg, overlay, rows, price, priceLabel,
}: Props) {
  return (
    <Box sx={{ animation: anim.fadeInUp, position: 'relative', mt: 1, color: fg }}>
      <Typography
        variant="caption"
        sx={{
          display: 'block', fontWeight: 700, letterSpacing: '1px',
          textTransform: 'uppercase', opacity: 0.55, mb: 1.25,
        }}
      >
        {label}
      </Typography>

      {rows.map((r, i) => (
        <Box
          key={i}
          sx={{
            display: 'flex', alignItems: 'flex-start', gap: 1.25, py: 1.4,
            borderBottom: `1px solid ${overlay(0.15)}`,
            ...(i === 0 && { borderTop: `1px solid ${overlay(0.15)}` }),
          }}
        >
          <Box
            aria-hidden
            sx={{
              width: 18, height: 18, borderRadius: '50%', mt: '2px', flexShrink: 0,
              background: overlay(0.16),
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}
          >
            <CheckIcon sx={{ fontSize: 11 }} />
          </Box>
          <Box sx={{ minWidth: 0 }}>
            <Typography
              variant="caption"
              sx={{ display: 'block', fontSize: '0.66rem', letterSpacing: '0.6px', textTransform: 'uppercase', opacity: 0.55, lineHeight: 1.4 }}
            >
              {r.label}
            </Typography>
            <Typography sx={{ fontSize: '0.875rem', fontWeight: 600, lineHeight: 1.35 }}>{r.primary}</Typography>
            {r.secondary && (
              <Typography sx={{ fontSize: '0.75rem', opacity: 0.7 }}>{r.secondary}</Typography>
            )}
          </Box>
        </Box>
      ))}

      {price != null && (
        <Box sx={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', pt: 2 }}>
          <Typography
            variant="caption"
            sx={{ fontSize: '0.68rem', fontWeight: 700, letterSpacing: '0.8px', textTransform: 'uppercase', opacity: 0.55 }}
          >
            {priceLabel}
          </Typography>
          {/* The one big number on the panel — "price", not "total": nothing is
              totalled until the details step resolves deposits and fees. */}
          <Typography sx={{ fontFamily: displayFont, fontSize: '2.1rem', fontWeight: 700, lineHeight: 1 }}>
            {price}
          </Typography>
        </Box>
      )}
    </Box>
  )
}
