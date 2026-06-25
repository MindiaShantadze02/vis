import { useTheme } from '@mui/material/styles'
import useMediaQuery from '@mui/material/useMediaQuery'

/**
 * Centralised responsive breakpoint flags so pages don't each re-derive
 * `useMediaQuery(theme.breakpoints.down('md'))`. Treats the MUI defaults
 * as: mobile < sm (600), tablet sm–md (600–900), desktop ≥ md (900).
 *
 * Most layouts collapse their sidebar/grid at `md`, so `isCompact`
 * (mobile OR tablet) matches the existing `down('md')` behaviour, while
 * `isMobile`/`isTablet` let callers give tablets first-class treatment.
 */
export function useBreakpoints() {
  const theme = useTheme()
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'))
  const isTablet = useMediaQuery(theme.breakpoints.between('sm', 'md'))
  const isCompact = useMediaQuery(theme.breakpoints.down('md'))
  return {
    isMobile,
    isTablet,
    isDesktop: !isCompact,
    /** true below `md` — equivalent to the legacy `down('md')` check. */
    isCompact,
  }
}
