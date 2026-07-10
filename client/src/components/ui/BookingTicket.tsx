import { Box, Stack, Typography } from '@mui/material'
import type { ReactNode } from 'react'

export interface TicketRow {
  label: string
  value: ReactNode
  icon?: ReactNode
}

interface BookingTicketProps {
  /** Detail rows shown in the main body of the stub. */
  rows: TicketRow[]
  /** Caption above the status pill in the tear-off stub. */
  statusLabel?: string
  /** Status pill (e.g. <StatusChip />). */
  status?: ReactNode
  /** Caption above the price. */
  priceLabel?: string
  /** Price content (e.g. "45 ₾"). */
  price?: ReactNode
  /** Accent colour for the price — usually the theme's honey/deep accent. */
  priceColor?: string
  /**
   * Colour of the punched notches at the perforation — must match the page
   * background so the holes read as "bitten out" of the ticket.
   */
  notchColor: string
}

/**
 * The Vis signature: a booking rendered as a tear-off ticket stub.
 * A solid body of detail rows, a perforated divider with punched-out
 * notches, and a stub carrying the status and price. Used at the booking
 * confirmation — the moment a customer most wants something to keep.
 */
export default function BookingTicket({
  rows, statusLabel, status, priceLabel, price, priceColor, notchColor,
}: BookingTicketProps) {
  return (
    <Box
      sx={{
        position: 'relative',
        overflow: 'hidden',
        bgcolor: '#FFFFFF',
        borderRadius: 3,
        border: '1px solid rgba(30,36,51,0.08)',
        boxShadow: '0 1px 3px rgba(30,36,51,0.06)',
        textAlign: 'left',
      }}
    >
      {/* Body — the detail rows */}
      <Stack spacing={1.75} sx={{ p: 2.5 }}>
        {rows.map((r, i) => (
          <Box key={i} sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
            {r.icon && (
              <Box sx={{ color: 'primary.main', display: 'flex', flexShrink: 0 }}>{r.icon}</Box>
            )}
            <Box sx={{ minWidth: 0 }}>
              <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block' }}>
                {r.label}
              </Typography>
              <Typography variant="body2" sx={{ fontWeight: 600 }} noWrap>
                {r.value}
              </Typography>
            </Box>
          </Box>
        ))}
      </Stack>

      {/* Perforation — dashed line with notches punched from each edge */}
      <Box
        aria-hidden
        sx={{
          position: 'relative',
          borderTop: '2px dashed rgba(30,36,51,0.18)',
          '&::before, &::after': {
            content: '""',
            position: 'absolute',
            top: '-11px',
            width: 20,
            height: 20,
            borderRadius: '50%',
            bgcolor: notchColor,
          },
          '&::before': { left: -11 },
          '&::after': { right: -11 },
        }}
      />

      {/* Stub — status + price */}
      {(status || price != null) && (
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', p: 2.5 }}>
          <Box>
            {statusLabel && (
              <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block', mb: 0.5 }}>
                {statusLabel}
              </Typography>
            )}
            {status}
          </Box>
          {price != null && (
            <Box sx={{ textAlign: 'right' }}>
              {priceLabel && (
                <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block' }}>
                  {priceLabel}
                </Typography>
              )}
              <Typography variant="h6" sx={{ fontWeight: 700, color: priceColor ?? 'text.primary' }}>
                {price}
              </Typography>
            </Box>
          )}
        </Box>
      )}
    </Box>
  )
}
