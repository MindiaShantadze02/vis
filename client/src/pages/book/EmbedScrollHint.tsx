import { useEffect, useState } from 'react'
import { Box, IconButton, alpha } from '@mui/material'
import { useTranslation } from 'react-i18next'
import { KeyboardArrowDown } from '@/components/icons'
import { inIframe } from './useEmbedBridge'

// Hidden content below the fold must exceed this before we hint — a few px of
// rounding slack shouldn't summon a bouncing arrow.
const EDGE_PX = 24

/**
 * "More below" affordance for the embedded booking widget.
 *
 * Embedders cap the iframe height (so tall steps scroll inside the widget
 * instead of stretching their page), but a capped frame clips the step content
 * with no visual cue — visitors don't realise the afternoon/evening slots exist.
 * The host page can't help: it is cross-origin and can't observe our scroll.
 *
 * So the widget itself renders a bottom fade + bouncing chevron whenever there
 * is meaningful content below the fold, and hides it once the visitor scrolls
 * (or the step shrinks) to fit. Only mounts inside an iframe.
 */
export default function EmbedScrollHint() {
  const { t } = useTranslation()
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    if (!inIframe) return

    const el = document.scrollingElement ?? document.documentElement
    let raf = 0
    const check = () => {
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(() => {
        setVisible(el.scrollHeight - el.clientHeight - el.scrollTop > EDGE_PX)
      })
    }

    check()
    window.addEventListener('scroll', check, { passive: true })
    // The host's embed.js resizes the iframe (clientHeight) → fires resize;
    // step changes resize the content (scrollHeight) → the ResizeObserver.
    window.addEventListener('resize', check)
    const ro = new ResizeObserver(check)
    ro.observe(document.body)
    // Settle re-checks: the host applies our reported height asynchronously
    // (and may animate it), so clientHeight can change without any event we
    // see having been the last one. Same burst pattern as EmbedBridge.
    const timers = [300, 800, 1500].map(ms => window.setTimeout(check, ms))

    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('scroll', check)
      window.removeEventListener('resize', check)
      ro.disconnect()
      timers.forEach(clearTimeout)
    }
  }, [])

  if (!inIframe) return null

  return (
    <Box
      aria-hidden={!visible}
      sx={{
        position: 'fixed',
        bottom: 0,
        left: 0,
        right: 0,
        zIndex: 10,
        height: 72,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'flex-end',
        pointerEvents: 'none',
        background: theme => `linear-gradient(to bottom, ${alpha(theme.palette.background.paper, 0)}, ${theme.palette.background.paper})`,
        opacity: visible ? 1 : 0,
        transition: 'opacity 0.25s ease',
      }}
    >
      <IconButton
        size="small"
        aria-label={t('booking.scrollForMore')}
        onClick={() => {
          const el = document.scrollingElement ?? document.documentElement
          window.scrollBy({ top: Math.round(el.clientHeight * 0.7), behavior: 'smooth' })
        }}
        sx={{
          mb: 1.25,
          bgcolor: 'background.paper',
          border: '1px solid',
          borderColor: 'divider',
          boxShadow: '0 2px 10px rgba(30,36,51,0.14)',
          color: 'primary.main',
          pointerEvents: visible ? 'auto' : 'none',
          animation: 'vis-nudge 1.8s ease-in-out infinite',
          '@keyframes vis-nudge': {
            '0%, 100%': { transform: 'translateY(0)' },
            '50%': { transform: 'translateY(4px)' },
          },
          '&:hover': { bgcolor: 'background.paper' },
          '@media (prefers-reduced-motion: reduce)': { animation: 'none' },
        }}
      >
        <KeyboardArrowDown fontSize="small" />
      </IconButton>
    </Box>
  )
}
