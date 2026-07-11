import { useState } from 'react'
import { Box, Typography, Dialog, IconButton } from '@mui/material'
import { Close as CloseIcon } from '@/components/icons'
import { ArrowBackIosNew as ArrowBackIosNewIcon } from '@/components/icons'
import { ArrowForwardIos as ArrowForwardIosIcon } from '@/components/icons'
import { useTranslation } from 'react-i18next'
import { anim } from '@/theme/animations'
import { SkeletonImage } from '@/components/ui'

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
 * fullscreen lightbox with prev/next.
 */
export default function ServiceGallery({ images, serviceName, fg, overlay }: Props) {
  const { t } = useTranslation()
  // Open lightbox index, or null when closed.
  const [open, setOpen] = useState<number | null>(null)

  if (images.length === 0) return null

  const go = (delta: number) =>
    setOpen(i => (i === null ? i : (i + delta + images.length) % images.length))

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
        <Dialog open onClose={() => setOpen(null)} maxWidth="lg" fullWidth>
          <Box sx={{ position: 'relative', bgcolor: '#000' }}>
            <IconButton
              onClick={() => setOpen(null)}
              aria-label={t('common.close')}
              data-testid="gallery-close"
              sx={{ position: 'absolute', top: 8, right: 8, color: '#fff', bgcolor: 'rgba(0,0,0,0.4)', '&:hover': { bgcolor: 'rgba(0,0,0,0.6)' }, zIndex: 1 }}
            >
              <CloseIcon />
            </IconButton>
            <SkeletonImage
              src={images[open]}
              alt={serviceName}
              // minHeight gives the pulse an area before the image's natural
              // size is known; once loaded the frame keeps its original
              // "natural height, capped at 80vh" behaviour.
              sx={{ width: '100%', minHeight: '40vh', display: 'flex', alignItems: 'center' }}
              imgSx={{ height: 'auto', maxHeight: '80vh', objectFit: 'contain' }}
              skeletonSx={{ bgcolor: 'rgba(255,255,255,0.08)' }}
            />
            {images.length > 1 && (
              <>
                <IconButton
                  onClick={() => go(-1)}
                  aria-label={t('common.back')}
                  sx={{ position: 'absolute', top: '50%', left: 8, transform: 'translateY(-50%)', color: '#fff', bgcolor: 'rgba(0,0,0,0.4)', '&:hover': { bgcolor: 'rgba(0,0,0,0.6)' } }}
                >
                  <ArrowBackIosNewIcon sx={{ fontSize: 18 }} />
                </IconButton>
                <IconButton
                  onClick={() => go(1)}
                  aria-label={t('common.next')}
                  sx={{ position: 'absolute', top: '50%', right: 8, transform: 'translateY(-50%)', color: '#fff', bgcolor: 'rgba(0,0,0,0.4)', '&:hover': { bgcolor: 'rgba(0,0,0,0.6)' } }}
                >
                  <ArrowForwardIosIcon sx={{ fontSize: 18 }} />
                </IconButton>
                <Typography
                  variant="caption"
                  sx={{ position: 'absolute', bottom: 10, left: '50%', transform: 'translateX(-50%)', color: '#fff', bgcolor: 'rgba(0,0,0,0.5)', px: 1, py: 0.25, borderRadius: 1 }}
                >
                  {open + 1} / {images.length}
                </Typography>
              </>
            )}
          </Box>
        </Dialog>
      )}
    </Box>
  )
}
