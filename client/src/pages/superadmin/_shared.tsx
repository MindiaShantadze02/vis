import type { ReactNode } from 'react'
import { Card, CardContent, Box, Typography } from '@mui/material'

/**
 * Section shell shared by the superadmin console pages. Matches the dashboard
 * layout convention used everywhere else: full-width card, CardContent p:3,
 * subtitle1/600 heading with a body2 explanatory line beneath it.
 *
 * The hint is not decoration — every number on these pages needs a sentence
 * saying what decision it supports, or it just becomes a wall of digits nobody
 * acts on.
 */
export function Section({ title, hint, action, children }: {
  title: string
  hint?: string
  action?: ReactNode
  children: ReactNode
}) {
  return (
    <Card sx={{ mb: 3 }}>
      <CardContent sx={{ p: 3 }}>
        <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 2, mb: hint ? 0.5 : 2 }}>
          <Typography variant="subtitle1" sx={{ fontWeight: 600, flex: 1 }}>
            {title}
          </Typography>
          {action}
        </Box>
        {hint && (
          <Typography variant="body2" sx={{ color: 'text.secondary', mb: 2.5 }}>
            {hint}
          </Typography>
        )}
        {children}
      </CardContent>
    </Card>
  )
}

/** Horizontally scrollable table wrapper — the page body must never scroll sideways. */
export function ScrollX({ children }: { children: ReactNode }) {
  return <Box sx={{ overflowX: 'auto', mx: -1, px: 1 }}>{children}</Box>
}
