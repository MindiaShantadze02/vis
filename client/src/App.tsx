import { useEffect } from 'react'
import { Routes, Route, Navigate, Outlet, useLocation } from 'react-router-dom'
import { CircularProgress, Box } from '@mui/material'
import { useAuth } from '@/contexts/AuthContext'
import { useOrg } from '@/contexts/OrgContext'
import { useSuperadmin } from '@/hooks/useSuperadmin'

// Auth
import LoginPage from '@/pages/auth/LoginPage'
import RegisterPage from '@/pages/auth/RegisterPage'
import ForgotPasswordPage from '@/pages/auth/ForgotPasswordPage'

// Onboarding
import OnboardingLayout from '@/pages/onboarding/OnboardingLayout'
import BusinessProfileStep from '@/pages/onboarding/BusinessProfileStep'
import ServicesStep from '@/pages/onboarding/ServicesStep'
import SpecialistsStep from '@/pages/onboarding/SpecialistsStep'
import WorkingHoursStep from '@/pages/onboarding/WorkingHoursStep'

// Dashboard
import DashboardLayout from '@/pages/dashboard/DashboardLayout'
import OverviewPage from '@/pages/dashboard/OverviewPage'
import CalendarPage from '@/pages/dashboard/CalendarPage'
import ProfileSettings from '@/pages/dashboard/settings/ProfileSettings'
import BookingPageSettings from '@/pages/dashboard/settings/BookingPageSettings'
import AccountSettings from '@/pages/dashboard/settings/AccountSettings'
import ServicesSettings from '@/pages/dashboard/settings/ServicesSettings'
import WorkingHoursSettings from '@/pages/dashboard/settings/WorkingHoursSettings'
import TeamSettings from '@/pages/dashboard/settings/TeamSettings'
import PaymentSettings from '@/pages/dashboard/settings/PaymentSettings'
import SubscriptionPage from '@/pages/dashboard/settings/SubscriptionPage'
import ApiKeysSettings from '@/pages/dashboard/settings/ApiKeysSettings'

// Public booking
import BookingLayout from '@/pages/book/BookingLayout'
import BookingConfirmationPage from '@/pages/book/BookingConfirmationPage'
import ReviewPage from '@/pages/review/ReviewPage'
import MockCheckoutPage from '@/pages/book/MockCheckoutPage'
import PaymentReturnPage from '@/pages/book/PaymentReturnPage'
import InvitationAcceptPage from '@/pages/book/InvitationAcceptPage'

// Superadmin
import SuperAdminLayout from '@/pages/superadmin/SuperAdminLayout'
import PlatformOverviewPage from '@/pages/superadmin/PlatformOverviewPage'
import OrgsListPage from '@/pages/superadmin/OrgsListPage'
import OrgDetailPage from '@/pages/superadmin/OrgDetailPage'
import SuperadminsPage from '@/pages/superadmin/SuperadminsPage'
import SetupRequestsPage from '@/pages/superadmin/SetupRequestsPage'
import SetupHelpPage from '@/pages/onboarding/SetupHelpPage'

import HomePage from '@/pages/home/HomePage'
import NotFoundPage from '@/pages/NotFoundPage'

// Legal
import LegalPage from '@/pages/legal/LegalPage'

// Developer docs
import DevDocsPage from '@/pages/docs/DevDocsPage'

import { EmbedBridge } from '@/pages/book/useEmbedBridge'

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
  const { isSuperadmin, loading } = useSuperadmin()
  if (loading) return <LoadingScreen />
  if (!isSuperadmin) return <Navigate to="/dashboard" replace />
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

/**
 * SPA navigations keep the previous window scroll position (react-router's
 * <ScrollRestoration> needs a data router, which we don't use), so a footer
 * link clicked at the bottom of a long page would open the next page
 * mid-scroll. Reset to the top on every pathname change.
 */
function ScrollToTop() {
  const { pathname } = useLocation()
  useEffect(() => { window.scrollTo(0, 0) }, [pathname])
  return null
}

export default function App() {
  return (
    <>
    <ScrollToTop />
    <EmbedBridge />
    <Routes>
      <Route path="/" element={<HomePage />} />

      <Route path="/login" element={<PublicOnlyGuard><LoginPage /></PublicOnlyGuard>} />
      <Route path="/register" element={<PublicOnlyGuard><RegisterPage /></PublicOnlyGuard>} />
      <Route path="/forgot-password" element={<PublicOnlyGuard><ForgotPasswordPage /></PublicOnlyGuard>} />

      <Route path="/onboarding" element={<AuthGuard><OnboardingLayout /></AuthGuard>}>
        <Route index element={<Navigate to="/onboarding/business" replace />} />
        <Route path="business" element={<BusinessProfileStep />} />
        <Route path="services" element={<ServicesStep />} />
        <Route path="specialists" element={<SpecialistsStep />} />
        <Route path="hours" element={<WorkingHoursStep />} />
      </Route>
      {/* Concierge onboarding: "describe your business, we set it up for you".
          Outside the step layout — it replaces the wizard, not a step of it. */}
      <Route path="/onboarding/help" element={<AuthGuard><SetupHelpPage /></AuthGuard>} />

      <Route path="/dashboard" element={<AuthGuard><DashboardLayout /></AuthGuard>}>
        {/* Index renders for everyone — shows an empty state when the user has no org. */}
        <Route index element={<OverviewPage />} />
        {/* Everything else needs an organisation. */}
        <Route element={<OrgGuard><Outlet /></OrgGuard>}>
          <Route path="calendar" element={<CalendarPage />} />
          <Route path="settings/profile" element={<ProfileSettings />} />
          <Route path="settings/booking" element={<BookingPageSettings />} />
          <Route path="settings/services" element={<ServicesSettings />} />
          <Route path="settings/hours" element={<WorkingHoursSettings />} />
          <Route path="settings/team" element={<TeamSettings />} />
          <Route path="settings/payment" element={<PaymentSettings />} />
          <Route path="settings/api" element={<ApiKeysSettings />} />
          <Route path="settings/subscription" element={<SubscriptionPage />} />
          <Route path="settings/account" element={<AccountSettings />} />
        </Route>
      </Route>

      <Route path="/book/:slug" element={<BookingLayout />} />
      <Route path="/booking-confirmation/:id" element={<BookingConfirmationPage />} />
      <Route path="/review/:appointmentId" element={<ReviewPage />} />
      <Route path="/pay/mock" element={<MockCheckoutPage />} />
      <Route path="/payment-return" element={<PaymentReturnPage />} />
      <Route path="/invite/:token" element={<InvitationAcceptPage />} />

      {/* Public legal pages (data-protection compliance). */}
      <Route path="/privacy" element={<LegalPage type="privacy" />} />
      <Route path="/terms" element={<LegalPage type="terms" />} />

      {/* Public developer docs (linked from the homepage). */}
      <Route path="/docs/api" element={<DevDocsPage type="api" />} />
      <Route path="/docs/widget" element={<DevDocsPage type="widget" />} />

      <Route path="/superadmin" element={<AuthGuard><SuperAdminGuard><SuperAdminLayout /></SuperAdminGuard></AuthGuard>}>
        <Route index element={<PlatformOverviewPage />} />
        <Route path="orgs" element={<OrgsListPage />} />
        <Route path="orgs/:id" element={<OrgDetailPage />} />
        <Route path="requests" element={<SetupRequestsPage />} />
        <Route path="admins" element={<SuperadminsPage />} />
      </Route>

      <Route path="*" element={<NotFoundPage />} />
    </Routes>
    </>
  )
}
