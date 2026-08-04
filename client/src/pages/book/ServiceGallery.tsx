import { useState } from 'react'
import { Box, Typography } from '@mui/material'
import { useTranslation } from 'react-i18next'
import { anim } from '@/theme/animations'
import { SkeletonImage, ImageLightbox } from '@/components/ui'

interface Props {
  /** The selected service's gallery, in display order. Renders nothing when empty. */
  images: string[]
  serviceName: string
  /** Sidebar foreground colour (matches the summary label). */
  fg: string
  /** Sidebar overlay helper from BookingShell/BookingLayout. */
  overlay: (a: number) => string
}

/**
 * The selected service's photos, shown in the branded booking sidebar beneath
 * the "your booking" ticket — same uppercase caption treatment as the ticket's
 * label, thumbnails in the sidebar's overlay style. Tapping a thumbnail opens a
 * fullscreen lightbox (shared ImageLightbox) with prev/next.
 */
export default function ServiceGallery({ images, serviceName, fg, overlay }: Props) {
  const { t } = useTranslation()
  // Open lightbox index, or null when closed.
  const [open, setOpen] = useState<number | null>(null)

  if (images.length === 0) return null

  return (
    <Box sx={{ animation: anim.fadeInUp, position: 'relative' }} data-testid="sidebar-gallery">
      <Typography
        variant="caption"
        sx={{
          display: 'block', fontWeight: 700, letterSpacing: '1px',
          textTransform: 'uppercase', color: fg, opacity: 0.55, mb: 1.25,
        }}
      >
        {t('settings.serviceImages')}
      </Typography>

      <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 0.75 }}>
        {images.map((url, i) => (
          <SkeletonImage
            key={url}
            src={url}
            alt={serviceName}
            role="button"
            aria-label={t('booking.viewGallery')}
            data-testid="gallery-thumb"
            onClick={() => setOpen(i)}
            sx={{
              width: '100%', aspectRatio: '1',
              borderRadius: 1.5, cursor: 'pointer',
              border: `1px solid ${overlay(0.25)}`,
              transition: 'transform 0.15s ease, border-color 0.15s ease',
              '&:hover': { transform: 'scale(1.04)', borderColor: overlay(0.5) },
            }}
            // Sidebar surface may be dark or light — the overlay helper keys
            // the pulse to the sidebar's own foreground, like the borders.
            skeletonSx={{ bgcolor: overlay(0.15) }}
          />
        ))}
      </Box>

      {open !== null && (
        <ImageLightbox
          images={images}
          startIndex={open}
          alt={serviceName}
          onClose={() => setOpen(null)}
        />
      )}
    </Box>
  )
}
