import { useState } from 'react'
import { Box, Typography, Dialog, IconButton } from '@mui/material'
import { Close as CloseIcon } from '@/components/icons'
import { ArrowBackIosNew as ArrowBackIosNewIcon } from '@/components/icons'
import { ArrowForwardIos as ArrowForwardIosIcon } from '@/components/icons'
import { useTranslation } from 'react-i18next'
import SkeletonImage from './SkeletonImage'

interface Props {
  /** All images to browse, in display order. */
  images: string[]
  /** Which image to open on first render. */
  startIndex: number
  /** Alt text for every frame (galleries have no per-image alt). */
  alt: string
  onClose: () => void
}

/**
 * A fullscreen image viewer on a black backdrop with a close button and, when
 * there's more than one image, prev/next arrows and an "n / total" counter.
 * Mount it conditionally (the parent owns "is it open"); it owns which image is
 * showing so navigation stays local. Shared by the sidebar ServiceGallery and
 * the booking service cards so there's a single lightbox implementation.
 */
export default function ImageLightbox({ images, startIndex, alt, onClose }: Props) {
  const { t } = useTranslation()
  const [cur, setCur] = useState(startIndex)

  const go = (delta: number) => setCur(i => (i + delta + images.length) % images.length)

  return (
    <Dialog open onClose={onClose} maxWidth="lg" fullWidth>
      <Box sx={{ position: 'relative', bgcolor: '#000' }}>
        <IconButton
          onClick={onClose}
          aria-label={t('common.close')}
          data-testid="gallery-close"
          sx={{ position: 'absolute', top: 8, right: 8, color: '#fff', bgcolor: 'rgba(0,0,0,0.4)', '&:hover': { bgcolor: 'rgba(0,0,0,0.6)' }, zIndex: 1 }}
        >
          <CloseIcon />
        </IconButton>
        <SkeletonImage
          src={images[cur]}
          alt={alt}
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
              {cur + 1} / {images.length}
            </Typography>
          </>
        )}
      </Box>
    </Dialog>
  )
}
