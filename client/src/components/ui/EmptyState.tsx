import type { ReactNode } from 'react'
import { Box, Typography } from '@mui/material'
import { motion } from 'framer-motion'
import { staggerContainer, listItem } from '@/theme/motion'

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
      component={motion.div}
      variants={staggerContainer}
      initial="hidden"
      animate="visible"
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
          component={motion.div}
          initial={{ scale: 0, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ type: 'spring', stiffness: 260, damping: 18, delay: 0.05 }}
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
      <Typography component={motion.div} variants={listItem} variant="subtitle1" sx={{ fontWeight: 600 }}>
        {title}
      </Typography>
      {caption && (
        <Typography component={motion.div} variants={listItem} variant="body2" sx={{ color: 'text.secondary', maxWidth: 340 }}>
          {caption}
        </Typography>
      )}
      {action && <Box component={motion.div} variants={listItem} sx={{ mt: 1.5 }}>{action}</Box>}
    </Box>
  )
}
