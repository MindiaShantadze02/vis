import { createContext, useContext, useState, useEffect } from 'react'
import { Outlet, useNavigate, useLocation } from 'react-router-dom'
import {
  Box, Stepper, Step, StepLabel, Typography,
  Container, LinearProgress,
} from '@mui/material'
import { useTranslation } from 'react-i18next'

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
  // Step 3
  workingHours: Record<string, { open: boolean; start: string; end: string }>
}

const defaultWorkingHours: Record<string, { open: boolean; start: string; end: string }> = {
  monday:    { open: true,  start: '09:00', end: '18:00' },
  tuesday:   { open: true,  start: '09:00', end: '18:00' },
  wednesday: { open: true,  start: '09:00', end: '18:00' },
  thursday:  { open: true,  start: '09:00', end: '18:00' },
  friday:    { open: true,  start: '09:00', end: '18:00' },
  saturday:  { open: false, start: '10:00', end: '15:00' },
  sunday:    { open: false, start: '10:00', end: '15:00' },
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
        <Box sx={{ bgcolor: 'primary.main', py: 2, px: 3 }}>
          <Typography variant="h6" color="white" sx={{ fontWeight: 700 }}>
            Grafiki
          </Typography>
        </Box>

        <LinearProgress
          variant="determinate"
          value={((activeStep + 1) / STEPS.length) * 100}
          sx={{ height: 3 }}
        />

        <Container maxWidth="sm" sx={{ flex: 1, py: 5 }}>
          <Stepper activeStep={activeStep} sx={{ mb: 5 }}>
            {STEPS.map((s, i) => (
              <Step key={i}>
                <StepLabel>{t(s.labelKey)}</StepLabel>
              </Step>
            ))}
          </Stepper>

          {/* Step content is rendered here */}
          <Outlet context={{ goNext, goBack, data, update }} />
        </Container>
      </Box>
    </OnboardingContext.Provider>
  )
}
