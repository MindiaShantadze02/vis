import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import {
  Box, Typography, Avatar, CircularProgress, Stepper,
  Step, StepLabel, useMediaQuery, useTheme, Divider,
} from '@mui/material'
import CalendarMonthOutlinedIcon from '@mui/icons-material/CalendarMonthOutlined'
import AccessTimeOutlinedIcon from '@mui/icons-material/AccessTimeOutlined'
import PhoneOutlinedIcon from '@mui/icons-material/PhoneOutlined'
import { supabase } from '@/lib/supabase'
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
}

export interface BookingService {
  id: string
  name: string
  duration_minutes: number
  price: number
}

export interface BookingState {
  service: BookingService | null
  date: string        // yyyy-MM-dd
  time: string        // HH:mm
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
    firstName: '', lastName: '', phone: '', notes: '',
    paymentMethod: 'in_person',
  })

  useEffect(() => {
    async function loadOrg() {
      const { data, error } = await supabase
        .from('organisations')
        .select('id, name, description, contact_phone, logo_url, slug, payment_config')
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
        <Box sx={{ textAlign: 'center' }}>
          <Typography variant="h5" sx={{ fontWeight: 700, mb: 1 }}>ბიზნესი ვერ მოიძებნა</Typography>
          <Typography variant="body2" sx={{ color: 'text.secondary' }}>შეამოწმეთ ბმული და სცადეთ თავიდან</Typography>
        </Box>
      </Box>
    )
  }

  if (!org) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh' }}>
        <CircularProgress />
      </Box>
    )
  }

  const sidebar = (
    <Box
      sx={{
        width: { xs: '100%', md: 300 },
        bgcolor: 'primary.main',
        color: 'white',
        p: 4,
        display: 'flex',
        flexDirection: 'column',
        gap: 2,
        flexShrink: 0,
      }}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
        <Avatar
          src={org.logo_url ?? undefined}
          sx={{ width: 56, height: 56, bgcolor: 'rgba(255,255,255,0.2)', fontSize: 22 }}
        >
          {org.name.charAt(0)}
        </Avatar>
        <Box>
          <Typography variant="h6" sx={{ fontWeight: 700, color: 'white' }}>{org.name}</Typography>
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
          <Divider sx={{ borderColor: 'rgba(255,255,255,0.2)' }} />
          <Typography variant="body2" sx={{ opacity: 0.85, lineHeight: 1.6 }}>
            {org.description}
          </Typography>
        </>
      )}

      {/* Selected booking summary */}
      {booking.service && (
        <>
          <Divider sx={{ borderColor: 'rgba(255,255,255,0.2)' }} />
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
        </>
      )}
    </Box>
  )

  return (
    <Box sx={{ display: 'flex', flexDirection: { xs: 'column', md: 'row' }, minHeight: '100vh' }}>
      {sidebar}

      <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', bgcolor: 'background.default' }}>
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

        {/* Step content */}
        <Box sx={{ flex: 1, px: { xs: 2, md: 5 }, py: 4, maxWidth: 560, width: '100%' }}>
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
              onSelect={(date, time) => { patch({ date, time }); setStep(2) }}
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
  )
}
