import { createContext, useContext, useState, useEffect } from 'react'
import { Outlet, useNavigate, useLocation } from 'react-router-dom'
import { useOrg } from '@/contexts/OrgContext'
import {
  Box, Stepper, Step, StepLabel, Typography,
  Container, LinearProgress,
} from '@mui/material'
import { useTranslation } from 'react-i18next'
import { anim } from '@/theme/animations'
import { gradient } from '@/theme/theme'
import type { DaySchedule } from '@/lib/validation'

// ── Shared state across onboarding steps ──────────────────────

export interface OnboardingService {
  name: string
  duration_minutes: number
  price: number
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
            background: gradient.topbar,
            py: 2, px: 3,
            display: 'flex',
            alignItems: 'center',
            gap: 1.5,
          }}
        >
          <Box
            sx={{
              width: 28, height: 28, borderRadius: '8px',
              bgcolor: 'rgba(255,255,255,0.18)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              flexShrink: 0,
            }}
          >
            <Typography sx={{ color: 'white', fontWeight: 800, fontSize: 13, lineHeight: 1 }}>G</Typography>
          </Box>
          <Typography variant="h6" sx={{ color: 'white', fontWeight: 700 }}>Grafiki</Typography>
        </Box>

        <LinearProgress
          variant="determinate"
          value={((activeStep + 1) / STEPS.length) * 100}
        />

        {/* Intentionally narrower (sm ≈ 600) than settings pages — this is a focused stepper flow. */}
        <Container maxWidth="sm" sx={{ flex: 1, py: 5 }}>
          <Stepper activeStep={activeStep} sx={{ mb: 5 }}>
            {STEPS.map((s, i) => (
              <Step key={i}>
                <StepLabel>{t(s.labelKey)}</StepLabel>
              </Step>
            ))}
          </Stepper>

          {/* key re-mounts on step change, re-firing the entrance animation */}
          <Box key={activeStep} sx={{ animation: anim.fadeInUp }}>
            <Outlet context={{ goNext, goBack, data, update }} />
          </Box>
        </Container>
      </Box>
    </OnboardingContext.Provider>
  )
}
