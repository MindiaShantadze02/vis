import type { ReactNode } from 'react'
import { Card, CardContent, Box, Typography, Skeleton } from '@mui/material'
import { alpha } from '@mui/material/styles'

interface StatCardProps {
  label: string
  value: string | number
  icon: ReactNode
  /** Resolved color string (pass a theme palette token, e.g. theme.palette.primary.main). */
  color: string
  loading?: boolean
}

/**
 * Metric card with a tinted icon badge. Extracted from OverviewPage so
 * the stat grid is consistent and the tint derives from a real color
 * via MUI's `alpha` (no fragile `${color}15` hex concatenation).
 */
export default function StatCard({ label, value, icon, color, loading }: StatCardProps) {
  return (
    <Card data-testid="stat-card">
      <CardContent sx={{ display: 'flex', alignItems: 'flex-start', gap: 2 }}>
        <Box
          sx={{
            width: 48, height: 48, borderRadius: 2,
            bgcolor: alpha(color, 0.12),
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            color, flexShrink: 0,
          }}
        >
          {icon}
        </Box>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography variant="caption" sx={{ color: 'text.secondary' }}>{label}</Typography>
          {loading
            ? <Skeleton width={80} height={36} />
            : <Typography variant="h5" sx={{ fontWeight: 700, mt: 0.25 }}>{value}</Typography>
          }
        </Box>
      </CardContent>
    </Card>
  )
}
