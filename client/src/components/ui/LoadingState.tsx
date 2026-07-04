import { Box, CircularProgress, Typography } from '@mui/material'
import type { CircularProgressProps } from '@mui/material'

interface LoadingStateProps {
  /** Optional message shown under the spinner */
  message?: string
  /** Vertical padding of the centered container */
  py?: number
  size?: number
  /**
   * Spinner colour. Defaults to `primary` so it follows the surrounding theme
   * (e.g. the org's booking accent). Pre-theme full-page loaders — shown before
   * the org and its ThemeProvider exist — pass `inherit` so they render a
   * neutral grey via the container's `color` rather than the base app accent.
   */
  color?: CircularProgressProps['color']
}

/**
 * Centered loading indicator used in place of the ad-hoc
 * `<Box sx={{ textAlign: 'center' }}><CircularProgress /></Box>` blocks
 * that were scattered across pages.
 */
export default function LoadingState({ message, py = 6, size = 36, color = 'primary' }: LoadingStateProps) {
  return (
    <Box
      role="status"
      aria-busy="true"
      sx={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 1.5,
        py,
      }}
    >
      <CircularProgress size={size} color={color} />
      {message && (
        <Typography variant="body2" sx={{ color: 'text.secondary' }}>
          {message}
        </Typography>
      )}
    </Box>
  )
}
