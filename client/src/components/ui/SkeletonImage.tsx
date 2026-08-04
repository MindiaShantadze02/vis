import { useState } from 'react'
import { Box, Skeleton } from '@mui/material'
import type { SxProps, Theme } from '@mui/material/styles'

interface Props {
  src: string
  alt: string
  /** Styles the frame (size/aspect/radius/border/hover); the img fills it. */
  sx?: SxProps<Theme>
  /** Extra styles on the <img> itself (e.g. objectFit: 'contain'). */
  imgSx?: SxProps<Theme>
  /** Skeleton colour override — needed on dark surfaces (e.g. the lightbox). */
  skeletonSx?: SxProps<Theme>
  onClick?: () => void
  role?: string
  'aria-label'?: string
  'data-testid'?: string
}

/**
 * An <img> that shows a pulsing skeleton in its frame until the file has
 * actually loaded (or errored — a broken image shouldn't pulse forever).
 * The frame owns the shape: pass size/aspect/radius via `sx`; the image
 * covers it. Blob/cached URLs resolve in the first paint and skip straight
 * past the skeleton.
 */
export default function SkeletonImage({
  src, alt, sx, imgSx, skeletonSx, onClick, ...rest
}: Props) {
  const [loaded, setLoaded] = useState(false)

  // A gallery/lightbox reuses the element with a new src — pulse again.
  // Render-time reset (the "derived state" pattern) instead of an effect.
  const [prevSrc, setPrevSrc] = useState(src)
  if (src !== prevSrc) {
    setPrevSrc(src)
    setLoaded(false)
  }

  return (
    <Box sx={{ position: 'relative', overflow: 'hidden', ...sx }} onClick={onClick} {...rest}>
      {!loaded && (
        <Skeleton
          variant="rectangular"
          sx={{ position: 'absolute', inset: 0, width: '100%', height: '100%', ...skeletonSx }}
        />
      )}
      <Box
        component="img"
        src={src}
        alt={alt}
        // Below-the-fold thumbnails/banners shouldn't block first paint.
        loading="lazy"
        decoding="async"
        // Cached images can be complete before React attaches onLoad.
        ref={(el: HTMLImageElement | null) => { if (el?.complete && !loaded) setLoaded(true) }}
        onLoad={() => setLoaded(true)}
        onError={() => setLoaded(true)}
        sx={{
          width: '100%', height: '100%', objectFit: 'cover', display: 'block',
          opacity: loaded ? 1 : 0, transition: 'opacity 0.2s ease',
          ...imgSx,
        }}
      />
    </Box>
  )
}
