import { createContext, useContext, useState, useEffect } from 'react'
import { Outlet, useNavigate, useLocation } from 'react-router-dom'
import { useOrg } from '@/contexts/OrgContext'
import {
  Box, Typography, Container, Button,
} from '@mui/material'
import { useTranslation } from 'react-i18next'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/contexts/AuthContext'
import { anim } from '@/theme/animations'
import type { DaySchedule } from '@/lib/validation'
import { VERTICALS, type Vertical } from '@/lib/verticals'
import PendingInvites from '@/pages/dashboard/PendingInvites'

// ── Shared state across onboarding steps ──────────────────────

export type ServiceLocationType = 'in_person' | 'online'

export interface OnboardingService {
  name: string
  duration_minutes: number
  price: number
  location_type: ServiceLocationType
  // Only meaningful for online services; null otherwise.
  meeting_link: string | null
}

// A hotel room TYPE — persisted as a `resources` row (kind='room_type') at org
// creation. nightly_price / total_rooms land in the row's attrs jsonb.
export interface OnboardingRoom {
  name: string
  capacity: number
  nightly_price: number
  total_rooms: number
  is_active: boolean
  // Photos picked during onboarding, uploaded to resource_images once the room
  // row (and its id) exists at finish.
  images: File[]
}

// A restaurant table — persisted as a `resources` row (kind='table').
export interface OnboardingTable {
  name: string
  capacity: number
  is_active: boolean
}

export interface OnboardingData {
  // Step 1
  vertical: Vertical
  name: string
  description: string
  slug: string
  contact_phone: string
  // Step 2 — the "catalog" step is vertical-specific: appointments add services,
  // restaurants add tables, hotels add room types. Only the one matching
  // `vertical` is populated; the others stay empty.
  services: OnboardingService[]
  rooms: OnboardingRoom[]
  tables: OnboardingTable[]
  turnMinutes: number // restaurant table turn time (minutes)
  // Step 3 — stored in the editable schedule shape so edits survive navigating
  // between steps without a lossy ranges↔schedule round-trip.
  workingHours: Record<string, DaySchedule>
}

/** Resolve the vertical a user signed up for (set on the `/register/:vertical`
 *  link, stored in auth metadata). Falls back to appointments. */
function signupVertical(meta: Record<string, unknown> | undefined): Vertical {
  const v = meta?.signup_vertical
  return typeof v === 'string' && (VERTICALS as readonly string[]).includes(v)
    ? (v as Vertical)
    : 'appointments'
}

const open = (openTime: string, closeTime: string): DaySchedule =>
  ({ open: true, openTime, closeTime, breaks: [] })
const closed = (): DaySchedule =>
  ({ open: false, openTime: '09:00', closeTime: '18:00', breaks: [] })

const defaultWorkingHours: Record<string, DaySchedule> = {
  monday:    open('09:00', '18:00'),
  tuesday:   open('09:00', '18:00'),
  wednesday: open('09:00', '18:00'),
  thursday:  open('09:00', '18:00'),
  friday:    open('09:00', '18:00'),
  saturday:  closed(),
  sunday:    closed(),
}

interface OnboardingContextValue {
  data: OnboardingData
  update: (patch: Partial<OnboardingData>) => void
}

const OnboardingContext = createContext<OnboardingContextValue>({
  data: {
    vertical: 'appointments',
    name: '', description: '', slug: '', contact_phone: '',
    services: [], rooms: [], tables: [], turnMinutes: 120,
    workingHours: defaultWorkingHours,
  },
  update: () => {},
})

export function useOnboarding() {
  return useContext(OnboardingContext)
}

// ── Step definitions ──────────────────────────────────────────

type Step = { path: string; labelKey: string }

const BUSINESS_STEP: Step = { path: '/onboarding/business', labelKey: 'onboarding.step1' }
const SERVICES_STEP: Step = { path: '/onboarding/services', labelKey: 'onboarding.step2' }
const TABLES_STEP:   Step = { path: '/onboarding/tables',   labelKey: 'restaurant.tables' }
const ROOMS_STEP:    Step = { path: '/onboarding/rooms',    labelKey: 'hotel.rooms' }
const HOURS_STEP:    Step = { path: '/onboarding/hours',    labelKey: 'onboarding.step3' }

// The middle "catalog" step is vertical-specific: appointments configure
// services, restaurants their tables, hotels their room types. Appointments and
// restaurants finish on the working-hours step; hotels have no weekly hours
// (availability is date-range based) so they finish on the rooms step instead.
function stepsFor(vertical: Vertical): Step[] {
  if (vertical === 'hotel') return [BUSINESS_STEP, ROOMS_STEP]
  const catalog = vertical === 'restaurant' ? TABLES_STEP : SERVICES_STEP
  return [BUSINESS_STEP, catalog, HOURS_STEP]
}

// ── Layout ────────────────────────────────────────────────────

export default function OnboardingLayout() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const { org } = useOrg()
  const { user } = useAuth()

  // Once an org exists (either just created via onboarding or already present),
  // redirect to the dashboard. This also fixes the race condition where
  // navigate('/dashboard') fires before React commits the OrgContext state update.
  useEffect(() => {
    if (org) navigate('/dashboard', { replace: true })
  }, [org])

  // Seed the vertical from the link the user registered through (stored in auth
  // metadata by the /register/:vertical page). This is the only place the
  // vertical is decided — the in-onboarding chooser is gone.
  const [data, setData] = useState<OnboardingData>({
    vertical: signupVertical(user?.user_metadata),
    name: '', description: '', slug: '', contact_phone: '',
    services: [], rooms: [], tables: [], turnMinutes: 120,
    workingHours: defaultWorkingHours,
  })

  // Steps depend on the chosen vertical (set on step 1). Appointments default
  // keeps the original 3-step flow; restaurants/hotels drop the services step.
  const steps = stepsFor(data.vertical)
  const activeStep = steps.findIndex(s => pathname.startsWith(s.path))
  const stepIdx = Math.max(0, activeStep)

  // If someone lands on step 2 or 3 directly (e.g. browser back/forward or bookmark)
  // without filling step 1, send them back to the beginning.
  useEffect(() => {
    if (activeStep > 0 && !data.name) {
      navigate('/onboarding/business', { replace: true })
    }
  }, [activeStep, data.name])

  function update(patch: Partial<OnboardingData>) {
    setData(prev => ({ ...prev, ...patch }))
  }

  function goNext() {
    const next = steps[activeStep + 1]
    if (next) navigate(next.path)
  }

  function goBack() {
    const prev = steps[activeStep - 1]
    if (prev) navigate(prev.path)
  }

  // Skip onboarding: remember the choice on the user so future logins land
  // on the (empty) dashboard instead of being sent back here, then go there.
  async function handleSkip() {
    await supabase.auth.updateUser({ data: { onboarding_skipped: true } })
    navigate('/dashboard')
  }

  return (
    <OnboardingContext.Provider value={{ data, update }}>
      <Box
        sx={{
          minHeight: '100vh',
          display: 'flex',
          flexDirection: 'column',
          bgcolor: 'background.default',
        }}
      >
        {/* Top bar */}
        <Box
          sx={{
            bgcolor: 'background.paper',
            borderBottom: '1px solid',
            borderColor: 'divider',
            py: 1.75, px: 3,
            display: 'flex',
            alignItems: 'center',
            gap: 1.25,
          }}
        >
          <Box
            sx={{
              width: 30, height: 30, borderRadius: '9px',
              bgcolor: 'primary.dark',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              flexShrink: 0,
            }}
          >
            <Typography sx={{ color: 'white', fontWeight: 800, fontSize: 15, lineHeight: 1 }}>V</Typography>
          </Box>
          <Typography variant="h6" sx={{ color: 'primary.dark', fontWeight: 800, letterSpacing: '-0.3px' }}>Vis</Typography>

          <Box sx={{ flex: 1 }} />

          <Button
            onClick={handleSkip}
            size="small"
            sx={{ color: 'text.secondary', fontWeight: 600 }}
          >
            {t('onboarding.skip')}
          </Button>
        </Box>

        {/* Intentionally narrower (sm ≈ 600) than settings pages — this is a focused stepper flow. */}
        <Container maxWidth="sm" sx={{ flex: 1, py: 5 }}>
          {/* If this user was invited to an existing org, offer to join it here
              rather than letting them create a redundant one. */}
          <PendingInvites />

          {/* Progress bar — 3 segments + step counter & title (replaces the Stepper). */}
          <Box sx={{ mb: 4 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1.25 }}>
              <Typography variant="caption" sx={{ fontWeight: 700, letterSpacing: '0.5px', color: 'text.secondary' }}>
                {t('booking.stepCounter', { n: stepIdx + 1 })}
              </Typography>
              <Typography variant="body2" sx={{ fontWeight: 700, color: 'primary.main' }}>
                {t(steps[stepIdx].labelKey)}
              </Typography>
            </Box>
            <Box sx={{ display: 'flex', gap: 0.75 }}>
              {steps.map((_, i) => (
                <Box
                  key={i}
                  sx={{
                    flex: 1, height: 5, borderRadius: 3,
                    transition: 'background-color 0.3s',
                    bgcolor: i <= stepIdx ? 'primary.main' : 'rgba(30,36,51,0.12)',
                  }}
                />
              ))}
            </Box>
          </Box>

          {/* key re-mounts on step change, re-firing the entrance animation */}
          <Box key={activeStep} sx={{ animation: anim.fadeInUp }}>
            <Outlet context={{ goNext, goBack, data, update }} />
          </Box>
        </Container>
      </Box>
    </OnboardingContext.Provider>
  )
}
