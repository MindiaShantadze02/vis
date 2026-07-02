import type { ReactNode } from 'react'
import { Box, Typography } from '@mui/material'

/** Shared onboarding step header: a tinted round icon above a serif title + subtitle. */
export default function StepHeader({ icon, title, subtitle }: { icon: ReactNode; title: string; subtitle: string }) {
  return (
    <Box sx={{ mb: 4 }}>
      <Box
        sx={{
          width: 48, height: 48, borderRadius: '14px', mb: 2,
          bgcolor: 'secondary.main', color: 'primary.main',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}
      >
        {icon}
      </Box>
      <Typography variant="h5" sx={{ fontWeight: 700, mb: 0.5 }}>{title}</Typography>
      <Typography variant="body2" sx={{ color: 'text.secondary' }}>{subtitle}</Typography>
    </Box>
  )
}
