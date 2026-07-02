import { createContext, useContext, useState, useEffect } from 'react'
import { Outlet, useNavigate, useLocation } from 'react-router-dom'
import { useOrg } from '@/contexts/OrgContext'
import { supabase } from '@/lib/supabase'
import type { DaySchedule } from '@/lib/validation'
import PendingInvites from '@/pages/dashboard/PendingInvites'
import OnboardingShell from './OnboardingShell'

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
  // Step 2 — services offered by the business.
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
    services: [],
    workingHours: defaultWorkingHours,
  },
  update: () => {},
})

export function useOnboarding() {
  return useContext(OnboardingContext)
}

// ── Step definitions ──────────────────────────────────────────

type Step = { path: string; labelKey: string }

const STEPS: Step[] = [
  { path: '/onboarding/business', labelKey: 'onboarding.step1' },
  { path: '/onboarding/services', labelKey: 'onboarding.step2' },
  { path: '/onboarding/hours',    labelKey: 'onboarding.step3' },
]

// ── Layout ────────────────────────────────────────────────────

export default function OnboardingLayout() {
  const navigate = useNavigate()
  const { pathname } = useLocation()
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

  const steps = STEPS
  const activeStep = steps.findIndex(s => pathname.startsWith(s.path))
  const stepIdx = Math.max(0, activeStep)

  // Slide direction for the step transition: forward when advancing, back when
  // returning. Derived by comparing against the previous index using the
  // adjust-state-during-render pattern (no ref reads during render).
  const [nav, setNav] = useState({ prev: stepIdx, dir: 1 })
  if (nav.prev !== stepIdx) setNav({ prev: stepIdx, dir: stepIdx > nav.prev ? 1 : -1 })
  const direction = nav.dir

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
      <OnboardingShell
        step={stepIdx}
        direction={direction}
        data={data}
        onSkip={handleSkip}
        banner={<PendingInvites />}
      >
        <Outlet context={{ goNext, goBack, data, update }} />
      </OnboardingShell>
    </OnboardingContext.Provider>
  )
}
