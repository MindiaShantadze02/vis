import { Box } from '@mui/material'

// Path data from the brand wordmark asset (default-monochrome.svg).
const WORDMARK_PATH =
  'M7.01 13.58L10.50 3.92L7.83 3.92L5.50 11.63L3.19 3.92L0.45 3.92L3.93 13.58ZM12.40 3.07C11.62 3.07 11.10 3.54 11.10 4.30C11.10 5.05 11.62 5.53 12.40 5.53C13.19 5.53 13.71 5.05 13.71 4.30C13.71 3.54 13.19 3.07 12.40 3.07ZM13.66 13.58L13.66 6.10L11.14 6.10L11.14 13.58ZM18.26 5.91C16.27 5.91 14.98 6.83 14.98 8.32C14.98 9.59 15.83 10.25 17.26 10.58C18.59 10.89 19.07 11.16 19.07 11.63C19.07 12.03 18.72 12.21 18.27 12.21C17.74 12.21 17.29 11.83 17.15 11.26L14.67 11.26C14.87 12.94 16.25 13.78 18.28 13.78C20.09 13.78 21.59 13.03 21.59 11.44C21.59 10.00 20.62 9.41 19.26 9.07C17.84 8.72 17.50 8.44 17.50 8.02C17.50 7.70 17.75 7.48 18.10 7.48C18.55 7.48 18.80 7.77 18.91 8.29L21.39 8.29C21.20 6.93 20.12 5.91 18.26 5.91Z'

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
      viewBox="0 0 118.43136870785324 60"
      role="img"
      aria-label="Vis"
      sx={{ height, width: 'auto', display: 'block', flexShrink: 0, color }}
    >
      <g
        fill="currentColor"
        transform="matrix(5.602240876404433,0,0,5.602240876404433,-2.5210067954468443,-17.198878401315945)"
      >
        <path d={WORDMARK_PATH} />
      </g>
    </Box>
  )
}
