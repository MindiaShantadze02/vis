import { Routes, Route, Navigate, Outlet } from 'react-router-dom'
import { CircularProgress, Box } from '@mui/material'
import { useAuth } from '@/contexts/AuthContext'
import { useOrg } from '@/contexts/OrgContext'

// Auth
import LoginPage from '@/pages/auth/LoginPage'

// Onboarding
import OnboardingLayout from '@/pages/onboarding/OnboardingLayout'
import BusinessProfileStep from '@/pages/onboarding/BusinessProfileStep'
import ServicesStep from '@/pages/onboarding/ServicesStep'
import WorkingHoursStep from '@/pages/onboarding/WorkingHoursStep'

// Dashboard
import DashboardLayout from '@/pages/dashboard/DashboardLayout'
import OverviewPage from '@/pages/dashboard/OverviewPage'
import CalendarPage from '@/pages/dashboard/CalendarPage'
import ProfileSettings from '@/pages/dashboard/settings/ProfileSettings'
import ServicesSettings from '@/pages/dashboard/settings/ServicesSettings'
import WorkingHoursSettings from '@/pages/dashboard/settings/WorkingHoursSettings'
import TeamSettings from '@/pages/dashboard/settings/TeamSettings'
import PaymentSettings from '@/pages/dashboard/settings/PaymentSettings'
import SubscriptionPage from '@/pages/dashboard/settings/SubscriptionPage'

// Public booking
import BookingLayout from '@/pages/book/BookingLayout'
import BookingConfirmationPage from '@/pages/book/BookingConfirmationPage'
import PaymentReturnPage from '@/pages/book/PaymentReturnPage'
import InvitationAcceptPage from '@/pages/book/InvitationAcceptPage'

// Superadmin
import SuperAdminLayout from '@/pages/superadmin/SuperAdminLayout'
import PlatformOverviewPage from '@/pages/superadmin/PlatformOverviewPage'
import OrgsListPage from '@/pages/superadmin/OrgsListPage'
import OrgDetailPage from '@/pages/superadmin/OrgDetailPage'

function LoadingScreen() {
  return (
    <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh' }}>
      <CircularProgress color="primary" />
    </Box>
  )
}

function AuthGuard({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth()
  if (loading) return <LoadingScreen />
  if (!user) return <Navigate to="/login" replace />
  return <>{children}</>
}

// Guards routes that need an organisation (calendar, settings). A user with no
// org is allowed on the dashboard index (empty state), so bounce them there
// rather than forcing onboarding.
function OrgGuard({ children }: { children: React.ReactNode }) {
  const { org, loading } = useOrg()
  const { loading: authLoading } = useAuth()
  if (loading || authLoading) return <LoadingScreen />
  if (!org) return <Navigate to="/dashboard" replace />
  return <>{children}</>
}

function SuperAdminGuard({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth()
  const superadminId = import.meta.env.VITE_SUPERADMIN_USER_ID as string | undefined
  if (loading) return <LoadingScreen />
  if (!user || user.id !== superadminId) return <Navigate to="/dashboard" replace />
  return <>{children}</>
}

function PublicOnlyGuard({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth()
  const { org, loading: orgLoading } = useOrg()
  if (loading || orgLoading) return <LoadingScreen />
  if (user) {
    // Org members go to the dashboard. A user with no org who already chose to
    // skip onboarding also goes to the (empty) dashboard; otherwise they see
    // onboarding first.
    const skipped = Boolean(user.user_metadata?.onboarding_skipped)
    const dest = org || skipped ? '/dashboard' : '/onboarding/business'
    return <Navigate to={dest} replace />
  }
  return <>{children}</>
}

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Navigate to="/login" replace />} />

      <Route path="/login" element={<PublicOnlyGuard><LoginPage /></PublicOnlyGuard>} />

      <Route path="/onboarding" element={<AuthGuard><OnboardingLayout /></AuthGuard>}>
        <Route index element={<Navigate to="/onboarding/business" replace />} />
        <Route path="business" element={<BusinessProfileStep />} />
        <Route path="services" element={<ServicesStep />} />
        <Route path="hours" element={<WorkingHoursStep />} />
      </Route>

      <Route path="/dashboard" element={<AuthGuard><DashboardLayout /></AuthGuard>}>
        {/* Index renders for everyone — shows an empty state when the user has no org. */}
        <Route index element={<OverviewPage />} />
        {/* Everything else needs an organisation. */}
        <Route element={<OrgGuard><Outlet /></OrgGuard>}>
          <Route path="calendar" element={<CalendarPage />} />
          <Route path="settings/profile" element={<ProfileSettings />} />
          <Route path="settings/services" element={<ServicesSettings />} />
          <Route path="settings/hours" element={<WorkingHoursSettings />} />
          <Route path="settings/team" element={<TeamSettings />} />
          <Route path="settings/payment" element={<PaymentSettings />} />
          <Route path="settings/subscription" element={<SubscriptionPage />} />
        </Route>
      </Route>

      <Route path="/book/:slug" element={<BookingLayout />} />
      <Route path="/booking-confirmation/:id" element={<BookingConfirmationPage />} />
      <Route path="/payment-return" element={<PaymentReturnPage />} />
      <Route path="/invite/:token" element={<InvitationAcceptPage />} />

      <Route path="/superadmin" element={<AuthGuard><SuperAdminGuard><SuperAdminLayout /></SuperAdminGuard></AuthGuard>}>
        <Route index element={<PlatformOverviewPage />} />
        <Route path="orgs" element={<OrgsListPage />} />
        <Route path="orgs/:id" element={<OrgDetailPage />} />
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
