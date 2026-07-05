import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import {
  Box, Typography, Card, CardContent, Button, TextField, Rating, Alert, CircularProgress, Avatar, Divider,
} from '@mui/material'
import { StarRounded as StarRoundedIcon } from '@/components/icons'
import { CheckCircleOutlined as CheckCircleOutlinedIcon } from '@/components/icons'
import { ScheduleOutlined as ScheduleOutlinedIcon } from '@/components/icons'
import { VisibilityOffOutlined as VisibilityOffOutlinedIcon } from '@/components/icons'
import { format } from 'date-fns'
import { useTranslation } from 'react-i18next'
import { ThemeProvider } from '@mui/material/styles'
import { supabase } from '@/lib/supabase'
import { LoadingState, EmptyState } from '@/components/ui'
import { SearchOffOutlined as SearchOffOutlinedIcon } from '@/components/icons'
import { LAYOUT, elevation } from '@/theme/theme'
import { getBookingTheme, makeBookingTheme } from '@/theme/bookingThemes'
import { dateLocale } from '@/lib/dateLocale'
import { FIELD_LIMITS } from '@/lib/validation'
import { toBusinessWallClock } from '@/lib/slots'
import { anim } from '@/theme/animations'

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

type View = 'loading' | 'not_found' | 'disabled' | 'not_completed' | 'already' | 'form' | 'done'

/**
 * Public review page — /review/:appointmentId. The appointment id is the
 * capability: only a real attendee has it, so no login is needed. Styled to
 * match the booking/confirmation pages (themed page + narrow card).
 */
export default function ReviewPage() {
  const { appointmentId } = useParams<{ appointmentId: string }>()
  const { t } = useTranslation()

  const [ctx, setCtx] = useState<ReviewContext | null>(null)
  const [view, setView] = useState<View>('loading')

  const [rating, setRating] = useState<number | null>(null)
  const [hover, setHover] = useState(-1)
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

  const bookingTheme = getBookingTheme(ctx?.booking_theme)
  const theme = makeBookingTheme(bookingTheme)

  if (view === 'loading') {
    // Review context (and its org booking theme) not loaded yet — keep the
    // spinner neutral grey instead of inheriting the base app accent.
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh', color: 'text.secondary' }}>
        <LoadingState color="inherit" />
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

  const subtitle = [ctx?.service_name, ctx?.scheduled_at
    // Business (Georgia) wall-clock date, wherever the reviewer is browsing.
    ? format(toBusinessWallClock(ctx.scheduled_at), 'd MMM yyyy', { locale: dateLocale() })
    : null].filter(Boolean).join(' · ')

  // Branded header — the business identity, so the page never reads as generic.
  const header = (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 3 }}>
      <Avatar sx={{ width: 44, height: 44, bgcolor: 'primary.main', fontWeight: 700 }}>
        {ctx?.org_name?.charAt(0) ?? '?'}
      </Avatar>
      <Box sx={{ minWidth: 0 }}>
        <Typography variant="subtitle1" noWrap sx={{ fontWeight: 700, lineHeight: 1.2 }}>
          {ctx?.org_name}
        </Typography>
        {subtitle && (
          <Typography variant="caption" sx={{ color: 'text.secondary' }}>{subtitle}</Typography>
        )}
      </Box>
    </Box>
  )

  // Themed card shell reused by every state.
  const shell = (children: React.ReactNode) => (
    <ThemeProvider theme={theme}>
      <Box
        sx={{
          minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
          bgcolor: bookingTheme.pageBg, p: 2,
        }}
      >
        <Card sx={{ maxWidth: LAYOUT.narrowCard, width: '100%', borderRadius: 4, boxShadow: elevation.modal, animation: anim.scaleIn }}>
          <CardContent sx={{ p: 4 }}>{children}</CardContent>
        </Card>
      </Box>
    </ThemeProvider>
  )

  // A centred outcome state (thanks / already / disabled / not-completed).
  const outcome = (icon: React.ReactNode, title: string, body: string) => shell(
    <Box sx={{ textAlign: 'center' }}>
      <Box
        sx={{
          width: 64, height: 64, borderRadius: '50%', mx: 'auto', mb: 2,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          bgcolor: (th) => `${th.palette.primary.main}1A`, color: 'primary.main',
        }}
      >
        {icon}
      </Box>
      <Typography variant="h5" sx={{ fontWeight: 700, mb: 0.5 }}>{title}</Typography>
      <Typography variant="body2" sx={{ color: 'text.secondary' }}>{body}</Typography>
      {ctx?.org_name && (
        <Typography variant="caption" sx={{ color: 'text.disabled', display: 'block', mt: 2 }}>
          {ctx.org_name}
        </Typography>
      )}
    </Box>,
  )

  if (view === 'done') {
    return outcome(<CheckCircleOutlinedIcon sx={{ fontSize: 34 }} />, t('reviews.thanksTitle'), t('reviews.thanksBody'))
  }
  if (view === 'already') {
    return outcome(<CheckCircleOutlinedIcon sx={{ fontSize: 34 }} />, t('reviews.alreadyTitle'), t('reviews.alreadyBody'))
  }
  if (view === 'disabled') {
    return outcome(<VisibilityOffOutlinedIcon sx={{ fontSize: 32 }} />, t('reviews.disabledTitle'), t('reviews.disabledBody'))
  }
  if (view === 'not_completed') {
    return outcome(<ScheduleOutlinedIcon sx={{ fontSize: 32 }} />, t('reviews.notCompletedTitle'), t('reviews.notCompletedBody'))
  }

  // view === 'form'
  const shown = hover !== -1 ? hover : rating
  const ratingLabel = shown ? t(`reviews.rating${shown}`) : ' '

  return shell(
    <>
      {header}
      <Divider sx={{ mb: 3 }} />

      <Typography variant="h5" sx={{ fontWeight: 700, mb: 3 }}>{t('reviews.title')}</Typography>

      {error && <Alert severity="error" sx={{ mb: 2.5 }} data-testid="review-error">{error}</Alert>}

      {/* Rating — left-aligned like every other field, with the descriptor inline
          so there's no reserved empty gap. */}
      <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 1 }}>{t('reviews.prompt')}</Typography>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 3, minHeight: 40 }}>
        <Rating
          value={rating}
          onChange={(_, v) => setRating(v)}
          onChangeActive={(_, v) => setHover(v)}
          icon={<StarRoundedIcon weight="fill" fontSize="inherit" />}
          emptyIcon={<StarRoundedIcon weight="regular" fontSize="inherit" />}
          sx={{
            fontSize: '2.25rem',
            '& .MuiRating-iconFilled': { color: 'primary.main' },
            '& .MuiRating-iconEmpty': { color: 'action.disabledBackground' },
            '& .MuiRating-iconHover': { transform: 'scale(1.15)' },
          }}
          data-testid="review-rating"
        />
        {shown ? (
          <Typography variant="body2" sx={{ fontWeight: 600, color: 'primary.main' }}>
            {ratingLabel}
          </Typography>
        ) : null}
      </Box>

      <TextField
        fullWidth
        multiline
        rows={3}
        placeholder={t('reviews.commentPlaceholder')}
        label={t('reviews.commentLabel')}
        value={comment}
        onChange={e => setComment(e.target.value)}
        sx={{ mb: 3 }}
        slotProps={{ inputLabel: { shrink: true }, htmlInput: { maxLength: FIELD_LIMITS.description, 'data-testid': 'review-comment' } }}
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
