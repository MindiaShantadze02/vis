import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import {
  Box, Typography, Avatar, Stepper,
  Step, StepLabel, useMediaQuery, useTheme, Divider,
} from '@mui/material'
import { ThemeProvider } from '@mui/material/styles'
import { AnimatePresence, motion } from 'framer-motion'
import SearchOffOutlinedIcon from '@mui/icons-material/SearchOffOutlined'
import EventBusyOutlinedIcon from '@mui/icons-material/EventBusyOutlined'
import CalendarMonthOutlinedIcon from '@mui/icons-material/CalendarMonthOutlined'
import AccessTimeOutlinedIcon from '@mui/icons-material/AccessTimeOutlined'
import PhoneOutlinedIcon from '@mui/icons-material/PhoneOutlined'
import { supabase } from '@/lib/supabase'
import { anim } from '@/theme/animations'
import { stepVariants } from '@/theme/motion'
import { LAYOUT } from '@/theme/theme'
import { getBookingTheme, makeBookingTheme } from '@/theme/bookingThemes'
import { LoadingState, EmptyState } from '@/components/ui'
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
}

export interface BookingService {
  id: string
  name: string
  duration_minutes: number
  price: number
  max_per_slot: number
}

export interface BookingStaff {
  id: string
  display_name: string | null
  title: string | null
  sort_order: number
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

const STEPS = ['სერვისი', 'თარიღი და დრო', 'დეტალები']

const DEFAULT_BOOKING: BookingState = {
  service: null, date: '', time: '',
  staffId: null, assignedStaff: [],
  firstName: '', lastName: '', phone: '', notes: '',
  paymentMethod: 'in_person',
}

// In-progress booking is kept in sessionStorage (per tab, per business) so an
// accidental refresh — or returning from the payment gateway redirect — restores
// the customer's place instead of dumping them back at step 1.
const storageKey = (slug: string) => `grafiki_booking_${slug}`

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
  const { t } = useTranslation()
  const theme = useTheme()
  const isMobile = useMediaQuery(theme.breakpoints.down('md'))

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
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh' }}>
        <LoadingState />
      </Box>
    )
  }

  const bookingTheme = getBookingTheme(org.booking_theme)
  // Light vs. dark sidebar content (the white theme uses a light panel, so its
  // text/overlays must flip to dark to stay legible).
  const darkSidebar = bookingTheme.sidebarText === 'dark'
  const sideFg = darkSidebar ? '#1F2937' : '#FFFFFF'
  const sideOverlay = (a: number) => `rgba(${darkSidebar ? '0,0,0' : '255,255,255'},${a})`
  // Flat panels, no gradients/blobs. The light "minimal" theme needs a hairline
  // border to separate its near-white sidebar from the white content; the rich
  // colour panels separate by colour alone.
  const flatSidebar = darkSidebar

  const sidebar = (
    <Box
      sx={{
        width: { xs: '100%', md: 300 },
        background: bookingTheme.sidebar,
        color: sideFg,
        p: 4,
        display: 'flex',
        flexDirection: 'column',
        gap: 2,
        flexShrink: 0,
        position: 'relative',
        overflow: 'hidden',
        // Hairline separation only for the light "minimal" panel; colour panels
        // separate from the white content on their own.
        ...(flatSidebar && {
          borderRight: { md: '1px solid #E5E7EB' },
          borderBottom: { xs: '1px solid #E5E7EB', md: 'none' },
        }),
      }}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, position: 'relative' }}>
        <Avatar
          src={org.logo_url ?? undefined}
          sx={{
            width: 56, height: 56,
            background: sideOverlay(darkSidebar ? 0.06 : 0.15),
            color: sideFg,
            fontSize: 22, fontWeight: 700,
            border: flatSidebar ? '1px solid #E5E7EB' : `2px solid ${sideOverlay(0.30)}`,
            boxShadow: flatSidebar ? '0 1px 3px rgba(0,0,0,0.06)' : '0 4px 16px rgba(0,0,0,0.20)',
          }}
        >
          {org.name.charAt(0)}
        </Avatar>
        <Box>
          <Typography variant="h6" sx={{ fontWeight: 700, color: sideFg }}>{org.name}</Typography>
          {org.contact_phone && (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mt: 0.25 }}>
              <PhoneOutlinedIcon sx={{ fontSize: 14, opacity: 0.8 }} />
              <Typography variant="caption" sx={{ opacity: 0.8 }}>{org.contact_phone}</Typography>
            </Box>
          )}
        </Box>
      </Box>

      {org.description && (
        <>
          <Divider sx={{ borderColor: sideOverlay(0.15) }} />
          <Typography variant="body2" sx={{ opacity: 0.85, lineHeight: 1.65, position: 'relative' }}>
            {org.description}
          </Typography>
        </>
      )}

      {/* Selected booking summary */}
      {booking.service && (
        <Box sx={{ animation: anim.fadeInUp, position: 'relative' }}>
          <Divider sx={{ borderColor: sideOverlay(0.15), mb: 2 }} />
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <CalendarMonthOutlinedIcon sx={{ fontSize: 16, opacity: 0.8 }} />
              <Typography variant="body2" sx={{ opacity: 0.9 }}>{booking.service.name}</Typography>
            </Box>
            {booking.date && booking.time && (
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <AccessTimeOutlinedIcon sx={{ fontSize: 16, opacity: 0.8 }} />
                <Typography variant="body2" sx={{ opacity: 0.9 }}>
                  {booking.date} · {booking.time}
                </Typography>
              </Box>
            )}
            <Typography variant="h6" sx={{ fontWeight: 700, mt: 0.5 }}>
              {booking.service.price} ₾
            </Typography>
          </Box>
        </Box>
      )}
    </Box>
  )

  return (
    <ThemeProvider theme={makeBookingTheme(bookingTheme)}>
    <Box sx={{ display: 'flex', flexDirection: { xs: 'column', md: 'row' }, minHeight: '100vh' }}>
      {sidebar}

      <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', bgcolor: bookingTheme.pageBg }}>
        {/* Stepper header */}
        <Box sx={{ bgcolor: 'background.paper', px: { xs: 2, md: 5 }, py: 3, borderBottom: '1px solid', borderColor: 'divider' }}>
          <Stepper activeStep={step} alternativeLabel={isMobile}>
            {STEPS.map((label, i) => (
              <Step key={i}>
                <StepLabel>{label}</StepLabel>
              </Step>
            ))}
          </Stepper>
        </Box>

        {/* Step content — slides in the travelled direction on step change. */}
        <Box sx={{ flex: 1, position: 'relative', overflowX: 'hidden' }}>
          <AnimatePresence mode="wait" custom={direction} initial={false}>
            <Box
              component={motion.div}
              key={step}
              custom={direction}
              variants={stepVariants}
              initial="enter"
              animate="center"
              exit="exit"
              sx={{ px: { xs: 2, md: 5 }, py: 4, maxWidth: LAYOUT.bookingStep, width: '100%' }}
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
                  onChange={patch}
                  onBack={() => goToStep(1)}
                  onDone={(appointmentId) => {
                    // Booking is done — drop the saved draft so a later visit starts fresh.
                    if (slug) { try { sessionStorage.removeItem(storageKey(slug)) } catch { /* ignore */ } }
                    navigate(`/booking-confirmation/${appointmentId}`)
                  }}
                />
              )}
            </Box>
          </AnimatePresence>
        </Box>
      </Box>
    </Box>
    </ThemeProvider>
  )
}
