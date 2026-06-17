import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import {
  Box, Typography, Avatar, Stepper,
  Step, StepLabel, useMediaQuery, useTheme, Divider,
} from '@mui/material'
import { ThemeProvider } from '@mui/material/styles'
import SearchOffOutlinedIcon from '@mui/icons-material/SearchOffOutlined'
import CalendarMonthOutlinedIcon from '@mui/icons-material/CalendarMonthOutlined'
import AccessTimeOutlinedIcon from '@mui/icons-material/AccessTimeOutlined'
import PhoneOutlinedIcon from '@mui/icons-material/PhoneOutlined'
import { supabase } from '@/lib/supabase'
import { anim } from '@/theme/animations'
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

export default function BookingLayout() {
  const { slug } = useParams<{ slug: string }>()
  const navigate = useNavigate()
  const theme = useTheme()
  const isMobile = useMediaQuery(theme.breakpoints.down('md'))

  const [org, setOrg] = useState<BookingOrg | null>(null)
  const [notFound, setNotFound] = useState(false)
  const [step, setStep] = useState(0)
  const [booking, setBooking] = useState<BookingState>({
    service: null, date: '', time: '',
    staffId: null, assignedStaff: [],
    firstName: '', lastName: '', phone: '', notes: '',
    paymentMethod: 'in_person',
  })

  useEffect(() => {
    async function loadOrg() {
      const { data, error } = await supabase
        .from('organisations')
        .select('id, name, description, contact_phone, logo_url, slug, payment_config, booking_theme')
        .eq('slug', slug)
        .single()
      if (error || !data) { console.error('org load error', error); setNotFound(true); return }
      setOrg(data as BookingOrg)
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
        '&::before': {
          content: '""',
          position: 'absolute',
          top: -60, right: -60,
          width: 200, height: 200,
          borderRadius: '50%',
          background: `radial-gradient(circle, ${sideOverlay(0.18)} 0%, transparent 70%)`,
          pointerEvents: 'none',
        },
        '&::after': {
          content: '""',
          position: 'absolute',
          bottom: -40, left: -40,
          width: 160, height: 160,
          borderRadius: '50%',
          background: `radial-gradient(circle, ${sideOverlay(0.10)} 0%, transparent 70%)`,
          pointerEvents: 'none',
        },
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
            border: `2px solid ${sideOverlay(0.30)}`,
            boxShadow: '0 4px 16px rgba(0,0,0,0.20)',
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

        {/* Step content — key re-mounts on step change, re-firing animation */}
        <Box key={step} sx={{ flex: 1, px: { xs: 2, md: 5 }, py: 4, maxWidth: LAYOUT.bookingStep, width: '100%', animation: anim.fadeInUp }}>
          {step === 0 && (
            <Step1ServiceSelect
              orgId={org.id}
              onSelect={service => { patch({ service }); setStep(1) }}
            />
          )}
          {step === 1 && (
            <Step2DateTimeSelect
              orgId={org.id}
              service={booking.service!}
              initialDate={booking.date}
              initialStaffId={booking.staffId}
              onSelect={(date, time, staffId, assignedStaff) => {
                patch({ date, time, staffId, assignedStaff }); setStep(2)
              }}
              onBack={() => setStep(0)}
            />
          )}
          {step === 2 && (
            <Step3CustomerForm
              org={org}
              booking={booking}
              onChange={patch}
              onBack={() => setStep(1)}
              onDone={(appointmentId) => navigate(`/booking-confirmation/${appointmentId}`)}
            />
          )}
        </Box>
      </Box>
    </Box>
    </ThemeProvider>
  )
}
