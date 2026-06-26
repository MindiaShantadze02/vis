import { createContext, useContext, useState, useEffect } from 'react'
import { Outlet, useNavigate, useLocation } from 'react-router-dom'
import { useOrg } from '@/contexts/OrgContext'
import {
  Box, Typography, Container, Button,
} from '@mui/material'
import { useTranslation } from 'react-i18next'
import { supabase } from '@/lib/supabase'
import { anim } from '@/theme/animations'
import type { DaySchedule } from '@/lib/validation'
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

export interface OnboardingData {
  // Step 1
  name: string
  description: string
  slug: string
  contact_phone: string
  // Step 2
  services: OnboardingService[]
  // Step 3 — stored in the editable schedule shape so edits survive navigating
  // between steps without a lossy ranges↔schedule round-trip.
  workingHours: Record<string, DaySchedule>
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
    name: '', description: '', slug: '', contact_phone: '',
    services: [], workingHours: defaultWorkingHours,
  },
  update: () => {},
})

export function useOnboarding() {
  return useContext(OnboardingContext)
}

// ── Step definitions ──────────────────────────────────────────

const STEPS = [
  { path: '/onboarding/business',  labelKey: 'onboarding.step1' },
  { path: '/onboarding/services',  labelKey: 'onboarding.step2' },
  { path: '/onboarding/hours',     labelKey: 'onboarding.step3' },
]

function useCurrentStep() {
  const { pathname } = useLocation()
  return STEPS.findIndex(s => pathname.startsWith(s.path))
}

// ── Layout ────────────────────────────────────────────────────

export default function OnboardingLayout() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const activeStep = useCurrentStep()
  const stepIdx = Math.max(0, activeStep)
  const { org } = useOrg()

  // Once an org exists (either just created via onboarding or already present),
  // redirect to the dashboard. This also fixes the race condition where
  // navigate('/dashboard') fires before React commits the OrgContext state update.
  useEffect(() => {
    if (org) navigate('/dashboard', { replace: true })
  }, [org])

  const [data, setData] = useState<OnboardingData>({
    name: '', description: '', slug: '', contact_phone: '',
    services: [],
    workingHours: defaultWorkingHours,
  })

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
    const next = STEPS[activeStep + 1]
    if (next) navigate(next.path)
  }

  function goBack() {
    const prev = STEPS[activeStep - 1]
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
                {t(STEPS[stepIdx].labelKey)}
              </Typography>
            </Box>
            <Box sx={{ display: 'flex', gap: 0.75 }}>
              {STEPS.map((_, i) => (
                <Box
                  key={i}
                  sx={{
                    flex: 1, height: 5, borderRadius: 3,
                    transition: 'background-color 0.3s',
                    bgcolor: i <= stepIdx ? 'primary.main' : 'rgba(25,118,210,0.14)',
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
