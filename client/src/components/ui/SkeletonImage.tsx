import { useState } from 'react'
import { Box, Skeleton } from '@mui/material'
import type { SxProps, Theme } from '@mui/material/styles'
import { storageSrcSet } from '@/lib/storageImage'

interface Props {
  src: string
  alt: string
  /** Styles the frame (size/aspect/radius/border/hover); the img fills it. */
  sx?: SxProps<Theme>
  /** Extra styles on the <img> itself (e.g. objectFit: 'contain'). */
  imgSx?: SxProps<Theme>
  /** Skeleton colour override — needed on dark surfaces (e.g. the lightbox). */
  skeletonSx?: SxProps<Theme>
  /**
   * Widest CSS width this image is laid out at. Enables a resized, 1x/2x
   * `srcSet` from Supabase's image renderer instead of shipping the original.
   */
  renderWidth?: number
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
 *
 * Pass `renderWidth` wherever the image is shown large, so visitors get a
 * variant sized for that slot (and for their screen's pixel density) rather
 * than the owner's original upload.
 */
export default function SkeletonImage({
  src, alt, sx, imgSx, skeletonSx, renderWidth, onClick, ...rest
}: Props) {
  const [loaded, setLoaded] = useState(false)

  // A gallery/lightbox reuses the element with a new src — pulse again.
  // Render-time reset (the "derived state" pattern) instead of an effect.
  const [prevSrc, setPrevSrc] = useState(src)
  if (src !== prevSrc) {
    setPrevSrc(src)
    setLoaded(false)
  }

  const srcSet = renderWidth ? storageSrcSet(src, renderWidth) : undefined

  function settle(el: HTMLImageElement | null) {
    if (el?.complete && el.naturalWidth && !loaded) setLoaded(true)
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
        srcSet={srcSet}
        alt={alt}
        // Below-the-fold thumbnails/banners shouldn't block first paint.
        loading="lazy"
        decoding="async"
        // Cached images can be complete before React attaches onLoad.
        ref={settle}
        onLoad={() => setLoaded(true)}
        onError={() => setLoaded(true)}
        sx={{
          width: '100%', height: '100%', display: 'block', objectFit: 'cover',
          opacity: loaded ? 1 : 0, transition: 'opacity 0.2s ease',
          ...imgSx,
        }}
      />
    </Box>
  )
}
