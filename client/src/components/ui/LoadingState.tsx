import { Box, CircularProgress, Typography } from '@mui/material'

interface LoadingStateProps {
  /** Optional message shown under the spinner */
  message?: string
  /** Vertical padding of the centered container */
  py?: number
  size?: number
}

/**
 * Centered loading indicator used in place of the ad-hoc
 * `<Box sx={{ textAlign: 'center' }}><CircularProgress /></Box>` blocks
 * that were scattered across pages.
 */
export default function LoadingState({ message, py = 6, size = 36 }: LoadingStateProps) {
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
      <CircularProgress size={size} />
      {message && (
        <Typography variant="body2" sx={{ color: 'text.secondary' }}>
          {message}
        </Typography>
      )}
    </Box>
  )
}
