import { useState } from 'react'
import { Box, Dialog, IconButton } from '@mui/material'
import { AnimatePresence, motion } from 'framer-motion'
import {
  Close as CloseIcon,
  ArrowBackIosNew as ArrowBackIosNewIcon,
  ArrowForwardIos as ArrowForwardIosIcon,
} from '@/components/icons'

/**
 * Full-screen image carousel for booking-page galleries (room photos / property
 * gallery). Controlled: pass the image URLs and the starting index; `onClose`
 * clears it. Uses framer-motion for slide transitions, consistent with the
 * rest of the booking flow.
 */
interface ImageCarouselProps {
  urls: string[]
  startIndex?: number
  open: boolean
  onClose: () => void
}

export default function ImageCarousel({ urls, startIndex = 0, open, onClose }: ImageCarouselProps) {
  const [index, setIndex] = useState(startIndex)
  const [dir, setDir] = useState(0)
  // Reset to the requested start image each time the carousel opens — done during
  // render (React's endorsed prop-change pattern) rather than in an effect.
  const [prevOpen, setPrevOpen] = useState(open)
  if (open !== prevOpen) {
    setPrevOpen(open)
    if (open) { setIndex(startIndex); setDir(0) }
  }

  if (urls.length === 0) return null
  const go = (delta: number) => {
    setDir(delta)
    setIndex(i => (i + delta + urls.length) % urls.length)
  }

  return (
    <Dialog open={open} onClose={onClose} maxWidth="lg" fullWidth
      slotProps={{ paper: { sx: { bgcolor: 'rgba(0,0,0,0.92)', boxShadow: 'none', m: 1 } } }}>
      <Box sx={{ position: 'relative', height: { xs: '70vh', sm: '78vh' }, overflow: 'hidden' }}>
        <IconButton onClick={onClose} aria-label="close"
          sx={{ position: 'absolute', top: 8, right: 8, zIndex: 2, color: 'common.white' }}>
          <CloseIcon />
        </IconButton>

        <AnimatePresence initial={false} custom={dir}>
          <motion.img
            key={index}
            src={urls[index]}
            custom={dir}
            initial={{ x: dir >= 0 ? 60 : -60, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: dir >= 0 ? -60 : 60, opacity: 0 }}
            transition={{ duration: 0.22 }}
            style={{
              position: 'absolute', inset: 0, width: '100%', height: '100%',
              objectFit: 'contain',
            }}
          />
        </AnimatePresence>

        {urls.length > 1 && (
          <>
            <IconButton onClick={() => go(-1)} aria-label="previous"
              sx={{ position: 'absolute', top: '50%', left: 8, transform: 'translateY(-50%)', color: 'common.white', bgcolor: 'rgba(0,0,0,0.35)' }}>
              <ArrowBackIosNewIcon sx={{ fontSize: 18 }} />
            </IconButton>
            <IconButton onClick={() => go(1)} aria-label="next"
              sx={{ position: 'absolute', top: '50%', right: 8, transform: 'translateY(-50%)', color: 'common.white', bgcolor: 'rgba(0,0,0,0.35)' }}>
              <ArrowForwardIosIcon sx={{ fontSize: 18 }} />
            </IconButton>
            <Box sx={{ position: 'absolute', bottom: 12, left: 0, right: 0, display: 'flex', justifyContent: 'center', gap: 1 }}>
              {urls.map((_, i) => (
                <Box key={i} sx={{ width: 7, height: 7, borderRadius: '50%', bgcolor: i === index ? 'common.white' : 'rgba(255,255,255,0.4)' }} />
              ))}
            </Box>
          </>
        )}
      </Box>
    </Dialog>
  )
}
