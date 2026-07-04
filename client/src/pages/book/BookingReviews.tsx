import { Box, Typography, Rating, Divider } from '@mui/material'
import { StarRounded as StarRoundedIcon } from '@/components/icons'
import { useTranslation } from 'react-i18next'
import { anim } from '@/theme/animations'

interface Props {
  enabled: boolean
  avg: number | null
  count: number
  /** 'sidebar' = on the branded ink panel; 'inline' = on the paper content (embed/mobile). */
  variant?: 'sidebar' | 'inline'
  /** Sidebar only — the panel's foreground colour + its overlay helper. */
  fg?: string
  overlay?: (a: number) => string
  /** Filled-star accent (the theme's honey/deep on the sidebar). */
  accent?: string
}

/**
 * The public rating on the booking page — the business's *overall* score only
 * (average + review count), never a list of individual reviews. Rendered in the
 * branded sidebar on desktop (see BookingShell) and inline on embed/mobile.
 * Self-hides when the business has reviews off or none yet.
 */
export default function BookingReviews({
  enabled, avg, count, variant = 'inline', fg, overlay, accent,
}: Props) {
  const { t } = useTranslation()

  if (!enabled || count === 0) return null

  const sidebar = variant === 'sidebar'
  const starFilled = sidebar ? (accent ?? fg) : 'primary.main'
  const starEmpty = sidebar ? overlay?.(0.28) : undefined
  const dividerColor = sidebar ? overlay?.(0.15) : 'divider'

  const aggregate = (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
      <Typography sx={{ fontWeight: 800, fontSize: '1.9rem', lineHeight: 1, color: sidebar ? fg : 'text.primary' }}>
        {avg != null ? avg.toFixed(1) : '—'}
      </Typography>
      <Box>
        <Rating
          value={avg ?? 0}
          precision={0.5}
          readOnly
          size="small"
          icon={<StarRoundedIcon weight="fill" fontSize="inherit" />}
          emptyIcon={<StarRoundedIcon weight="regular" fontSize="inherit" />}
          sx={{
            '& .MuiRating-iconFilled': { color: starFilled },
            ...(starEmpty && { '& .MuiRating-iconEmpty': { color: starEmpty } }),
          }}
        />
        <Typography
          variant="caption"
          sx={{ display: 'block', color: sidebar ? fg : 'text.secondary', ...(sidebar && { opacity: 0.7 }) }}
        >
          {t('reviews.countLabel', { count })}
        </Typography>
      </Box>
    </Box>
  )

  if (sidebar) {
    return (
      <Box sx={{ animation: anim.fadeInUp }}>
        <Divider sx={{ borderColor: dividerColor, mb: 2 }} />
        <Typography
          variant="caption"
          sx={{
            display: 'block', fontWeight: 700, letterSpacing: '1px',
            textTransform: 'uppercase', color: fg, opacity: 0.55, mb: 1.25,
          }}
        >
          {t('reviews.sectionLabel')}
        </Typography>
        {aggregate}
      </Box>
    )
  }

  // Inline (embed / mobile) — on the paper content surface.
  return (
    <Box sx={{ mt: 5 }}>
      <Divider sx={{ mb: 3 }} />
      {aggregate}
    </Box>
  )
}
