import { useEffect, useMemo, useState } from 'react'
import {
  Box, Typography, Button, TextField, Stack, Alert,
  CircularProgress, Avatar, Card,
} from '@mui/material'
import { DatePicker } from '@mui/x-date-pickers/DatePicker'
import { ArrowBackIosNew as ArrowBackIosNewIcon } from '@/components/icons'
import { SmsOutlined as SmsOutlinedIcon } from '@/components/icons'
import { CheckCircleOutlined as CheckCircleOutlineIcon } from '@/components/icons'
import { PhoneOutlined as PhoneOutlinedIcon } from '@/components/icons'
import { format } from 'date-fns'
import { ka } from 'date-fns/locale'
import { useTranslation } from 'react-i18next'
import { supabase } from '@/lib/supabase'
import {
  isValidGeorgianPhone, formatGeorgianPhone, isValidPersonName, FIELD_LIMITS,
} from '@/lib/validation'
import { computeRoomAvailability, nightsBetween } from '@/lib/hotelInventory'
import type { HotelRoomType, StayRow, RoomOption } from '@/lib/hotelInventory'
import type { BookingOrg } from './BookingLayout'

const GUEST_OPTIONS = [1, 2, 3, 4, 5, 6]

interface Props {
  org: BookingOrg
  accent?: string
}

const dateKey = (d: Date) => format(d, 'yyyy-MM-dd')

export default function HotelBooking({ org, accent }: Props) {
  const { t } = useTranslation()
  // When the hotel has online payment enabled, the full stay is prepaid; the
  // stay row is created by payment-webhook after the charge clears. Otherwise
  // it's pay-at-desk: insert a pending stay directly.
  const onlineEnabled = !!(org.payment_config?.bog?.enabled || org.payment_config?.tbc?.enabled)

  const [step, setStep] = useState(0)
  const [checkIn, setCheckIn] = useState<Date | null>(null)
  const [checkOut, setCheckOut] = useState<Date | null>(null)
  const [guests, setGuests] = useState(2)
  const [room, setRoom] = useState<RoomOption | null>(null)

  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [phone, setPhone] = useState('')
  const [notes, setNotes] = useState('')

  const [roomTypes, setRoomTypes] = useState<HotelRoomType[]>([])
  const [stays, setStays] = useState<StayRow[]>([])

  const [phase, setPhase] = useState<'form' | 'otp'>('form')
  const [code, setCode] = useState('')
  const [resendIn, setResendIn] = useState(0)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)

  // Load active room types once.
  useEffect(() => {
    async function load() {
      const { data } = await supabase
        .from('resources')
        .select('id, name, capacity, attrs')
        .eq('org_id', org.id)
        .eq('kind', 'room_type')
        .eq('is_active', true)
      const mapped: HotelRoomType[] = (data ?? []).map(r => {
        const attrs = (r.attrs ?? {}) as { nightly_price?: number; total_rooms?: number }
        return {
          id: r.id as string,
          name: r.name as string,
          capacity: r.capacity as number,
          totalRooms: Number(attrs.total_rooms ?? 0),
          nightlyPrice: Number(attrs.nightly_price ?? 0),
        }
      })
      setRoomTypes(mapped)
    }
    load()
  }, [org.id])

  // Load stays overlapping the chosen range (for availability) when entering step 1.
  useEffect(() => {
    if (step !== 1 || !checkIn || !checkOut) return
    async function loadStays() {
      const { data } = await supabase
        .from('hotel_stays')
        .select('room_type_id, check_in, check_out')
        .eq('org_id', org.id)
        .lt('check_in', dateKey(checkOut!))
        .gt('check_out', dateKey(checkIn!))
        .not('status', 'in', '(rejected,cancelled,no_show)')
      setStays((data ?? []) as StayRow[])
    }
    loadStays()
  }, [step, org.id, checkIn, checkOut])

  const nights = checkIn && checkOut ? nightsBetween(checkIn, checkOut) : 0

  const rooms = useMemo(() => {
    if (!checkIn || !checkOut || nights <= 0) return []
    return computeRoomAvailability({ checkIn, checkOut, guests, roomTypes, existing: stays })
  }, [checkIn, checkOut, guests, roomTypes, stays, nights])

  useEffect(() => {
    if (resendIn <= 0) return
    const id = setTimeout(() => setResendIn(s => s - 1), 1000)
    return () => clearTimeout(id)
  }, [resendIn])

  const datesValid = !!checkIn && !!checkOut && nights > 0

  const phoneInvalid = phone.trim().length > 0 && !isValidGeorgianPhone(phone)
  const firstNameTooShort = firstName.trim().length > 0 && firstName.trim().length < 2
  const firstNameInvalid = firstName.trim().length >= 2 && !isValidPersonName(firstName)
  const lastNameInvalid = lastName.trim().length > 0 && !isValidPersonName(lastName)
  const canBook =
    firstName.trim().length >= 2 && isValidPersonName(firstName) &&
    !lastNameInvalid && isValidGeorgianPhone(phone)

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

  async function verifyAndBook() {
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
    await book()
  }

  async function book() {
    if (!room || !checkIn || !checkOut) return
    setLoading(true); setError(null)
    try {
      // Online: hand off to the payment flow. The server recomputes the amount,
      // re-checks availability, parks the intent and (via the webhook) creates the
      // stay only once paid — so nothing is inserted here.
      if (onlineEnabled) {
        const { data: pay, error: payErr } = await supabase.functions.invoke('create-payment', {
          body: {
            purpose: 'stay',
            org_id: org.id,
            room_type_id: room.id,
            check_in: dateKey(checkIn),
            check_out: dateKey(checkOut),
            guests,
            first_name: firstName.trim(),
            last_name: lastName.trim() || null,
            phone,
            notes: notes.trim() || null,
            slug: org.slug,
            returnBaseUrl: window.location.origin,
          },
        })
        if (payErr || !pay?.checkoutUrl) {
          setError(t('booking.paymentStartFailed')); setLoading(false); return
        }
        window.location.assign(pay.checkoutUrl)
        return
      }

      // Re-check the room type still has a free room across the range.
      const { data: fresh } = await supabase
        .from('hotel_stays')
        .select('room_type_id, check_in, check_out')
        .eq('org_id', org.id)
        .lt('check_in', dateKey(checkOut))
        .gt('check_out', dateKey(checkIn))
        .not('status', 'in', '(rejected,cancelled,no_show)')

      const still = computeRoomAvailability({
        checkIn, checkOut, guests, roomTypes, existing: (fresh ?? []) as StayRow[],
      }).find(r => r.id === room.id)
      if (!still) { setError(t('hotel.roomTaken')); setLoading(false); return }

      const customerId = crypto.randomUUID()
      const { error: custErr } = await supabase.from('customers').insert({
        id: customerId,
        first_name: firstName.trim(),
        last_name: lastName.trim() || null,
        phone_number: formatGeorgianPhone(phone),
      })
      if (custErr) throw new Error(custErr.message)

      const { error: stayErr } = await supabase.from('hotel_stays').insert({
        org_id: org.id,
        customer_id: customerId,
        room_type_id: room.id,
        check_in: dateKey(checkIn),
        check_out: dateKey(checkOut),
        guests,
        nightly_rate: room.nightlyPrice,
        total_amount: room.total,
        status: 'pending',
        notes: notes.trim() || null,
      })
      if (stayErr) throw new Error(stayErr.message)

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

  if (done) {
    return (
      <Box sx={{ maxWidth: 460, mx: 'auto', textAlign: 'center', py: 6 }}>
        <CheckCircleOutlineIcon sx={{ fontSize: 64, color: 'success.main', mb: 2 }} />
        <Typography variant="h5" sx={{ fontWeight: 700, mb: 1 }}>{t('hotel.stayDone')}</Typography>
        <Typography variant="body2" sx={{ color: 'text.secondary', mb: 3 }}>{t('hotel.stayDoneCaption')}</Typography>
        <Box sx={{ bgcolor: 'background.paper', border: '1px solid', borderColor: 'divider', borderRadius: 3, p: 2.5, textAlign: 'left' }}>
          <Row label={t('hotel.room')} value={room?.name ?? ''} />
          <Row label={t('hotel.checkIn')} value={checkIn ? format(checkIn, 'd MMM yyyy', { locale: ka }) : ''} />
          <Row label={t('hotel.checkOut')} value={checkOut ? format(checkOut, 'd MMM yyyy', { locale: ka }) : ''} />
          <Row label={t('hotel.total')} value={`${room?.total ?? 0} ₾`} />
        </Box>
        {org.contact_phone && (
          <Typography variant="caption" sx={{ display: 'block', mt: 2, color: 'text.secondary' }}>{org.contact_phone}</Typography>
        )}
      </Box>
    )
  }

  return (
    <Box sx={{ maxWidth: 560, mx: 'auto', px: { xs: 2, md: 3 }, py: { xs: 3, md: 5 } }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 4 }}>
        <Avatar src={org.logo_url ?? undefined} sx={{ width: 48, height: 48, fontWeight: 700 }}>{org.name.charAt(0)}</Avatar>
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

      {error && step < 2 && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

      {/* Step 0 — dates + guests */}
      {step === 0 && (
        <Box>
          <Typography variant="h5" sx={{ fontWeight: 700, mb: 2, color: accent }}>{t('hotel.selectDates')}</Typography>
          <Stack spacing={2}>
            <DatePicker
              label={t('hotel.checkIn')}
              value={checkIn}
              minDate={new Date()}
              format="dd MMM yyyy"
              onChange={v => { setCheckIn(v); if (checkOut && v && checkOut <= v) setCheckOut(null) }}
              slotProps={{ textField: { fullWidth: true, required: true } }}
            />
            <DatePicker
              label={t('hotel.checkOut')}
              value={checkOut}
              minDate={checkIn ?? new Date()}
              format="dd MMM yyyy"
              onChange={v => setCheckOut(v)}
              slotProps={{ textField: { fullWidth: true, required: true } }}
            />
            <Box>
              <Typography variant="body2" sx={{ fontWeight: 600, mb: 1 }}>{t('hotel.guests')}</Typography>
              <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
                {GUEST_OPTIONS.map(n => (
                  <Button
                    key={n}
                    variant={guests === n ? 'contained' : 'outlined'}
                    onClick={() => setGuests(n)}
                    data-testid={`stay-guests-${n}`}
                    sx={{ minWidth: 52, height: 52, fontWeight: 700 }}
                  >
                    {n}
                  </Button>
                ))}
              </Box>
            </Box>
            {datesValid && (
              <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                {nights} {t('hotel.nights')}
              </Typography>
            )}
            <Button
              fullWidth variant="contained" size="large"
              disabled={!datesValid}
              onClick={() => setStep(1)}
              data-testid="stay-dates-next"
            >
              {t('common.next')}
            </Button>
          </Stack>
        </Box>
      )}

      {/* Step 1 — room type */}
      {step === 1 && (
        <Box>
          <BackButton onClick={() => setStep(0)} label={t('common.back')} />
          <Typography variant="h5" sx={{ fontWeight: 700, mb: 2, color: accent }}>{t('hotel.chooseRoom')}</Typography>
          {rooms.length === 0 ? (
            <Typography variant="body2" sx={{ color: 'text.secondary' }}>{t('hotel.noRoomsAvailable')}</Typography>
          ) : (
            <Stack spacing={1.5}>
              {rooms.map(r => (
                <Card
                  key={r.id}
                  data-testid="stay-room"
                  onClick={() => { setRoom(r); setStep(2) }}
                  sx={{ p: 2, cursor: 'pointer', border: '1px solid', borderColor: 'divider', '&:hover': { borderColor: 'primary.main' } }}
                >
                  <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                    <Box>
                      <Typography variant="body1" sx={{ fontWeight: 700 }}>{r.name}</Typography>
                      <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                        {r.capacity} {t('hotel.guests')} · {r.nightlyPrice} ₾ / {t('hotel.night')}
                      </Typography>
                    </Box>
                    <Box sx={{ textAlign: 'right' }}>
                      <Typography variant="h6" sx={{ fontWeight: 800 }}>{r.total} ₾</Typography>
                      <Typography variant="caption" sx={{ color: 'text.secondary' }}>{r.nights} {t('hotel.nights')}</Typography>
                    </Box>
                  </Box>
                </Card>
              ))}
            </Stack>
          )}
        </Box>
      )}

      {/* Step 2 — details + OTP */}
      {step === 2 && phase === 'form' && (
        <Box>
          <BackButton onClick={() => setStep(1)} label={t('common.back')} />
          <Typography variant="h5" sx={{ fontWeight: 700, mb: 0.5, color: accent }}>{t('hotel.detailsHeading')}</Typography>
          <Typography variant="body2" sx={{ color: 'text.secondary', mb: 3 }}>
            {room?.name} · {checkIn && format(checkIn, 'd MMM', { locale: ka })} – {checkOut && format(checkOut, 'd MMM', { locale: ka })} · {room?.total} ₾
          </Typography>
          {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
          <Stack spacing={2.25}>
            <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' }, gap: 1.5 }}>
              <TextField
                label={t('booking.firstName')} value={firstName} onChange={e => setFirstName(e.target.value)} required
                error={firstNameTooShort || firstNameInvalid}
                helperText={firstNameTooShort ? t('validation.minLength', { min: 2 }) : firstNameInvalid ? t('validation.lettersOnly') : undefined}
                slotProps={{ htmlInput: { maxLength: FIELD_LIMITS.personName, 'data-testid': 'stay-first-name' } }}
              />
              <TextField
                label={t('booking.lastName')} value={lastName} onChange={e => setLastName(e.target.value)}
                error={lastNameInvalid} helperText={lastNameInvalid ? t('validation.lettersOnly') : undefined}
                slotProps={{ htmlInput: { maxLength: FIELD_LIMITS.personName } }}
              />
            </Box>
            <TextField
              label={t('booking.phone')} value={phone} onChange={e => setPhone(e.target.value)} required placeholder="599 123 456"
              error={phoneInvalid} helperText={phoneInvalid ? t('validation.invalidPhone') : t('booking.smsHelper')}
              slotProps={{ htmlInput: { inputMode: 'tel', 'data-testid': 'stay-phone' } }}
            />
            <TextField
              label={t('booking.notes')} value={notes} onChange={e => setNotes(e.target.value)} multiline rows={2}
              slotProps={{ htmlInput: { maxLength: FIELD_LIMITS.notes } }}
            />
            <Button fullWidth variant="contained" size="large" onClick={sendCode} disabled={loading || !canBook} data-testid="stay-submit">
              {loading ? <CircularProgress size={22} color="inherit" /> : t(onlineEnabled ? 'booking.proceedToPayment' : 'hotel.book')}
            </Button>
          </Stack>
        </Box>
      )}

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
              required
              label={t('booking.otpLabel')} value={code}
              onChange={e => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
              fullWidth autoFocus placeholder="••••••"
              sx={{ '& input': { textAlign: 'center', fontSize: '1.6rem', letterSpacing: '0.5em', fontWeight: 700 } }}
              slotProps={{ htmlInput: { inputMode: 'numeric', maxLength: 6, 'data-testid': 'stay-otp-code' } }}
            />
            <Button fullWidth variant="contained" size="large" onClick={verifyAndBook} disabled={loading || code.length !== 6} data-testid="stay-otp-verify">
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
