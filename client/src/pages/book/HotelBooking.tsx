import { useEffect, useMemo, useState } from 'react'
import {
  Box, Typography, Button, TextField, Stack, Alert,
  CircularProgress, Card,
} from '@mui/material'
import { DatePicker } from '@mui/x-date-pickers/DatePicker'
import { ArrowBackIosNew as ArrowBackIosNewIcon } from '@/components/icons'
import { SmsOutlined as SmsOutlinedIcon } from '@/components/icons'
import { CheckCircleOutlined as CheckCircleOutlineIcon } from '@/components/icons'
import { HotelOutlined as HotelOutlinedIcon } from '@/components/icons'
import { CalendarMonthOutlined as CalendarMonthOutlinedIcon } from '@/components/icons'
import { format } from 'date-fns'
import { ka } from 'date-fns/locale'
import { useTranslation } from 'react-i18next'
import { supabase } from '@/lib/supabase'
import {
  isValidGeorgianPhone, formatGeorgianPhone, isValidPersonName, FIELD_LIMITS,
} from '@/lib/validation'
import { nightsBetween } from '@/lib/hotelInventory'
import { catalogImageUrl, catalogThumbUrl } from '@/lib/catalogImages'
import ImageCarousel from '@/components/ImageCarousel'
import { BookingTicket } from '@/components/ui'
import type { RoomOption } from '@/lib/hotelInventory'
import type { BookingTheme } from '@/theme/bookingThemes'
import type { BookingOrg } from './BookingLayout'
import BookingShell from './BookingShell'
import BookingSummaryCard from './BookingSummaryCard'
import BookingContactNote from './BookingContactNote'

const GUEST_OPTIONS = [1, 2, 3, 4, 5, 6]

/** One row from the get_room_availability RPC (per active room type). */
interface AvailRow {
  room_type_id: string
  name: string
  description: string | null
  capacity: number
  nightly_price: number
  total_rooms: number
  remaining: number
}

interface Props {
  org: BookingOrg
  /** The resolved booking theme (drives the shared shell + accents). */
  bookingTheme: BookingTheme
}

const dateKey = (d: Date) => format(d, 'yyyy-MM-dd')
/** Postgres `time` comes back as "HH:mm:ss"; show "HH:mm". */
const hhmm = (t?: string | null) => (t ? t.slice(0, 5) : '')

export default function HotelBooking({ org, bookingTheme }: Props) {
  const { t } = useTranslation()
  const accent = bookingTheme.deep
  // When the hotel has online payment enabled, the full stay is prepaid; the
  // stay row is created by payment-webhook after the charge clears. Otherwise
  // it's pay-at-desk: insert a pending stay directly.
  const onlineEnabled = !!(org.payment_config?.bog?.enabled || org.payment_config?.tbc?.enabled)

  const [step, setStep] = useState(0)
  const [direction, setDirection] = useState(1)
  const goToStep = (n: number) => { setDirection(n >= step ? 1 : -1); setStep(n) }
  const [checkIn, setCheckIn] = useState<Date | null>(null)
  const [checkOut, setCheckOut] = useState<Date | null>(null)
  const [guests, setGuests] = useState(2)
  const [room, setRoom] = useState<RoomOption | null>(null)

  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [phone, setPhone] = useState('')
  const [notes, setNotes] = useState('')

  // Per-room-type availability for the chosen range, from the server RPC (anon
  // never reads raw stay rows). Loaded when entering step 1.
  const [avail, setAvail] = useState<AvailRow[]>([])
  // resource_id → ordered full-size photo URLs (primary first); property gallery.
  const [roomImages, setRoomImages] = useState<Record<string, string[]>>({})
  const [roomThumbs, setRoomThumbs] = useState<Record<string, string>>({})
  const [propertyImages, setPropertyImages] = useState<string[]>([])
  const [carousel, setCarousel] = useState<{ urls: string[]; index: number } | null>(null)

  const [phase, setPhase] = useState<'form' | 'otp'>('form')
  const [code, setCode] = useState('')
  const [resendIn, setResendIn] = useState(0)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)
  const [stayId, setStayId] = useState<string | null>(null)

  // Load room + property photos once (availability comes from the RPC per range).
  useEffect(() => {
    async function load() {
      // Room photos (primary first) — public SELECT, same as resources.
      const { data: imgs } = await supabase
        .from('resource_images')
        .select('resource_id, storage_path, is_primary, sort_order')
        .eq('org_id', org.id)
        .order('is_primary', { ascending: false })
        .order('sort_order', { ascending: true })
      const byRoom: Record<string, string[]> = {}
      const thumbs: Record<string, string> = {}
      for (const im of (imgs ?? []) as { resource_id: string; storage_path: string }[]) {
        ;(byRoom[im.resource_id] ??= []).push(catalogImageUrl(im.storage_path))
        if (!thumbs[im.resource_id]) thumbs[im.resource_id] = catalogThumbUrl(im.storage_path)
      }
      setRoomImages(byRoom)
      setRoomThumbs(thumbs)

      // Property gallery.
      const { data: gallery } = await supabase
        .from('org_images')
        .select('storage_path, is_primary, sort_order')
        .eq('org_id', org.id)
        .order('is_primary', { ascending: false })
        .order('sort_order', { ascending: true })
      setPropertyImages((gallery ?? []).map((g: { storage_path: string }) => catalogImageUrl(g.storage_path)))
    }
    load()
  }, [org.id])

  // Server-side availability for the chosen range when entering step 1. The RPC
  // returns per-room-type `remaining` without exposing other guests' stay rows.
  useEffect(() => {
    if (step !== 1 || !checkIn || !checkOut) return
    async function loadAvailability() {
      const { data } = await supabase.rpc('get_room_availability', {
        p_org_id: org.id,
        p_check_in: dateKey(checkIn!),
        p_check_out: dateKey(checkOut!),
      })
      setAvail((data ?? []) as AvailRow[])
    }
    loadAvailability()
  }, [step, org.id, checkIn, checkOut])

  const nights = checkIn && checkOut ? nightsBetween(checkIn, checkOut) : 0

  // Bookable room types: fit the party and have a free room every night.
  const rooms = useMemo<RoomOption[]>(() => {
    if (!checkIn || !checkOut || nights <= 0) return []
    return avail
      .filter(a => Number(a.capacity) >= guests && Number(a.remaining) > 0)
      .map(a => {
        const nightlyPrice = Number(a.nightly_price)
        return {
          id: a.room_type_id,
          name: a.name,
          description: a.description,
          capacity: Number(a.capacity),
          nights,
          nightlyPrice,
          total: nights * nightlyPrice,
          remaining: Number(a.remaining),
        }
      })
  }, [avail, guests, nights, checkIn, checkOut])

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

      // Re-check availability via the RPC for a fast, friendly message. The
      // enforce_hotel_inventory trigger is the authoritative guard against the
      // last-room race and is handled below if this check passes but loses.
      const { data: fresh } = await supabase.rpc('get_room_availability', {
        p_org_id: org.id,
        p_check_in: dateKey(checkIn),
        p_check_out: dateKey(checkOut),
      })
      const still = ((fresh ?? []) as AvailRow[]).find(r => r.room_type_id === room.id && Number(r.remaining) > 0)
      if (!still) { setError(t('hotel.roomTaken')); setLoading(false); return }

      const customerId = crypto.randomUUID()
      const { error: custErr } = await supabase.from('customers').insert({
        id: customerId,
        first_name: firstName.trim(),
        last_name: lastName.trim() || null,
        phone_number: formatGeorgianPhone(phone),
      })
      if (custErr) throw new Error(custErr.message)

      const { data: stayRow, error: stayErr } = await supabase.from('hotel_stays').insert({
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
      }).select('id').single()
      if (stayErr) throw new Error(stayErr.message)

      setStayId(stayRow?.id ?? null)
      setDone(true)
    } catch (err) {
      const msg = err instanceof Error ? err.message : ''
      if (msg.includes('verification_required')) {
        setError(t('booking.otpExpired')); setCode(''); setPhase('form')
      } else if (msg.includes('room_unavailable')) {
        // Lost the last-room race at write time (trigger rejected the insert).
        setError(t('hotel.roomTaken'))
      } else {
        setError(msg || t('booking.bookFailed'))
      }
      setLoading(false)
    }
  }

  // ── Done view — the shared tear-off ticket (matches appointments). ──
  if (done) {
    return (
      <Box sx={{ minHeight: '100vh', bgcolor: bookingTheme.pageBg, display: 'flex', alignItems: 'center', justifyContent: 'center', p: 2 }}>
        <Box sx={{ maxWidth: 420, width: '100%', textAlign: 'center' }}>
          <CheckCircleOutlineIcon sx={{ fontSize: 64, color: 'success.main', mb: 2 }} />
          <Typography variant="h5" sx={{ fontWeight: 700, mb: 1 }}>{t('hotel.stayDone')}</Typography>
          <Typography variant="body2" sx={{ color: 'text.secondary', mb: 3 }}>{t('hotel.stayDoneCaption')}</Typography>
          <BookingTicket
            notchColor={bookingTheme.pageBg}
            priceColor={accent}
            priceLabel={t('hotel.total')}
            price={`${room?.total ?? 0} ₾`}
            rows={[
              { icon: <HotelOutlinedIcon sx={{ fontSize: 18 }} />, label: t('hotel.room'), value: room?.name ?? '' },
              { icon: <CalendarMonthOutlinedIcon sx={{ fontSize: 18 }} />, label: t('hotel.checkIn'), value: checkIn ? format(checkIn, 'd MMM yyyy', { locale: ka }) : '' },
              { icon: <CalendarMonthOutlinedIcon sx={{ fontSize: 18 }} />, label: t('hotel.checkOut'), value: checkOut ? format(checkOut, 'd MMM yyyy', { locale: ka }) : '' },
            ]}
          />
          {stayId && (
            <Button
              variant="text"
              onClick={() => window.location.assign(`/stay/${stayId}`)}
              sx={{ mt: 1 }}
              data-testid="stay-manage-link"
            >
              {t('stay.manageLink')}
            </Button>
          )}
          <BookingContactNote phone={org.contact_phone} />
        </Box>
      </Box>
    )
  }

  const stepTitles = [t('hotel.selectDates'), t('hotel.chooseRoom'), t('hotel.detailsHeading')]

  const summary = datesValid ? (
    <BookingSummaryCard
      label={t('booking.yourBooking')}
      labelColor={bookingTheme.sidebarText === 'dark' ? '#1F2937' : '#FFFFFF'}
      notchColor={bookingTheme.sidebar}
      priceColor={accent}
      totalLabel={t('hotel.total')}
      total={room ? `${room.total} ₾` : undefined}
      rows={[
        ...(room ? [{ icon: <HotelOutlinedIcon sx={{ fontSize: 18 }} />, primary: room.name }] : []),
        {
          icon: <CalendarMonthOutlinedIcon sx={{ fontSize: 18 }} />,
          primary: `${checkIn && format(checkIn, 'd MMM', { locale: ka })} – ${checkOut && format(checkOut, 'd MMM', { locale: ka })}`,
          secondary: `${nights} ${t('hotel.nights')}`,
        },
      ]}
    />
  ) : undefined

  const mobileAside = room
    ? <Typography variant="subtitle1" sx={{ fontWeight: 800 }}>{room.total} ₾</Typography>
    : undefined

  return (
    <BookingShell
      org={org}
      bookingTheme={bookingTheme}
      step={step}
      direction={direction}
      stepTitles={stepTitles}
      summary={summary}
      mobileAside={mobileAside}
    >
      {error && step < 2 && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

      {/* Step 0 — dates + guests */}
      {step === 0 && (
        <Box>
          {propertyImages.length > 0 && (
            <Box sx={{ display: 'flex', gap: 1, mb: 2.5, overflowX: 'auto', pb: 0.5 }}>
              {propertyImages.map((url, i) => (
                <Box
                  key={i}
                  component="img"
                  src={url}
                  alt=""
                  loading="lazy"
                  onClick={() => setCarousel({ urls: propertyImages, index: i })}
                  sx={{
                    width: i === 0 ? 220 : 120, height: 140, flexShrink: 0, objectFit: 'cover',
                    borderRadius: 2, cursor: 'pointer',
                  }}
                />
              ))}
            </Box>
          )}
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
            {(org.check_in_time || org.check_out_time) && (
              <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                {org.check_in_time && t('hotel.checkInFrom', { time: hhmm(org.check_in_time) })}
                {org.check_in_time && org.check_out_time && ' · '}
                {org.check_out_time && t('hotel.checkOutUntil', { time: hhmm(org.check_out_time) })}
              </Typography>
            )}
            <Button
              fullWidth variant="contained" size="large"
              disabled={!datesValid}
              onClick={() => goToStep(1)}
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
          <BackButton onClick={() => goToStep(0)} label={t('common.back')} />
          <Typography variant="h5" sx={{ fontWeight: 700, mb: 2, color: accent }}>{t('hotel.chooseRoom')}</Typography>
          {rooms.length === 0 ? (
            <Typography variant="body2" sx={{ color: 'text.secondary' }}>{t('hotel.noRoomsAvailable')}</Typography>
          ) : (
            <Stack spacing={1.5}>
              {rooms.map(r => (
                <Card
                  key={r.id}
                  data-testid="stay-room"
                  onClick={() => { setRoom(r); goToStep(2) }}
                  sx={{ p: 2, cursor: 'pointer', border: '1px solid', borderColor: 'divider', '&:hover': { borderColor: 'primary.main' } }}
                >
                  <Box sx={{ display: 'flex', gap: 1.5, alignItems: 'flex-start' }}>
                    {roomThumbs[r.id] && (
                      <Box
                        component="img"
                        src={roomThumbs[r.id]}
                        alt={r.name}
                        loading="lazy"
                        onClick={e => { e.stopPropagation(); setCarousel({ urls: roomImages[r.id] ?? [], index: 0 }) }}
                        sx={{ width: 84, height: 84, borderRadius: 1.5, objectFit: 'cover', flexShrink: 0 }}
                      />
                    )}
                    <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flex: 1 }}>
                      <Box>
                        <Typography variant="body1" sx={{ fontWeight: 700 }}>{r.name}</Typography>
                        <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block' }}>
                          {r.capacity} {t('hotel.guests')} · {r.nightlyPrice} ₾ / {t('hotel.night')}
                        </Typography>
                        {r.description && (
                          <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block', mt: 0.5 }}>
                            {r.description}
                          </Typography>
                        )}
                      </Box>
                      <Box sx={{ textAlign: 'right' }}>
                        <Typography variant="h6" sx={{ fontWeight: 800 }}>{r.total} ₾</Typography>
                        <Typography variant="caption" sx={{ color: 'text.secondary' }}>{r.nights} {t('hotel.nights')}</Typography>
                      </Box>
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
          <BackButton onClick={() => goToStep(1)} label={t('common.back')} />
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

      <ImageCarousel
        open={!!carousel}
        urls={carousel?.urls ?? []}
        startIndex={carousel?.index ?? 0}
        onClose={() => setCarousel(null)}
      />
    </BookingShell>
  )
}

function BackButton({ onClick, label }: { onClick: () => void; label: string }) {
  return (
    <Button startIcon={<ArrowBackIosNewIcon sx={{ fontSize: 14 }} />} onClick={onClick} size="small" sx={{ mb: 2, color: 'text.secondary' }}>
      {label}
    </Button>
  )
}
