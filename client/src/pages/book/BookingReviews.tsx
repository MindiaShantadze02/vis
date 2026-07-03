import { useEffect, useState } from 'react'
import { Box, Typography, Rating, Divider, Skeleton } from '@mui/material'
import { format } from 'date-fns'
import { useTranslation } from 'react-i18next'
import { supabase } from '@/lib/supabase'
import { dateLocale } from '@/lib/dateLocale'

interface PublicReview {
  author_name: string | null
  rating: number
  comment: string | null
  created_at: string
}

interface Props {
  slug: string
  enabled: boolean
  avg: number | null
  count: number
}

/**
 * "What customers say" — the public rating badge + reviews list shown on the
 * booking landing (step 0). Rendered in the main content area so it appears in
 * both the standalone page and the chromeless embed. Renders nothing when the
 * business has reviews off or none yet. The aggregate (avg/count) comes from the
 * org fetch; the list is loaded lazily here via get_public_reviews.
 */
export default function BookingReviews({ slug, enabled, avg, count }: Props) {
  const { t } = useTranslation()
  const [reviews, setReviews] = useState<PublicReview[] | null>(null)

  useEffect(() => {
    if (!enabled || count === 0) return
    let cancelled = false
    supabase.rpc('get_public_reviews', { p_slug: slug }).then(({ data }) => {
      if (!cancelled) setReviews(((data as PublicReview[] | null) ?? []).map(r => ({ ...r, rating: Number(r.rating) })))
    })
    return () => { cancelled = true }
  }, [slug, enabled, count])

  if (!enabled || count === 0) return null

  return (
    <Box sx={{ mt: 5 }}>
      <Divider sx={{ mb: 3 }} />
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 2 }}>
        <Typography variant="h4" sx={{ fontWeight: 800, lineHeight: 1 }}>
          {avg != null ? avg.toFixed(1) : '—'}
        </Typography>
        <Box>
          <Rating value={avg ?? 0} precision={0.1} readOnly size="small" />
          <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block' }}>
            {t('reviews.countLabel', { count })}
          </Typography>
        </Box>
      </Box>

      {reviews === null ? (
        <Skeleton variant="rounded" height={72} />
      ) : (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          {reviews.map((r, i) => (
            <Box key={i}>
              <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1 }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <Typography variant="body2" sx={{ fontWeight: 600 }}>
                    {r.author_name?.trim() || t('reviews.anonymous')}
                  </Typography>
                  <Rating value={r.rating} readOnly size="small" />
                </Box>
                <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                  {format(new Date(r.created_at), 'd MMM yyyy', { locale: dateLocale() })}
                </Typography>
              </Box>
              {r.comment && (
                <Typography variant="body2" sx={{ color: 'text.secondary', mt: 0.5 }}>
                  {r.comment}
                </Typography>
              )}
            </Box>
          ))}
        </Box>
      )}
    </Box>
  )
}
