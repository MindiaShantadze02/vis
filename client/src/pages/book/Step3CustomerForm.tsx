import { useEffect, useRef, useState } from 'react'
import {
  Box, Typography, Button, TextField, Stack,
  Alert, CircularProgress, ToggleButtonGroup, ToggleButton,
  Checkbox, FormControlLabel, Link as MuiLink,
} from '@mui/material'
import { Trans } from 'react-i18next'
import { ArrowBackIosNew as ArrowBackIosNewIcon } from '@/components/icons'
import { CreditCardOutlined as CreditCardOutlinedIcon } from '@/components/icons'
import { StorefrontOutlined as StorefrontOutlinedIcon } from '@/components/icons'
import { SmsOutlined as SmsOutlinedIcon } from '@/components/icons'
import { format } from 'date-fns'
import { dateLocale } from '@/lib/dateLocale'
import { useTranslation } from 'react-i18next'
import { supabase } from '@/lib/supabase'
import { isValidGeorgianPhone, formatGeorgianPhone, displayGeorgianPhone, isValidPersonName, FIELD_LIMITS } from '@/lib/validation'
import { BUSINESS_UTC_OFFSET, businessDayWindow, toBusinessWallClock } from '@/lib/slots'
import { CONSENT_VERSION } from '@/pages/legal/legalContent'
import { postToParent } from './useEmbedBridge'
import { elevation } from '@/theme/theme'
import type { BookingOrg, BookingState } from './BookingLayout'

interface Props {
  org: BookingOrg
  booking: BookingState
  onChange: (p: Partial<BookingState>) => void
  onBack: () => void
  onDone: (appointmentId: string) => void
  /** Booking-theme "deep" accent for the price/total (e.g. brass on the charcoal theme). */
  priceColor?: string
  /** Running inside an embed iframe — payment must break out to the top window. */
  embed?: boolean
}

/** Above-the-input field label, matching the booking design (no floating MUI label). */
function FieldLabel({ children, required }: { children: string; required?: boolean }) {
  return (
    <Typography
      component="label"
      sx={{ display: 'block', fontSize: '0.78rem', fontWeight: 600, color: 'text.secondary', mb: 0.75 }}
    >
      {children}{required ? ' *' : ''}
    </Typography>
  )
}

export default function Step3CustomerForm({ org, booking, onChange, onBack, onDone, priceColor, embed }: Props) {
  const { t } = useTranslation()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Consent to Privacy Policy + Terms — required before a booking can proceed
  // (Law on Personal Data Protection, Art. 12 / 32(9)).
  const [consent, setConsent] = useState(false)

  // Phone-verification (OTP) gate between the form and the actual booking insert.
  const [phase, setPhase] = useState<'form' | 'otp'>('form')
  const [code, setCode] = useState('')
  const [resendIn, setResendIn] = useState(0)
  // Last code we auto-submitted, so a failed attempt isn't retried in a loop
  // while the same 6 digits sit in the field.
  const autoSubmitted = useRef<string | null>(null)

  const onlineEnabled = org.payment_config?.bog?.enabled || org.payment_config?.tbc?.enabled
  const inPersonEnabled = org.payment_config?.inPerson?.enabled !== false

  const availableMethods: Array<'in_person' | 'online'> = []
  if (inPersonEnabled) availableMethods.push('in_person')
  if (onlineEnabled) availableMethods.push('online')
  // Only worth asking the customer when there's an actual choice to make.
  const multiplePaymentOptions = availableMethods.length > 1

  // The chosen slot is business (Georgia) wall-clock time — pin the stored
  // instant to the business offset so it doesn't shift with the viewer's zone.
  const scheduledAt = booking.date && booking.time
    ? new Date(`${booking.date}T${booking.time}:00${BUSINESS_UTC_OFFSET}`)
    : null
  // For format() in the summary lines — renders the business wall clock
  // (i.e. exactly what the customer picked) in any viewer timezone.
  const scheduledAtDisplay = scheduledAt ? toBusinessWallClock(scheduledAt) : null

  // Resend cooldown countdown.
  useEffect(() => {
    if (resendIn <= 0) return
    const id = setTimeout(() => setResendIn(s => s - 1), 1000)
    return () => clearTimeout(id)
  }, [resendIn])

  // With a single payment option there's nothing to pick, so we hide the
  // selector — but the booking still has to carry the right method. The default
  // is 'in_person', which would be wrong for an online-only business, so pin
  // paymentMethod to the only available option here.
  useEffect(() => {
    const methods: Array<'in_person' | 'online'> = []
    if (inPersonEnabled) methods.push('in_person')
    if (onlineEnabled) methods.push('online')
    if (methods.length > 0 && !methods.includes(booking.paymentMethod)) {
      onChange({ paymentMethod: methods[0] })
    }
  }, [inPersonEnabled, onlineEnabled, booking.paymentMethod, onChange])

  // Step 1: text a verification code to the customer's phone, then switch to the
  // code-entry view. The booking itself is only created after the code checks out.
  async function sendCode() {
    setLoading(true)
    setError(null)
    const { data, error: fnErr } = await supabase.functions.invoke('request-booking-otp', {
      body: { phone: booking.phone, org_id: org.id },
    })
    setLoading(false)
    if (fnErr || !data?.ok) {
      setError(data?.error === 'too_soon' ? t('booking.otpTooSoon')
        : data?.error === 'too_many_requests' ? t('booking.otpTooMany')
        : t('booking.otpSendFailed'))
      return
    }
    setPhase('otp')
    setResendIn(60)
  }

  // Step 2: verify the entered code, then create the booking.
  async function verifyAndBook() {
    if (code.length !== 6 || loading) return
    setLoading(true)
    setError(null)
    const { data, error: fnErr } = await supabase.functions.invoke('verify-booking-otp', {
      body: { phone: booking.phone, code },
    })
    if (fnErr || !data?.verified) {
      setLoading(false)
      setError(data?.error === 'wrong_code'
        ? t('booking.otpWrong', { remaining: data.remaining ?? 0 })
        : t('booking.otpExpired'))
      return
    }
    await confirmBooking()
  }

  // Auto-verify the moment the 6th digit lands — one less tap. The Verify
  // button stays as the retry path; the ref stops the same (failed) code from
  // resubmitting itself in a loop.
  useEffect(() => {
    if (phase !== 'otp' || code.length !== 6 || loading) return
    if (autoSubmitted.current === code) return
    autoSubmitted.current = code
    void verifyAndBook()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code, phase])

  async function confirmBooking() {
    if (!booking.service || !scheduledAt) return
    setLoading(true)
    setError(null)

    try {
      // Re-check availability right before inserting: the slot may have filled
      // since it was computed in Step 2 (capacity and per-person freedom).
      const { from: dayStart, to: dayEnd } = businessDayWindow(booking.date)
      // Org-scoped busy slots via SECURITY DEFINER RPC — anon has no direct read
      // on the appointments table (066 hardening).
      const { data: existing } = await supabase
        .rpc('get_org_busy_slots', { p_org_id: org.id, p_from: dayStart, p_to: dayEnd }) as {
          data: Array<{ scheduled_at: string; duration_minutes: number; service_id: string; staff_id: string | null }> | null
        }

      const slotStart = scheduledAt.getTime()
      const slotEnd = slotStart + booking.service.duration_minutes * 60000
      const overlapping = (existing ?? []).filter(a => {
        const aStart = new Date(a.scheduled_at).getTime()
        const aEnd = aStart + a.duration_minutes * 60000
        return slotStart < aEnd && slotEnd > aStart
      })

      // Per-service capacity cap.
      const serviceCount = overlapping.filter(a => a.service_id === booking.service!.id).length
      if (serviceCount >= booking.service.max_per_slot) {
        setError(t('booking.slotTaken')); setLoading(false); return
      }

      // Resolve the assigned person. "Any available" auto-assigns a free member
      // so per-person availability stays correct for subsequent bookings.
      let staffId: string | null = null
      if (booking.assignedStaff.length > 0) {
        const busyIds = new Set(
          overlapping.map(a => a.staff_id).filter((id): id is string => !!id),
        )
        if (booking.staffId) {
          if (busyIds.has(booking.staffId)) { setError(t('booking.slotTaken')); setLoading(false); return }
          staffId = booking.staffId
        } else {
          const free = booking.assignedStaff
            .filter(m => !busyIds.has(m.id))
            .sort((a, b) => a.sort_order - b.sort_order)
          if (free.length === 0) { setError(t('booking.slotTaken')); setLoading(false); return }
          staffId = free[0].id
        }
      }

      // Online (pay now): create NOTHING yet. Hand the booking details to the
      // payment flow — the appointment is created by payment-webhook only once
      // the charge clears, so a failed or abandoned payment leaves nothing on
      // the business's dashboard.
      if (booking.paymentMethod === 'online') {
        const { data: pay, error: payErr } = await supabase.functions.invoke('create-payment', {
          body: {
            purpose: 'appointment',
            org_id: org.id,
            service_id: booking.service.id,
            scheduled_at: scheduledAt.toISOString(),
            staff_id: staffId,
            first_name: booking.firstName.trim(),
            last_name: booking.lastName.trim() || null,
            phone: booking.phone,
            notes: booking.notes.trim() || null,
            consent_version: CONSENT_VERSION,
            slug: org.slug,
            returnBaseUrl: window.location.origin,
          },
        })
        if (payErr || !pay?.checkoutUrl) {
          setError(t('booking.paymentStartFailed'))
          setLoading(false)
          return
        }
        if (embed) {
          // Payment gateways refuse to load inside an iframe. Hand the URL to the
          // host page (embed.js) to navigate the top window out to the gateway.
          postToParent({ type: 'vis:redirect', url: pay.checkoutUrl })
        } else {
          window.location.assign(pay.checkoutUrl)
        }
        return
      }

      // In-person: create the appointment now (it just needs admin approval).
      const customerId = crypto.randomUUID()
      const appointmentId = crypto.randomUUID()

      const { error: custErr } = await supabase
        .from('customers')
        .insert({
          id: customerId,
          first_name: booking.firstName.trim(),
          last_name: booking.lastName.trim() || null,
          phone_number: formatGeorgianPhone(booking.phone),
          consent_accepted_at: new Date().toISOString(),
          consent_version: CONSENT_VERSION,
        })

      if (custErr) throw new Error(custErr.message)

      const { error: apptErr } = await supabase
        .from('appointments')
        .insert({
          id: appointmentId,
          org_id: org.id,
          service_id: booking.service.id,
          customer_id: customerId,
          scheduled_at: scheduledAt.toISOString(),
          duration_minutes: booking.service.duration_minutes,
          staff_id: staffId,
          status: 'pending',
          payment_method: 'in_person',
          payment_status: 'unpaid',
          notes: booking.notes.trim() || null,
        })

      if (apptErr) throw new Error(apptErr.message)

      onDone(appointmentId)
    } catch (err) {
      const msg = err instanceof Error ? err.message : ''
      // The org may have hit its monthly tier limit since the page loaded —
      // the DB trigger (enforce_appointment_limit) rejects with 'limit_reached'.
      // Show the same friendly unavailable copy; a guest can't upgrade.
      if (msg.includes('limit_reached')) {
        setError(t('booking.unavailable'))
      } else if (msg.includes('verification_required')) {
        // The verified code lapsed or was already used — send a fresh one.
        setError(t('booking.otpExpired'))
        setCode('')
        setPhase('form')
      } else {
        setError(msg || t('booking.bookFailed'))
      }
      setLoading(false)
    }
  }

  const phoneInvalid = booking.phone.trim().length > 0 && !isValidGeorgianPhone(booking.phone)
  const firstNameTooShort = booking.firstName.trim().length > 0 && booking.firstName.trim().length < 2
  const firstNameInvalid = booking.firstName.trim().length >= 2 && !isValidPersonName(booking.firstName)
  const lastNameInvalid = booking.lastName.trim().length > 0 && !isValidPersonName(booking.lastName)
  const canBook =
    booking.firstName.trim().length >= 2 &&
    isValidPersonName(booking.firstName) &&
    !lastNameInvalid &&
    isValidGeorgianPhone(booking.phone) &&
    consent

  // Staff line for the summary card. Null when the service has no assignable
  // people (we then omit the row rather than show an empty value).
  const staffLabel = booking.assignedStaff.length === 0
    ? null
    : booking.staffId
      ? (booking.assignedStaff.find(m => m.id === booking.staffId)?.display_name || '—')
      : t('booking.anyAvailable')

  return (
    <Box>
      <Button
        startIcon={<ArrowBackIosNewIcon sx={{ fontSize: 14 }} />}
        onClick={phase === 'otp' ? () => { setPhase('form'); setError(null) } : onBack}
        size="small"
        sx={{ mb: 2, color: 'text.secondary' }}
      >
        {t('common.back')}
      </Button>

      {phase === 'form' && (
      <>
      <Typography variant="h5" sx={{ fontWeight: 700, mb: 0.5 }}>{t('booking.detailsHeading')}</Typography>
      {scheduledAt && (
        <Typography variant="body2" sx={{ color: 'text.secondary', mb: 3 }}>
          {booking.service?.name} · {format(scheduledAtDisplay!, 'd MMMM, HH:mm', { locale: dateLocale() })}
        </Typography>
      )}

      {error && <Alert severity="error" sx={{ mb: 2 }} data-testid="book-error">{error}</Alert>}

      <Stack spacing={2.25}>
        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' }, gap: 1.5 }}>
          <Box>
            <FieldLabel required>{t('booking.firstName')}</FieldLabel>
            <TextField
              value={booking.firstName}
              onChange={e => onChange({ firstName: e.target.value })}
              fullWidth
              required
              autoFocus
              error={firstNameTooShort || firstNameInvalid}
              helperText={
                firstNameTooShort ? t('validation.minLength', { min: 2 })
                : firstNameInvalid ? t('validation.lettersOnly')
                : undefined
              }
              slotProps={{ htmlInput: { maxLength: FIELD_LIMITS.personName, 'data-testid': 'book-first-name' } }}
            />
          </Box>
          <Box>
            <FieldLabel>{t('booking.lastName')}</FieldLabel>
            <TextField
              value={booking.lastName}
              onChange={e => onChange({ lastName: e.target.value })}
              fullWidth
              error={lastNameInvalid}
              helperText={lastNameInvalid ? t('validation.lettersOnly') : undefined}
              slotProps={{ htmlInput: { maxLength: FIELD_LIMITS.personName, 'data-testid': 'book-last-name' } }}
            />
          </Box>
        </Box>

        <Box>
          <FieldLabel required>{t('booking.phone')}</FieldLabel>
          <TextField
            value={booking.phone}
            onChange={e => onChange({ phone: e.target.value })}
            fullWidth
            required
            placeholder="599 123 456"
            error={phoneInvalid}
            helperText={phoneInvalid ? t('validation.invalidPhone') : t('booking.smsHelper')}
            slotProps={{ htmlInput: { inputMode: 'tel' as const, 'data-testid': 'book-phone' } }}
          />
        </Box>

        <Box>
          <FieldLabel>{t('booking.notes')}</FieldLabel>
          <TextField
            value={booking.notes}
            onChange={e => onChange({ notes: e.target.value })}
            fullWidth
            multiline
            rows={2}
            helperText={t('booking.notesSensitiveWarning')}
            slotProps={{ htmlInput: { maxLength: FIELD_LIMITS.notes, 'data-testid': 'book-notes' } }}
          />
        </Box>

        {/* Payment method — only ask when more than one option exists. */}
        {availableMethods.length > 0 && (
          <Box>
            {multiplePaymentOptions && (
              <>
                <Typography variant="body2" sx={{ fontWeight: 600, mb: 1 }}>{t('booking.paymentMethod')}</Typography>
                <ToggleButtonGroup
                  value={booking.paymentMethod}
                  exclusive
                  onChange={(_, v) => v && onChange({ paymentMethod: v })}
                  fullWidth
                >
                  <ToggleButton value="in_person" data-testid="book-pay-in_person">
                    <StorefrontOutlinedIcon sx={{ mr: 1, fontSize: 18 }} />
                    {t('settings.locationInPerson')}
                  </ToggleButton>
                  <ToggleButton value="online" data-testid="book-pay-online">
                    <CreditCardOutlinedIcon sx={{ mr: 1, fontSize: 18 }} />
                    {t('settings.locationOnline')}
                  </ToggleButton>
                </ToggleButtonGroup>
              </>
            )}
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: multiplePaymentOptions ? 1.25 : 0 }}>
              {booking.paymentMethod === 'in_person'
                ? <StorefrontOutlinedIcon sx={{ fontSize: 16, color: 'success.main' }} />
                : <CreditCardOutlinedIcon sx={{ fontSize: 16, color: 'primary.main' }} />}
              <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                {booking.paymentMethod === 'in_person' ? t('booking.payInPersonHint') : t('booking.payOnlineHint')}
              </Typography>
            </Box>
          </Box>
        )}

        {/* Summary card — styled as the booking ticket (perforated total). */}
        <Box sx={{ bgcolor: 'background.paper', border: '1px solid', borderColor: 'divider', borderRadius: 4, p: 2.5, boxShadow: elevation.card, overflow: 'hidden' }}>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 1 }}>
            <Typography variant="body2" sx={{ color: 'text.secondary' }}>{t('booking.summaryService')}</Typography>
            <Typography variant="body2" sx={{ fontWeight: 600 }}>{booking.service?.name}</Typography>
          </Box>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: staffLabel ? 1 : 0 }}>
            <Typography variant="body2" sx={{ color: 'text.secondary' }}>{t('booking.summaryDate')}</Typography>
            <Typography variant="body2" sx={{ fontWeight: 600 }}>
              {scheduledAtDisplay ? format(scheduledAtDisplay, 'd MMM, HH:mm', { locale: dateLocale() }) : '—'}
            </Typography>
          </Box>
          {staffLabel && (
            <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
              <Typography variant="body2" sx={{ color: 'text.secondary' }}>{t('booking.selectStaff')}</Typography>
              <Typography variant="body2" sx={{ fontWeight: 600 }}>{staffLabel}</Typography>
            </Box>
          )}
          <Box
            aria-hidden
            sx={{
              position: 'relative',
              borderTop: '1.5px dashed rgba(30,36,51,0.18)',
              mx: -2.5,
              my: 1.75,
              '&::before, &::after': {
                content: '""', position: 'absolute', top: '-7px',
                width: 14, height: 14, borderRadius: '50%', bgcolor: 'background.default',
              },
              '&::before': { left: -7 },
              '&::after': { right: -7 },
            }}
          />
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
            <Typography variant="body2" sx={{ fontWeight: 700 }}>{t('booking.total')}</Typography>
            <Typography variant="h6" sx={{ fontWeight: 800, color: priceColor ?? 'primary.dark' }}>
              {booking.service?.price} ₾
            </Typography>
          </Box>
        </Box>

        <FormControlLabel
          sx={{ alignItems: 'flex-start', mr: 0 }}
          control={
            <Checkbox
              checked={consent}
              onChange={e => setConsent(e.target.checked)}
              size="small"
              sx={{ pt: 0.25 }}
              data-testid="book-consent"
            />
          }
          label={
            <Typography variant="caption" sx={{ color: 'text.secondary', lineHeight: 1.5 }}>
              <Trans
                i18nKey="common.consent"
                components={{
                  priv: <MuiLink href="/privacy" target="_blank" rel="noopener" underline="hover" />,
                  terms: <MuiLink href="/terms" target="_blank" rel="noopener" underline="hover" />,
                }}
              />
            </Typography>
          }
        />

        <Button
          fullWidth
          variant="contained"
          size="large"
          onClick={sendCode}
          disabled={loading || !canBook}
          data-testid="book-submit"
        >
          {loading
            ? <CircularProgress size={22} color="inherit" />
            : booking.paymentMethod === 'online' ? t('booking.proceedToPayment') : t('booking.book')
          }
        </Button>
      </Stack>
      </>
      )}

      {phase === 'otp' && (
        <Box sx={{ maxWidth: 400 }}>
          {error && <Alert severity="error" sx={{ mb: 2 }} data-testid="book-error">{error}</Alert>}
          <Box
            sx={{
              width: 56, height: 56, borderRadius: 3, mb: 2,
              bgcolor: 'secondary.main', color: 'primary.main',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}
          >
            <SmsOutlinedIcon />
          </Box>
          <Typography variant="h5" sx={{ fontWeight: 700, mb: 0.75 }}>{t('booking.verifyNumber')}</Typography>
          <Typography variant="body2" sx={{ color: 'text.secondary', mb: 3 }}>
            {t('booking.otpSent', { phone: displayGeorgianPhone(booking.phone) })}
          </Typography>
          <Stack spacing={2}>
            {/* Same above-the-input label style as the rest of the form (the
                floating MUI label was the one inconsistent field in the flow). */}
            <Box>
              <FieldLabel required>{t('booking.otpLabel')}</FieldLabel>
              <TextField
                required
                value={code}
                onChange={e => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                fullWidth
                autoFocus
                placeholder="••••••"
                sx={{ '& input': { textAlign: 'center', fontSize: '1.6rem', letterSpacing: '0.5em', fontWeight: 700 } }}
                slotProps={{ htmlInput: { inputMode: 'numeric' as const, maxLength: 6, 'data-testid': 'book-otp-code' } }}
              />
            </Box>
            <Button
              fullWidth
              variant="contained"
              size="large"
              onClick={verifyAndBook}
              disabled={loading || code.length !== 6}
              data-testid="book-otp-verify"
            >
              {loading ? <CircularProgress size={22} color="inherit" /> : t('booking.otpVerify')}
            </Button>
            <Button
              fullWidth
              size="small"
              onClick={sendCode}
              disabled={loading || resendIn > 0}
              sx={{ color: 'text.secondary' }}
            >
              {resendIn > 0 ? t('booking.otpResendIn', { seconds: resendIn }) : t('booking.otpResend')}
            </Button>
          </Stack>
        </Box>
      )}
    </Box>
  )
}
