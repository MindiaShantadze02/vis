import { useEffect, useState } from 'react'
import { useParams, useNavigate, useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { format } from 'date-fns'
import { SUPPORTED_LANGUAGES } from '@/lib/i18n'
import { dateLocale } from '@/lib/dateLocale'
import { inIframe } from './useEmbedBridge'
import { Box, Typography } from '@mui/material'
import { ThemeProvider } from '@mui/material/styles'
import { SearchOffOutlined as SearchOffOutlinedIcon } from '@/components/icons'
import { EventBusyOutlined as EventBusyOutlinedIcon } from '@/components/icons'
import { CalendarMonthOutlined as CalendarMonthOutlinedIcon } from '@/components/icons'
import { AccessTimeOutlined as AccessTimeOutlinedIcon } from '@/components/icons'
import { supabase } from '@/lib/supabase'
import { getBookingTheme, makeBookingTheme } from '@/theme/bookingThemes'
import { LoadingState, EmptyState } from '@/components/ui'
import BookingShell from './BookingShell'
import BookingSummaryCard from './BookingSummaryCard'
import ServiceGallery from './ServiceGallery'
import Step1ServiceSelect from './Step1ServiceSelect'
import Step2DateTimeSelect from './Step2DateTimeSelect'
import Step3CustomerForm from './Step3CustomerForm'

export interface BookingOrg {
  id: string
  name: string
  description: string | null
  contact_phone: string | null
  logo_url: string | null
  slug: string
  payment_config: Record<string, { enabled?: boolean }> | null
  booking_theme: string | null
  reviews_enabled: boolean
  review_avg: number | null
  review_count: number
}

// Shape returned by the get_public_org RPC (secrets stripped server-side).
interface PublicOrg {
  id: string
  name: string
  description: string | null
  contact_phone: string | null
  logo_url: string | null
  slug: string
  booking_theme: string | null
  payment_methods: Record<string, { enabled?: boolean }> | null
  reviews_enabled: boolean
  review_avg: number | null
  review_count: number
}

export interface BookingService {
  id: string
  name: string
  duration_minutes: number
  price: number
  max_per_slot: number
  // Gallery image URLs in display order; shown in the sidebar once selected.
  images: string[]
}

export interface BookingStaff {
  id: string
  display_name: string | null
  title: string | null
  sort_order: number
  avatar_url: string | null
}

export interface BookingState {
  service: BookingService | null
  date: string        // yyyy-MM-dd
  time: string        // HH:mm
  staffId: string | null      // chosen specific member, or null = "Any available"
  assignedStaff: BookingStaff[] // bookable members assigned to the chosen service
  firstName: string
  lastName: string
  phone: string
  notes: string
  paymentMethod: 'online' | 'in_person'
}

const DEFAULT_BOOKING: BookingState = {
  service: null, date: '', time: '',
  staffId: null, assignedStaff: [],
  firstName: '', lastName: '', phone: '', notes: '',
  paymentMethod: 'in_person',
}

// In-progress booking is kept in sessionStorage (per tab, per business) so an
// accidental refresh — or returning from the payment gateway redirect — restores
// the customer's place instead of dumping them back at step 1.
const storageKey = (slug: string) => `vis_booking_${slug}`

interface PersistedBooking { booking: BookingState; step: number }

function loadPersisted(slug: string | undefined): PersistedBooking | null {
  if (!slug) return null
  try {
    const raw = sessionStorage.getItem(storageKey(slug))
    return raw ? (JSON.parse(raw) as PersistedBooking) : null
  } catch {
    return null
  }
}

export default function BookingLayout() {
  const { slug } = useParams<{ slug: string }>()
  const navigate = useNavigate()
  const { t, i18n } = useTranslation()
  const [searchParams] = useSearchParams()

  // Render the bare/chromeless layout when the embedder opts in (?embed=1) or
  // whenever we're inside any iframe.
  const embed = searchParams.get('embed') === '1' || inIframe

  // Let an embed pin the language via ?lang= (e.g. ?embed=1&lang=en). Standalone
  // visitors get a language switcher instead (rendered in BookingShell).
  useEffect(() => {
    const lang = searchParams.get('lang')
    if (lang && SUPPORTED_LANGUAGES.some(l => l.code === lang) && i18n.resolvedLanguage !== lang) {
      void i18n.changeLanguage(lang)
    }
  }, [searchParams, i18n])

  const [org, setOrg] = useState<BookingOrg | null>(null)
  const [notFound, setNotFound] = useState(false)
  const [atCapacity, setAtCapacity] = useState(false)
  const [booking, setBooking] = useState<BookingState>(() => {
    const p = loadPersisted(slug)
    return p ? { ...DEFAULT_BOOKING, ...p.booking } : DEFAULT_BOOKING
  })
  const [step, setStep] = useState<number>(() => {
    const p = loadPersisted(slug)
    // Only resume past step 1 if a service was actually chosen — otherwise a
    // stale/partial entry would land them on an empty date or details step.
    return p && p.booking.service ? p.step : 0
  })
  // +1 forward / -1 back, so the step slide animates in the travelled direction.
  const [direction, setDirection] = useState(1)
  const goToStep = (next: number) => {
    setDirection(next >= step ? 1 : -1)
    setStep(next)
  }

  // Persist on every change so a refresh mid-flow loses nothing.
  useEffect(() => {
    if (!slug) return
    try {
      sessionStorage.setItem(storageKey(slug), JSON.stringify({ booking, step }))
    } catch {
      /* ignore quota / serialization errors — persistence is best-effort */
    }
  }, [slug, booking, step])

  useEffect(() => {
    async function loadOrg() {
      // Read via get_public_org (SECURITY DEFINER): returns only public booking
      // fields plus a derived payment_methods map of {provider: {enabled}} — the
      // organisations table no longer exposes payment_config/owner_id to anon.
      const { data, error } = await supabase
        .rpc('get_public_org', { p_slug: slug })
        .maybeSingle()
      const pub = data as PublicOrg | null
      if (error || !pub) { console.error('org load error', error); setNotFound(true); return }

      // Block the whole flow up front if the business is at its monthly tier
      // limit — same derived usage the dashboard enforces against. A guest
      // can't upgrade, so we just show a friendly unavailable state rather
      // than letting them fill the form and fail on insert.
      const { data: canAccept } = await supabase
        .rpc('org_can_accept_appointment', { p_org_id: pub.id })
      if (canAccept === false) { setAtCapacity(true); return }

      // The steps read org.payment_config[provider].enabled; the RPC delivers the
      // same shape under payment_methods (secrets stripped), so map it across.
      setOrg({
        id: pub.id,
        name: pub.name,
        description: pub.description,
        contact_phone: pub.contact_phone,
        logo_url: pub.logo_url,
        slug: pub.slug,
        booking_theme: pub.booking_theme,
        payment_config: pub.payment_methods,
        reviews_enabled: pub.reviews_enabled,
        // PostgREST returns numeric as a string; coerce for display/math.
        review_avg: pub.review_avg != null ? Number(pub.review_avg) : null,
        review_count: Number(pub.review_count ?? 0),
      })
    }
    if (slug) loadOrg()
  }, [slug])

  function patch(p: Partial<BookingState>) {
    setBooking(prev => ({ ...prev, ...p }))
  }

  if (notFound) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh' }}>
        <EmptyState
          icon={<SearchOffOutlinedIcon />}
          title="ბიზნესი ვერ მოიძებნა"
          caption="შეამოწმეთ ბმული და სცადეთ თავიდან"
        />
      </Box>
    )
  }

  if (atCapacity) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh' }}>
        <EmptyState
          icon={<EventBusyOutlinedIcon />}
          title={t('booking.unavailable')}
          caption={t('booking.unavailableCaption')}
        />
      </Box>
    )
  }

  if (!org) {
    // The org (and therefore its booking theme) isn't loaded yet, so we can't
    // colour this spinner with the org's accent. Render it neutral grey rather
    // than let it inherit the base app accent.
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh', color: 'text.secondary' }}>
        <LoadingState color="inherit" />
      </Box>
    )
  }

  const bookingTheme = getBookingTheme(org.booking_theme)

  const stepTitles = [t('booking.progressService'), t('booking.progressTime'), t('booking.progressDetails')]
  // Resolved staff line for the summary, once a slot is chosen.
  const sideStaffLabel = booking.assignedStaff.length > 0 && booking.date && booking.time
    ? (booking.staffId
        ? (booking.assignedStaff.find(m => m.id === booking.staffId)?.display_name || '—')
        : t('booking.anyAvailable'))
    : null

  // Live "your booking" summary — a white ticket filled in as the customer
  // progresses, echoing the confirmation-page stub. The selected service's
  // photo gallery renders beneath it (same overlay tokens as BookingShell).
  const sideFg = bookingTheme.sidebarText === 'dark' ? '#1F2937' : '#FFFFFF'
  const sideOverlay = (a: number) =>
    `rgba(${bookingTheme.sidebarText === 'dark' ? '0,0,0' : '255,255,255'},${a})`
  const summary = booking.service ? (
    <>
    <BookingSummaryCard
      label={t('booking.yourBooking')}
      labelColor={sideFg}
      notchColor={bookingTheme.sidebar}
      priceColor={bookingTheme.deep}
      totalLabel={t('booking.total')}
      total={`${booking.service.price} ₾`}
      rows={[
        {
          icon: <CalendarMonthOutlinedIcon sx={{ fontSize: 18 }} />,
          primary: booking.service.name,
        },
        ...(booking.date && booking.time ? [{
          icon: <AccessTimeOutlinedIcon sx={{ fontSize: 18 }} />,
          // booking.date is the raw yyyy-MM-dd key — render it like the rest
          // of the flow ("6 Jul · 14:00"), in the active language.
          primary: `${format(new Date(`${booking.date}T00:00:00`), 'd MMM', { locale: dateLocale() })} · ${booking.time}`,
          secondary: sideStaffLabel ?? undefined,
        }] : []),
      ]}
    />
    {/* Photos only accompany the steps *after* choosing a service — going back
        to the service list keeps booking.service (so the ticket persists), but
        the previous choice's photos next to a fresh list read as stale. */}
    {step > 0 && (
      <ServiceGallery
        // `?? []` guards drafts persisted before services carried images.
        images={booking.service.images ?? []}
        serviceName={booking.service.name}
        fg={sideFg}
        overlay={sideOverlay}
      />
    )}
    </>
  ) : undefined

  const mobileAside = booking.service
    ? <Typography variant="subtitle1" sx={{ fontWeight: 800 }}>{booking.service.price} ₾</Typography>
    : undefined

  return (
    <ThemeProvider theme={makeBookingTheme(bookingTheme)}>
      <BookingShell
        org={org}
        bookingTheme={bookingTheme}
        step={step}
        direction={direction}
        stepTitles={stepTitles}
        summary={summary}
        mobileAside={mobileAside}
        embed={embed}
      >
        {step === 0 && (
          <Step1ServiceSelect
            orgId={org.id}
            onSelect={service => { patch({ service }); goToStep(1) }}
          />
        )}
        {step === 1 && (
          <Step2DateTimeSelect
            orgId={org.id}
            service={booking.service!}
            initialDate={booking.date}
            initialStaffId={booking.staffId}
            onSelect={(date, time, staffId, assignedStaff) => {
              patch({ date, time, staffId, assignedStaff }); goToStep(2)
            }}
            onBack={() => goToStep(0)}
          />
        )}
        {step === 2 && (
          <Step3CustomerForm
            org={org}
            booking={booking}
            priceColor={bookingTheme.deep}
            embed={embed}
            onChange={patch}
            onBack={() => goToStep(1)}
            onDone={(appointmentId) => {
              // Booking is done — drop the saved draft so a later visit starts fresh.
              if (slug) { try { sessionStorage.removeItem(storageKey(slug)) } catch { /* ignore */ } }
              navigate(`/booking-confirmation/${appointmentId}`)
            }}
          />
        )}
      </BookingShell>
    </ThemeProvider>
  )
}
