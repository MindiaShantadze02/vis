import { Box } from '@mui/material'

// Path data from the brand wordmark asset (default-monochrome.svg).
const WORDMARK_PATH =
  'M5.29 14.35L8.54 4.58L6.94 4.58L5.39 9.41L4.44 12.81L4.38 12.81L3.44 9.41L1.89 4.58L0.25 4.58L3.46 14.35ZM10.65 5.77C11.28 5.77 11.55 5.43 11.55 4.97L11.55 4.73C11.55 4.27 11.28 3.93 10.65 3.93C10.02 3.93 9.74 4.27 9.74 4.73L9.74 4.97C9.74 5.43 10.02 5.77 10.65 5.77ZM9.88 14.35L11.41 14.35L11.41 7.07L9.88 7.07ZM15.90 14.52C17.65 14.52 18.79 13.58 18.79 12.18C18.79 11.00 18.07 10.30 16.48 10.07L15.81 9.98C15.04 9.86 14.69 9.60 14.69 9.04C14.69 8.50 15.08 8.13 15.92 8.13C16.70 8.13 17.32 8.51 17.70 8.96L18.63 8.06C17.98 7.34 17.23 6.90 15.92 6.90C14.32 6.90 13.22 7.73 13.22 9.14C13.22 10.49 14.13 11.13 15.61 11.31L16.28 11.40C17.04 11.49 17.32 11.84 17.32 12.31C17.32 12.92 16.87 13.29 15.99 13.29C15.12 13.29 14.46 12.89 13.93 12.25L12.95 13.15C13.64 14 14.53 14.52 15.90 14.52Z'

interface Props {
  /** Rendered height in px; width follows the wordmark's aspect ratio. */
  height?: number
  /** Any CSS colour. Defaults to the brand's Deep Harbor blue. */
  color?: string
}

/**
 * The Vis wordmark — the single brand logo used across the app (replaces the
 * old "V"-tile + text lockups). Monochrome by design: pass color="#fff" on
 * dark ink sidebars.
 */
export default function VisLogo({ height = 22, color = '#1D5B84' }: Props) {
  return (
    <Box
      component="svg"
      viewBox="0 0 105.04249659144736 60"
      role="img"
      aria-label="Vis"
      sx={{ height, width: 'auto', display: 'block', flexShrink: 0, color }}
    >
      <g
        fill="currentColor"
        transform="matrix(5.665722297967836,0,0,5.665722297967836,-1.4164310064461105,-22.26628924765994)"
      >
        <path d={WORDMARK_PATH} />
      </g>
    </Box>
  )
}
