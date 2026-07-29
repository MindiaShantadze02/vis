import { lazy, Suspense, useEffect } from 'react'
import { Routes, Route, Navigate, Outlet, useLocation } from 'react-router-dom'
import { CircularProgress, Box } from '@mui/material'
import { useAuth } from '@/contexts/AuthContext'
import { useOrg } from '@/contexts/OrgContext'
import { useSuperadmin } from '@/hooks/useSuperadmin'

// Route-level code-splitting: every page is its own chunk so a visitor only
// downloads what their route needs. This matters most for /book/:slug — it is
// embedded in third-party sites and loaded by customers on mobile, and used to
// ship the entire admin app (DataGrid, superadmin, docs…) in one 1.8 MB bundle.

// Auth
const LoginPage = lazy(() => import('@/pages/auth/LoginPage'))
const RegisterPage = lazy(() => import('@/pages/auth/RegisterPage'))
const ForgotPasswordPage = lazy(() => import('@/pages/auth/ForgotPasswordPage'))

// Onboarding
const OnboardingLayout = lazy(() => import('@/pages/onboarding/OnboardingLayout'))
const BusinessProfileStep = lazy(() => import('@/pages/onboarding/BusinessProfileStep'))
const ServicesStep = lazy(() => import('@/pages/onboarding/ServicesStep'))
const SpecialistsStep = lazy(() => import('@/pages/onboarding/SpecialistsStep'))
const WorkingHoursStep = lazy(() => import('@/pages/onboarding/WorkingHoursStep'))
const SetupHelpPage = lazy(() => import('@/pages/onboarding/SetupHelpPage'))

// Dashboard
const DashboardLayout = lazy(() => import('@/pages/dashboard/DashboardLayout'))
const OverviewPage = lazy(() => import('@/pages/dashboard/OverviewPage'))
const CalendarPage = lazy(() => import('@/pages/dashboard/CalendarPage'))
const ClientsPage = lazy(() => import('@/pages/dashboard/ClientsPage'))
const AnalyticsPage = lazy(() => import('@/pages/dashboard/AnalyticsPage'))
const ProfileSettings = lazy(() => import('@/pages/dashboard/settings/ProfileSettings'))
const BookingPageSettings = lazy(() => import('@/pages/dashboard/settings/BookingPageSettings'))
const AccountSettings = lazy(() => import('@/pages/dashboard/settings/AccountSettings'))
const ServicesSettings = lazy(() => import('@/pages/dashboard/settings/ServicesSettings'))
const WorkingHoursSettings = lazy(() => import('@/pages/dashboard/settings/WorkingHoursSettings'))
const TeamSettings = lazy(() => import('@/pages/dashboard/settings/TeamSettings'))
const PaymentSettings = lazy(() => import('@/pages/dashboard/settings/PaymentSettings'))
const BillingPage = lazy(() => import('@/pages/dashboard/settings/BillingPage'))
const ApiKeysSettings = lazy(() => import('@/pages/dashboard/settings/ApiKeysSettings'))

// Public booking
const BookingLayout = lazy(() => import('@/pages/book/BookingLayout'))
const BookingConfirmationPage = lazy(() => import('@/pages/book/BookingConfirmationPage'))
const ReviewPage = lazy(() => import('@/pages/review/ReviewPage'))
const ManagePage = lazy(() => import('@/pages/manage/ManagePage'))
const MockCheckoutPage = lazy(() => import('@/pages/book/MockCheckoutPage'))
const PaymentReturnPage = lazy(() => import('@/pages/book/PaymentReturnPage'))
const InvitationAcceptPage = lazy(() => import('@/pages/book/InvitationAcceptPage'))

// Superadmin
const SuperAdminLayout = lazy(() => import('@/pages/superadmin/SuperAdminLayout'))
const PlatformOverviewPage = lazy(() => import('@/pages/superadmin/PlatformOverviewPage'))
const OrgsListPage = lazy(() => import('@/pages/superadmin/OrgsListPage'))
const OrgDetailPage = lazy(() => import('@/pages/superadmin/OrgDetailPage'))
const SuperadminsPage = lazy(() => import('@/pages/superadmin/SuperadminsPage'))
const SetupRequestsPage = lazy(() => import('@/pages/superadmin/SetupRequestsPage'))

const HomePage = lazy(() => import('@/pages/home/HomePage'))
const NotFoundPage = lazy(() => import('@/pages/NotFoundPage'))

// Legal
const LegalPage = lazy(() => import('@/pages/legal/LegalPage'))

// Developer docs
const DevDocsPage = lazy(() => import('@/pages/docs/DevDocsPage'))

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
    {/* Lazy route chunks resolve inside this boundary; the fallback matches the
        guards' loading screen so chunk loads and auth loads look identical. */}
    <Suspense fallback={<LoadingScreen />}>
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
          <Route path="clients" element={<ClientsPage />} />
          <Route path="analytics" element={<AnalyticsPage />} />
          <Route path="settings/profile" element={<ProfileSettings />} />
          <Route path="settings/booking" element={<BookingPageSettings />} />
          <Route path="settings/services" element={<ServicesSettings />} />
          <Route path="settings/hours" element={<WorkingHoursSettings />} />
          <Route path="settings/team" element={<TeamSettings />} />
          <Route path="settings/payment" element={<PaymentSettings />} />
          <Route path="settings/api" element={<ApiKeysSettings />} />
          <Route path="settings/billing" element={<BillingPage />} />
          <Route path="settings/account" element={<AccountSettings />} />
        </Route>
      </Route>

      <Route path="/book/:slug" element={<BookingLayout />} />
      <Route path="/booking-confirmation/:id" element={<BookingConfirmationPage />} />
      <Route path="/review/:appointmentId" element={<ReviewPage />} />
      <Route path="/manage/:appointmentId" element={<ManagePage />} />
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
    </Suspense>
    </>
  )
}
