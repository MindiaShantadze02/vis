import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import {
  Box, Typography, Card, CardContent, Button, TextField, Rating, Alert, CircularProgress,
} from '@mui/material'
import { CheckCircleOutlined as CheckCircleOutlinedIcon } from '@/components/icons'
import { SearchOffOutlined as SearchOffOutlinedIcon } from '@/components/icons'
import { format } from 'date-fns'
import { useTranslation } from 'react-i18next'
import { ThemeProvider } from '@mui/material/styles'
import { supabase } from '@/lib/supabase'
import { LoadingState, EmptyState } from '@/components/ui'
import { LAYOUT } from '@/theme/theme'
import { getBookingTheme, makeBookingTheme } from '@/theme/bookingThemes'
import { dateLocale } from '@/lib/dateLocale'
import { FIELD_LIMITS } from '@/lib/validation'

// Everything the page needs to pick its state, from get_review_context().
interface ReviewContext {
  org_name: string
  slug: string
  booking_theme: string | null
  service_name: string | null
  scheduled_at: string | null
  status: string
  reviews_enabled: boolean
  already_reviewed: boolean
}

// The page state a given appointment resolves to.
type View = 'loading' | 'not_found' | 'disabled' | 'not_completed' | 'already' | 'form' | 'done'

/**
 * Public review page — /review/:appointmentId. The appointment id is the
 * capability: only a real attendee has it, so no login is needed. Renders a
 * star form for a completed, un-reviewed visit; otherwise a matching info state.
 */
export default function ReviewPage() {
  const { appointmentId } = useParams<{ appointmentId: string }>()
  const { t } = useTranslation()

  const [ctx, setCtx] = useState<ReviewContext | null>(null)
  const [view, setView] = useState<View>('loading')

  const [rating, setRating] = useState<number | null>(null)
  const [comment, setComment] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!appointmentId) return
    let cancelled = false
    supabase.rpc('get_review_context', { p_appointment_id: appointmentId }).then(({ data }) => {
      if (cancelled) return
      const c = (data as ReviewContext | null) ?? null
      setCtx(c)
      if (!c || !c.org_name) setView('not_found')
      else if (!c.reviews_enabled) setView('disabled')
      else if (c.already_reviewed) setView('already')
      else if (c.status !== 'completed') setView('not_completed')
      else setView('form')
    })
    return () => { cancelled = true }
  }, [appointmentId])

  async function submit() {
    if (!appointmentId || !rating) return
    setSubmitting(true)
    setError(null)
    const { data, error: rpcErr } = await supabase.rpc('submit_review', {
      p_appointment_id: appointmentId,
      p_rating: rating,
      p_comment: comment.trim() || null,
    })
    setSubmitting(false)
    const res = data as { ok?: boolean; error?: string } | null
    if (rpcErr || !res?.ok) {
      if (res?.error === 'already_reviewed') { setView('already'); return }
      if (res?.error === 'reviews_disabled') { setView('disabled'); return }
      if (res?.error === 'not_completed') { setView('not_completed'); return }
      setError(t('reviews.errorGeneric'))
      return
    }
    setView('done')
  }

  const theme = makeBookingTheme(getBookingTheme(ctx?.booking_theme))

  if (view === 'loading') {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh' }}>
        <LoadingState />
      </Box>
    )
  }

  if (view === 'not_found') {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh' }}>
        <EmptyState icon={<SearchOffOutlinedIcon />} title={t('reviews.notFoundTitle')} />
      </Box>
    )
  }

  // Shared themed shell for every non-loading state.
  const shell = (children: React.ReactNode) => (
    <ThemeProvider theme={theme}>
      <Box
        sx={{
          minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
          bgcolor: getBookingTheme(ctx?.booking_theme).pageBg, p: 2,
        }}
      >
        <Card sx={{ maxWidth: LAYOUT.narrowCard, width: '100%', borderRadius: 4 }}>
          <CardContent sx={{ p: 4 }}>{children}</CardContent>
        </Card>
      </Box>
    </ThemeProvider>
  )

  const heading = (title: string, body: string, icon?: React.ReactNode) => (
    <Box sx={{ textAlign: 'center' }}>
      {icon && (
        <Box
          sx={{
            width: 64, height: 64, borderRadius: '50%', bgcolor: 'success.light',
            display: 'flex', alignItems: 'center', justifyContent: 'center', mx: 'auto', mb: 2,
          }}
        >
          {icon}
        </Box>
      )}
      <Typography variant="h5" sx={{ fontWeight: 700, mb: 0.5 }}>{title}</Typography>
      <Typography variant="body2" sx={{ color: 'text.secondary' }}>{body}</Typography>
    </Box>
  )

  if (view === 'done') {
    return shell(heading(t('reviews.thanksTitle'), t('reviews.thanksBody'),
      <CheckCircleOutlinedIcon sx={{ fontSize: 34, color: 'success.main' }} />))
  }
  if (view === 'already') {
    return shell(heading(t('reviews.alreadyTitle'), t('reviews.alreadyBody')))
  }
  if (view === 'disabled') {
    return shell(heading(t('reviews.disabledTitle'), t('reviews.disabledBody')))
  }
  if (view === 'not_completed') {
    return shell(heading(t('reviews.notCompletedTitle'), t('reviews.notCompletedBody')))
  }

  // view === 'form'
  const subtitleParts = [ctx?.service_name, ctx?.scheduled_at
    ? format(new Date(ctx.scheduled_at), 'd MMM yyyy', { locale: dateLocale() })
    : null].filter(Boolean)

  return shell(
    <>
      <Typography variant="h5" sx={{ fontWeight: 700, mb: 0.5 }}>{t('reviews.title')}</Typography>
      <Typography variant="body2" sx={{ color: 'text.secondary', mb: 3 }}>
        {ctx?.org_name}{subtitleParts.length ? ` · ${subtitleParts.join(' · ')}` : ''}
      </Typography>

      {error && <Alert severity="error" sx={{ mb: 2 }} data-testid="review-error">{error}</Alert>}

      <Typography variant="body2" sx={{ fontWeight: 600, mb: 1 }}>{t('reviews.ratingLabel')}</Typography>
      <Rating
        value={rating}
        onChange={(_, v) => setRating(v)}
        size="large"
        sx={{ mb: 3, '& .MuiRating-iconFilled': { color: 'primary.main' } }}
        data-testid="review-rating"
      />

      <TextField
        fullWidth
        multiline
        rows={4}
        label={t('reviews.commentLabel')}
        value={comment}
        onChange={e => setComment(e.target.value)}
        sx={{ mb: 3 }}
        slotProps={{ htmlInput: { maxLength: FIELD_LIMITS.description, 'data-testid': 'review-comment' } }}
      />

      <Button
        fullWidth
        variant="contained"
        size="large"
        onClick={submit}
        disabled={!rating || submitting}
        data-testid="review-submit"
      >
        {submitting ? <CircularProgress size={22} color="inherit" /> : t('reviews.submit')}
      </Button>
    </>,
  )
}
