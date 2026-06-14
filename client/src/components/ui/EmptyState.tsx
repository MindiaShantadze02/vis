import type { ReactNode } from 'react'
import { Box, Typography } from '@mui/material'

interface EmptyStateProps {
  /** Icon element (e.g. an outlined MUI icon). Rendered in a tinted circle. */
  icon?: ReactNode
  title: string
  caption?: string
  /** Optional action node (e.g. a Button) shown below the text. */
  action?: ReactNode
  py?: number
}

/**
 * Consistent empty-state placeholder replacing the inline
 * "ვერ მოიძებნა" Typography blocks used across the app.
 */
export default function EmptyState({ icon, title, caption, action, py = 6 }: EmptyStateProps) {
  return (
    <Box
      sx={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        textAlign: 'center',
        gap: 1,
        py,
        px: 2,
      }}
    >
      {icon && (
        <Box
          sx={{
            width: 56,
            height: 56,
            borderRadius: '50%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            bgcolor: 'secondary.main',
            color: 'primary.main',
            mb: 0.5,
            '& svg': { fontSize: 28 },
          }}
        >
          {icon}
        </Box>
      )}
      <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
        {title}
      </Typography>
      {caption && (
        <Typography variant="body2" sx={{ color: 'text.secondary', maxWidth: 340 }}>
          {caption}
        </Typography>
      )}
      {action && <Box sx={{ mt: 1.5 }}>{action}</Box>}
    </Box>
  )
}
