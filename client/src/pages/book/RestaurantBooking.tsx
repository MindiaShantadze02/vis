import { useEffect, useMemo, useState } from 'react'
import {
  Box, Typography, Button, TextField, Stack, Alert,
  CircularProgress, Avatar,
} from '@mui/material'
import { ArrowBackIosNew as ArrowBackIosNewIcon } from '@/components/icons'
import { SmsOutlined as SmsOutlinedIcon } from '@/components/icons'
import { CheckCircleOutlined as CheckCircleOutlineIcon } from '@/components/icons'
import { PhoneOutlined as PhoneOutlinedIcon } from '@/components/icons'
import { format, addDays } from 'date-fns'
import { ka } from 'date-fns/locale'
import { useTranslation } from 'react-i18next'
import { supabase } from '@/lib/supabase'
import {
  isValidGeorgianPhone, formatGeorgianPhone, isValidPersonName, FIELD_LIMITS,
} from '@/lib/validation'
import { computeReservationSlots } from '@/lib/restaurantSlots'
import type { WeekTemplate, SlotOverride } from '@/lib/slots'
import type { ReservationRow, RestaurantTable } from '@/lib/restaurantSlots'
import type { BookingOrg } from './BookingLayout'

// Slot granularity is fixed; turn time is per-org (org.reservation_turn_minutes).
const SLOT_MINUTES = 30
const PARTY_SIZES = [1, 2, 3, 4, 5, 6, 7, 8]
const ADVANCE_DAYS = 14

interface Props {
  org: BookingOrg
  /** Accent colour from the resolved booking theme (for headings/price). */
  accent?: string
}

const localDateKey = (d: Date) => format(d, 'yyyy-MM-dd')

export default function RestaurantBooking({ org, accent }: Props) {
  const { t } = useTranslation()
  const turnMinutes = org.reservation_turn_minutes ?? 120

  const [step, setStep] = useState(0)
  const [partySize, setPartySize] = useState<number | null>(null)
  const [date, setDate] = useState('')
  const [time, setTime] = useState('')
  const [tableId, setTableId] = useState('')

  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [phone, setPhone] = useState('')
  const [notes, setNotes] = useState('')

  const [template, setTemplate] = useState<WeekTemplate | null>(null)
  const [tables, setTables] = useState<RestaurantTable[]>([])
  const [override, setOverride] = useState<SlotOverride | null>(null)
  const [reservations, setReservations] = useState<ReservationRow[]>([])

  const [phase, setPhase] = useState<'form' | 'otp'>('form')
  const [code, setCode] = useState('')
  const [resendIn, setResendIn] = useState(0)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)

  // Load the weekly template + active tables once.
  useEffect(() => {
    async function load() {
      const [tplRes, tblRes] = await Promise.all([
        supabase.from('working_hours_template').select('*').eq('org_id', org.id).maybeSingle(),
        supabase.from('resources').select('id, capacity').eq('org_id', org.id).eq('kind', 'table').eq('is_active', true),
      ])
      setTemplate((tplRes.data as WeekTemplate | null) ?? null)
      setTables((tblRes.data as RestaurantTable[] | null) ?? [])
    }
    load()
  }, [org.id])

  // Load that date's override + existing reservations whenever the date changes.
  useEffect(() => {
    if (!date) return
    async function loadDay() {
      const dayStart = `${date}T00:00:00.000Z`
      const dayEnd = `${date}T23:59:59.999Z`
      const [ovrRes, resvRes] = await Promise.all([
        supabase.from('working_hours_overrides').select('is_closed, ranges').eq('org_id', org.id).eq('date', date).maybeSingle(),
        supabase
          .from('restaurant_reservations')
          .select('reserved_at, turn_minutes, table_id')
          .eq('org_id', org.id)
          .gte('reserved_at', dayStart)
          .lte('reserved_at', dayEnd)
          .not('status', 'in', '(rejected,cancelled,no_show)'),
      ])
      setOverride((ovrRes.data as SlotOverride | null) ?? null)
      setReservations((resvRes.data as ReservationRow[] | null) ?? [])
    }
    loadDay()
  }, [org.id, date])

  const days = useMemo(
    () => Array.from({ length: ADVANCE_DAYS }, (_, i) => addDays(new Date(), i)),
    [],
  )

  const slots = useMemo(() => {
    if (!date || partySize == null) return []
    return computeReservationSlots({
      date: new Date(`${date}T00:00:00`),
      template, override, tables,
      existing: reservations,
      partySize, turnMinutes, slotMinutes: SLOT_MINUTES,
    })
  }, [date, partySize, template, override, tables, reservations, turnMinutes])

  // Resend cooldown.
  useEffect(() => {
    if (resendIn <= 0) return
    const id = setTimeout(() => setResendIn(s => s - 1), 1000)
    return () => clearTimeout(id)
  }, [resendIn])

  const phoneInvalid = phone.trim().length > 0 && !isValidGeorgianPhone(phone)
  const firstNameTooShort = firstName.trim().length > 0 && firstName.trim().length < 2
  const firstNameInvalid = firstName.trim().length >= 2 && !isValidPersonName(firstName)
  const lastNameInvalid = lastName.trim().length > 0 && !isValidPersonName(lastName)
  const canBook =
    firstName.trim().length >= 2 &&
    isValidPersonName(firstName) &&
    !lastNameInvalid &&
    isValidGeorgianPhone(phone)

  async function sendCode() {
    setLoading(true); setError(null)
    const { data, error: fnErr } = await supabase.functions.invoke('request-booking-otp', {
      body: { phone, org_id: org.id },
    })
    setLoading(false)
    if (fnErr || !data?.ok) {
      setError(data?.error === 'too_soon' ? t('booking.otpTooSoon') : t('booking.otpSendFailed'))
      return
    }
    setPhase('otp'); setResendIn(60)
  }

  async function verifyAndReserve() {
    if (code.length !== 6) return
    setLoading(true); setError(null)
    const { data, error: fnErr } = await supabase.functions.invoke('verify-booking-otp', {
      body: { phone, code },
    })
    if (fnErr || !data?.verified) {
      setLoading(false)
      setError(data?.error === 'wrong_code'
        ? t('booking.otpWrong', { remaining: data.remaining ?? 0 })
        : t('booking.otpExpired'))
      return
    }
    await reserve()
  }

  async function reserve() {
    if (partySize == null || !date || !time) return
    setLoading(true); setError(null)
    try {
      const reservedAt = new Date(`${date}T${time}:00`)
      const slotEnd = new Date(reservedAt.getTime() + turnMinutes * 60000)

      // Re-check the chosen table is still free (another guest may have taken it).
      const dayStart = `${date}T00:00:00.000Z`
      const dayEnd = `${date}T23:59:59.999Z`
      const { data: fresh } = await supabase
        .from('restaurant_reservations')
        .select('reserved_at, turn_minutes, table_id')
        .eq('org_id', org.id)
        .gte('reserved_at', dayStart)
        .lte('reserved_at', dayEnd)
        .not('status', 'in', '(rejected,cancelled,no_show)')

      const clash = (fresh ?? []).some(r => {
        if (r.table_id !== tableId) return false
        const rStart = new Date(r.reserved_at).getTime()
        const rEnd = rStart + r.turn_minutes * 60000
        return reservedAt.getTime() < rEnd && slotEnd.getTime() > rStart
      })
      if (clash) { setError(t('booking.slotTaken')); setLoading(false); return }

      const customerId = crypto.randomUUID()
      const { error: custErr } = await supabase.from('customers').insert({
        id: customerId,
        first_name: firstName.trim(),
        last_name: lastName.trim() || null,
        phone_number: formatGeorgianPhone(phone),
      })
      if (custErr) throw new Error(custErr.message)

      const { error: resvErr } = await supabase.from('restaurant_reservations').insert({
        org_id: org.id,
        customer_id: customerId,
        table_id: tableId,
        party_size: partySize,
        reserved_at: reservedAt.toISOString(),
        turn_minutes: turnMinutes,
        status: 'pending',
        notes: notes.trim() || null,
      })
      if (resvErr) throw new Error(resvErr.message)

      setDone(true)
    } catch (err) {
      const msg = err instanceof Error ? err.message : ''
      if (msg.includes('verification_required')) {
        setError(t('booking.otpExpired')); setCode(''); setPhase('form')
      } else {
        setError(msg || t('booking.bookFailed'))
      }
      setLoading(false)
    }
  }

  // ── Done view ───────────────────────────────────────────────
  if (done) {
    return (
      <Box sx={{ maxWidth: 460, mx: 'auto', textAlign: 'center', py: 6 }}>
        <CheckCircleOutlineIcon sx={{ fontSize: 64, color: 'success.main', mb: 2 }} />
        <Typography variant="h5" sx={{ fontWeight: 700, mb: 1 }}>{t('restaurant.reservationDone')}</Typography>
        <Typography variant="body2" sx={{ color: 'text.secondary', mb: 3 }}>
          {t('restaurant.reservationDoneCaption')}
        </Typography>
        <Box sx={{ bgcolor: 'background.paper', border: '1px solid', borderColor: 'divider', borderRadius: 3, p: 2.5, textAlign: 'left' }}>
          <Row label={t('restaurant.partySize')} value={`${partySize}`} />
          <Row label={t('booking.summaryDate')} value={format(new Date(`${date}T${time}:00`), 'd MMM, HH:mm', { locale: ka })} />
        </Box>
        {org.contact_phone && (
          <Typography variant="caption" sx={{ display: 'block', mt: 2, color: 'text.secondary' }}>
            {org.contact_phone}
          </Typography>
        )}
      </Box>
    )
  }

  const header = (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 4 }}>
      <Avatar src={org.logo_url ?? undefined} sx={{ width: 48, height: 48, fontWeight: 700 }}>
        {org.name.charAt(0)}
      </Avatar>
      <Box>
        <Typography variant="h6" sx={{ fontWeight: 700 }}>{org.name}</Typography>
        {org.contact_phone && (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
            <PhoneOutlinedIcon sx={{ fontSize: 13, opacity: 0.7 }} />
            <Typography variant="caption" sx={{ color: 'text.secondary' }}>{org.contact_phone}</Typography>
          </Box>
        )}
      </Box>
    </Box>
  )

  return (
    <Box sx={{ maxWidth: 560, mx: 'auto', px: { xs: 2, md: 3 }, py: { xs: 3, md: 5 } }}>
      {header}

      {error && step < 2 && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

      {/* Step 0 — party size */}
      {step === 0 && (
        <Box>
          <Typography variant="h5" sx={{ fontWeight: 700, mb: 2, color: accent }}>{t('restaurant.partySize')}</Typography>
          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1.25 }}>
            {PARTY_SIZES.map(n => (
              <Button
                key={n}
                variant={partySize === n ? 'contained' : 'outlined'}
                onClick={() => { setPartySize(n); setStep(1) }}
                data-testid={`resv-party-${n}`}
                sx={{ minWidth: 60, height: 60, fontSize: 18, fontWeight: 700 }}
              >
                {n}
              </Button>
            ))}
          </Box>
        </Box>
      )}

      {/* Step 1 — date + time */}
      {step === 1 && (
        <Box>
          <BackButton onClick={() => setStep(0)} label={t('common.back')} />
          <Typography variant="h5" sx={{ fontWeight: 700, mb: 2, color: accent }}>{t('restaurant.chooseDate')}</Typography>
          <Box sx={{ display: 'flex', gap: 1, overflowX: 'auto', pb: 1, mb: 3 }}>
            {days.map(d => {
              const key = localDateKey(d)
              const selected = key === date
              return (
                <Box
                  key={key}
                  data-testid="resv-day"
                  onClick={() => { setDate(key); setTime('') }}
                  sx={{
                    minWidth: 60, py: 1, borderRadius: 2, textAlign: 'center', cursor: 'pointer',
                    border: '2px solid', borderColor: selected ? 'primary.main' : 'divider',
                    bgcolor: selected ? 'secondary.main' : 'background.paper',
                  }}
                >
                  <Typography variant="caption" sx={{ display: 'block', textTransform: 'uppercase' }}>
                    {format(d, 'EEE', { locale: ka })}
                  </Typography>
                  <Typography variant="body1" sx={{ fontWeight: 700 }}>{format(d, 'd')}</Typography>
                </Box>
              )
            })}
          </Box>

          {date && (
            <>
              <Typography variant="h6" sx={{ fontWeight: 700, mb: 1.5 }}>{t('restaurant.chooseTime')}</Typography>
              {slots.length === 0 ? (
                <Typography variant="body2" sx={{ color: 'text.secondary' }}>{t('restaurant.noTimes')}</Typography>
              ) : (
                <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
                  {slots.map(s => (
                    <Button
                      key={s.time}
                      variant={time === s.time ? 'contained' : 'outlined'}
                      data-testid="resv-slot"
                      onClick={() => { setTime(s.time); setTableId(s.tableId); setStep(2) }}
                    >
                      {s.time}
                    </Button>
                  ))}
                </Box>
              )}
            </>
          )}
        </Box>
      )}

      {/* Step 2 — details + OTP */}
      {step === 2 && phase === 'form' && (
        <Box>
          <BackButton onClick={() => setStep(1)} label={t('common.back')} />
          <Typography variant="h5" sx={{ fontWeight: 700, mb: 0.5, color: accent }}>{t('restaurant.detailsHeading')}</Typography>
          <Typography variant="body2" sx={{ color: 'text.secondary', mb: 3 }}>
            {format(new Date(`${date}T${time}:00`), 'd MMMM, HH:mm', { locale: ka })} · {partySize} {t('restaurant.guests')}
          </Typography>
          {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
          <Stack spacing={2.25}>
            <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' }, gap: 1.5 }}>
              <TextField
                label={t('booking.firstName')}
                value={firstName}
                onChange={e => setFirstName(e.target.value)}
                required
                error={firstNameTooShort || firstNameInvalid}
                helperText={
                  firstNameTooShort ? t('validation.minLength', { min: 2 })
                  : firstNameInvalid ? t('validation.lettersOnly') : undefined
                }
                slotProps={{ htmlInput: { maxLength: FIELD_LIMITS.personName, 'data-testid': 'resv-first-name' } }}
              />
              <TextField
                label={t('booking.lastName')}
                value={lastName}
                onChange={e => setLastName(e.target.value)}
                error={lastNameInvalid}
                helperText={lastNameInvalid ? t('validation.lettersOnly') : undefined}
                slotProps={{ htmlInput: { maxLength: FIELD_LIMITS.personName } }}
              />
            </Box>
            <TextField
              label={t('booking.phone')}
              value={phone}
              onChange={e => setPhone(e.target.value)}
              required
              placeholder="599 123 456"
              error={phoneInvalid}
              helperText={phoneInvalid ? t('validation.invalidPhone') : t('booking.smsHelper')}
              slotProps={{ htmlInput: { inputMode: 'tel', 'data-testid': 'resv-phone' } }}
            />
            <TextField
              label={t('booking.notes')}
              value={notes}
              onChange={e => setNotes(e.target.value)}
              multiline
              rows={2}
              slotProps={{ htmlInput: { maxLength: FIELD_LIMITS.notes } }}
            />
            <Button
              fullWidth variant="contained" size="large"
              onClick={sendCode}
              disabled={loading || !canBook}
              data-testid="resv-submit"
            >
              {loading ? <CircularProgress size={22} color="inherit" /> : t('restaurant.reserve')}
            </Button>
          </Stack>
        </Box>
      )}

      {/* Step 2 — OTP */}
      {step === 2 && phase === 'otp' && (
        <Box sx={{ maxWidth: 400 }}>
          <BackButton onClick={() => { setPhase('form'); setError(null) }} label={t('common.back')} />
          {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
          <Box sx={{ width: 56, height: 56, borderRadius: 3, mb: 2, bgcolor: 'secondary.main', color: 'primary.main', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <SmsOutlinedIcon />
          </Box>
          <Typography variant="h5" sx={{ fontWeight: 700, mb: 0.75 }}>{t('booking.verifyNumber')}</Typography>
          <Typography variant="body2" sx={{ color: 'text.secondary', mb: 3 }}>{t('booking.otpSent', { phone })}</Typography>
          <Stack spacing={2}>
            <TextField
              label={t('booking.otpLabel')}
              value={code}
              onChange={e => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
              fullWidth autoFocus placeholder="••••••"
              sx={{ '& input': { textAlign: 'center', fontSize: '1.6rem', letterSpacing: '0.5em', fontWeight: 700 } }}
              slotProps={{ htmlInput: { inputMode: 'numeric', maxLength: 6, 'data-testid': 'resv-otp-code' } }}
            />
            <Button fullWidth variant="contained" size="large" onClick={verifyAndReserve} disabled={loading || code.length !== 6} data-testid="resv-otp-verify">
              {loading ? <CircularProgress size={22} color="inherit" /> : t('booking.otpVerify')}
            </Button>
            <Button fullWidth size="small" onClick={sendCode} disabled={loading || resendIn > 0} sx={{ color: 'text.secondary' }}>
              {resendIn > 0 ? t('booking.otpResendIn', { seconds: resendIn }) : t('booking.otpResend')}
            </Button>
          </Stack>
        </Box>
      )}
    </Box>
  )
}

function BackButton({ onClick, label }: { onClick: () => void; label: string }) {
  return (
    <Button startIcon={<ArrowBackIosNewIcon sx={{ fontSize: 14 }} />} onClick={onClick} size="small" sx={{ mb: 2, color: 'text.secondary' }}>
      {label}
    </Button>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <Box sx={{ display: 'flex', justifyContent: 'space-between', py: 0.5 }}>
      <Typography variant="body2" sx={{ color: 'text.secondary' }}>{label}</Typography>
      <Typography variant="body2" sx={{ fontWeight: 600 }}>{value}</Typography>
    </Box>
  )
}
