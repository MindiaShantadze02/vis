import { Suspense, useState } from 'react'
import { NavLink, useNavigate, useLocation } from 'react-router-dom'

/**
 * Passed down to dashboard pages via the router Outlet. `refreshSignal` bumps
 * each time the admin acts on a notification, letting pages (e.g. the overview)
 * refetch so they reflect the newest appointment requests.
 */
export interface DashboardOutletContext {
  refreshSignal: number
}
import {
  Box, Drawer, List, ListItemButton, ListItemIcon, ListItemText,
  AppBar, Toolbar, IconButton, Typography, Badge,
  Menu, MenuItem, Divider, useMediaQuery, useTheme,
} from '@mui/material'
import { DashboardOutlined as DashboardOutlinedIcon } from '@/components/icons'
import { CalendarMonthOutlined as CalendarMonthOutlinedIcon } from '@/components/icons'
import { InsightsOutlined as InsightsOutlinedIcon } from '@/components/icons'
import { GroupOutlined as GroupOutlinedIcon } from '@/components/icons'
import { SettingsOutlined as SettingsOutlinedIcon } from '@/components/icons'
import { AdminPanelSettingsOutlined as AdminPanelSettingsOutlinedIcon } from '@/components/icons'
import { NotificationsOutlined as NotificationsOutlinedIcon } from '@/components/icons'
import { Menu as MenuIcon } from '@/components/icons'
import { Logout as LogoutIcon } from '@/components/icons'
import { formatDistanceToNow } from 'date-fns'
import { motion } from 'framer-motion'
import { useTranslation } from 'react-i18next'
import { supabase } from '@/lib/supabase'
import { useOrg } from '@/contexts/OrgContext'
import { useSuperadmin } from '@/hooks/useSuperadmin'
import { useNotifications } from '@/hooks/useNotifications'
import { LanguageSwitcher, AnimatedOutlet, LoadingState } from '@/components/ui'
import { dateLocale } from '@/lib/dateLocale'
import { anim } from '@/theme/animations'
import { gradient, tint } from '@/theme/theme'
import { isBookingBlocked } from '@/lib/billing'
import BillingBlockedDialog from '@/components/BillingBlockedDialog'
import VisLogo from '@/components/VisLogo'

const DRAWER_WIDTH = 240

// Routes the billing block must NOT cover — they are how the owner gets out of
// it (add a card, pay, or close the account).
const BILLING_EXEMPT_PATHS = ['/dashboard/settings/billing', '/dashboard/settings/account']

const NAV_ITEMS = [
  { labelKey: 'dashboard.overview',     path: '/dashboard',              icon: <DashboardOutlinedIcon /> },
  { labelKey: 'dashboard.calendar',     path: '/dashboard/calendar',     icon: <CalendarMonthOutlinedIcon /> },
  { labelKey: 'clients.nav',            path: '/dashboard/clients',      icon: <GroupOutlinedIcon /> },
  { labelKey: 'analytics.nav',          path: '/dashboard/analytics',    icon: <InsightsOutlinedIcon /> },
]

// Dashboard settings, grouped by concern so the submenu teaches the mental
// model: your business, the customer-facing booking + payments, then your Vis
// account + billing. "Payment" (money IN from customers) sits with the booking
// page; "Billing" (money OUT to Vis) sits with the account — they used to share
// a "Billing" header and read as the same thing. API keys (a niche developer
// feature) is demoted to the bottom of the account group.
const SETTINGS_GROUPS = [
  {
    headerKey: 'settings.groupBusiness',
    items: [
      { labelKey: 'settings.business',     path: '/dashboard/settings/profile' },
      { labelKey: 'settings.services',     path: '/dashboard/settings/services' },
      { labelKey: 'settings.workingHours', path: '/dashboard/settings/hours' },
      { labelKey: 'settings.team',         path: '/dashboard/settings/team' },
    ],
  },
  {
    headerKey: 'settings.groupBookingPage',
    items: [
      { labelKey: 'settings.bookingPage',  path: '/dashboard/settings/booking' },
      { labelKey: 'settings.payment',      path: '/dashboard/settings/payment' },
    ],
  },
  {
    headerKey: 'settings.groupAccount',
    items: [
      { labelKey: 'settings.billing',      path: '/dashboard/settings/billing' },
      { labelKey: 'settings.account',      path: '/dashboard/settings/account' },
      { labelKey: 'settings.apiKeys',      path: '/dashboard/settings/api' },
    ],
  },
]

export default function DashboardLayout() {
  const { t } = useTranslation()
  const theme = useTheme()
  const isMobile = useMediaQuery(theme.breakpoints.down('md'))
  const { org, billing } = useOrg()
  const settingsGroups = SETTINGS_GROUPS
  const mainNav = NAV_ITEMS
  const { isSuperadmin } = useSuperadmin()
  const navigate = useNavigate()
  const location = useLocation()
  const { items: notifications, unreadCount, markAllRead } = useNotifications()

  const [mobileOpen, setMobileOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null)
  // Bumped on each notification click so the overview refetches its data.
  const [refreshSignal, setRefreshSignal] = useState(0)

  async function handleLogout() {
    await supabase.auth.signOut()
    navigate('/login')
  }

  // Opening the menu marks everything read (clearing the badge); the list
  // itself stays visible until reload.
  function openNotifications(e: React.MouseEvent<HTMLElement>) {
    setAnchorEl(e.currentTarget)
    markAllRead()
  }

  function openAppointment(appointmentId: string | null) {
    setAnchorEl(null)
    // The overview is where an admin acts on a booking. (We don't deep-link to
    // a single appointment yet.)
    navigate('/dashboard')
    // Force the overview to refetch even when we're already on it, so it
    // reflects the request that triggered this notification.
    setRefreshSignal(s => s + 1)
    void appointmentId
  }

  const sidebar = (
    <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      {/* Brand */}
      <Box sx={{ px: 2.5, py: 2.5 }}>
        <Box onClick={() => navigate('/dashboard')} sx={{ display: 'inline-flex', cursor: 'pointer' }}>
          <VisLogo height={22} />
        </Box>
        {org && (
          <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block', mt: 0.75 }}>
            {org.name}
          </Typography>
        )}
      </Box>

      <Divider />

      {/* Main nav. Without an org only the overview (empty state) is reachable;
          Calendar and Settings need an organisation. */}
      <List sx={{ px: 1, pt: 1, flex: 1 }}>
        {(org ? mainNav : mainNav.filter(item => item.path === '/dashboard')).map((item, i) => (
          <ListItemButton
            key={item.path}
            component={NavLink}
            to={item.path}
            end={item.path === '/dashboard'}
            onClick={() => setMobileOpen(false)}
            sx={{
              borderRadius: 2,
              mb: 0.5,
              pl: '13px',
              borderLeft: '3px solid transparent',
              transition: 'all 0.15s ease',
              animation: anim.slideInLeft,
              animationDelay: `${i * 50}ms`,
              '&.active': {
                bgcolor: 'rgba(30,36,51,0.05)',
                color: 'primary.dark',
                borderLeftColor: 'primary.main',
                '& .MuiListItemIcon-root': { color: 'primary.main' },
              },
              '&:not(.active):hover': {
                bgcolor: tint.hover,
              },
            }}
          >
            <ListItemIcon sx={{ minWidth: 36 }}>{item.icon}</ListItemIcon>
            <ListItemText
              primary={t(item.labelKey)}
              slotProps={{ primary: { variant: 'body2', sx: { fontWeight: 500 } } }}
            />
          </ListItemButton>
        ))}

        {/* Settings section — only when the user has an organisation */}
        {org && (<>
        <ListItemButton
          onClick={() => setSettingsOpen(o => !o)}
          data-testid="nav-settings"
          sx={{
            borderRadius: 2,
            mb: 0.5,
            pl: '13px',
            borderLeft: '3px solid transparent',
            animation: anim.slideInLeft,
            animationDelay: `${NAV_ITEMS.length * 50}ms`,
            '&:hover': {
              bgcolor: tint.hover,
              borderLeftColor: tint.hoverBorder,
            },
          }}
        >
          <ListItemIcon sx={{ minWidth: 36 }}><SettingsOutlinedIcon /></ListItemIcon>
          <ListItemText
            primary={t('dashboard.settings')}
            slotProps={{ primary: { variant: 'body2', sx: { fontWeight: 500 } } }}
          />
        </ListItemButton>

        {settingsOpen && settingsGroups.map(group => (
          <Box key={group.headerKey}>
            <Typography
              variant="caption"
              sx={{
                display: 'block', pl: '36px', mt: 1, mb: 0.5,
                fontWeight: 700, letterSpacing: '0.5px', textTransform: 'uppercase',
                color: 'text.disabled', fontSize: '0.66rem',
              }}
            >
              {t(group.headerKey)}
            </Typography>
            {group.items.map((item, i) => (
              <ListItemButton
                key={item.path}
                component={NavLink}
                to={item.path}
                onClick={() => setMobileOpen(false)}
                sx={{
                  borderRadius: 2,
                  mb: 0.25,
                  pl: '36px',
                  borderLeft: '3px solid transparent',
                  transition: 'all 0.15s ease',
                  animation: anim.fadeInUp,
                  animationDelay: `${i * 30}ms`,
                  '&.active': {
                    bgcolor: 'rgba(30,36,51,0.05)',
                    color: 'primary.dark',
                    borderLeftColor: 'primary.main',
                    fontWeight: 600,
                  },
                  '&:not(.active):hover': {
                    bgcolor: tint.hover,
                  },
                }}
              >
                <ListItemText primary={t(item.labelKey)} slotProps={{ primary: { variant: 'body2' } }} />
              </ListItemButton>
            ))}
          </Box>
        ))}
        </>)}

        {/* Superadmin entry — only for platform admins */}
        {isSuperadmin && (
          <ListItemButton
            onClick={() => { setMobileOpen(false); navigate('/superadmin') }}
            sx={{
              borderRadius: 2,
              mt: 0.5,
              pl: '13px',
              borderLeft: '3px solid transparent',
              '&:hover': { bgcolor: tint.hover, borderLeftColor: tint.hoverBorder },
            }}
          >
            <ListItemIcon sx={{ minWidth: 36 }}><AdminPanelSettingsOutlinedIcon /></ListItemIcon>
            <ListItemText
              primary={t('dashboard.superadmin')}
              slotProps={{ primary: { variant: 'body2', sx: { fontWeight: 500 } } }}
            />
          </ListItemButton>
        )}

        {/* Logout — kept in the nav (below Settings) so it's reachable without
            scrolling to the very bottom of a long, expanded settings list. */}
        <ListItemButton
          onClick={handleLogout}
          data-testid="logout-btn"
          sx={{
            borderRadius: 2,
            mt: 0.5,
            pl: '13px',
            borderLeft: '3px solid transparent',
            color: 'error.main',
            '& .MuiListItemIcon-root': { color: 'error.main' },
            '&:hover': { bgcolor: 'rgba(224,82,75,0.08)', borderLeftColor: 'rgba(224,82,75,0.35)' },
          }}
        >
          <ListItemIcon sx={{ minWidth: 36 }}><LogoutIcon fontSize="small" /></ListItemIcon>
          <ListItemText
            primary={t('common.logout')}
            slotProps={{ primary: { variant: 'body2', sx: { fontWeight: 500 } } }}
          />
        </ListItemButton>
      </List>
    </Box>
  )

  return (
    <Box sx={{ display: 'flex', minHeight: '100vh', bgcolor: 'background.default' }}>
      {/* Desktop sidebar */}
      {!isMobile && (
        <Box
          component="nav"
          sx={{
            width: DRAWER_WIDTH,
            flexShrink: 0,
            borderRight: '1px solid',
            borderColor: 'divider',
            background: gradient.panel,
          }}
        >
          {sidebar}
        </Box>
      )}

      {/* Mobile drawer */}
      {isMobile && (
        <Drawer
          open={mobileOpen}
          onClose={() => setMobileOpen(false)}
          ModalProps={{ keepMounted: true }}
          sx={{ '& .MuiDrawer-paper': { width: DRAWER_WIDTH, background: gradient.panel } }}
        >
          {sidebar}
        </Drawer>
      )}

      {/* Main content */}
      <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        {/* Top bar */}
        <AppBar
          position="sticky"
          elevation={0}
          sx={{
            bgcolor: 'background.paper',
            borderBottom: '1px solid',
            borderColor: 'divider',
            color: 'text.primary',
          }}
        >
          <Toolbar sx={{ gap: 1 }}>
            {isMobile && (
              <IconButton edge="start" onClick={() => setMobileOpen(true)}>
                <MenuIcon />
              </IconButton>
            )}
            <Box sx={{ flex: 1 }} />

            {/* Language selector */}
            <LanguageSwitcher />

            {/* Notification bell */}
            <IconButton onClick={openNotifications} data-testid="notifications-btn">
              <Badge badgeContent={unreadCount} color="error" max={99}>
                {/* Re-keying on the count re-fires the spring pop when a new
                    notification arrives, drawing the eye to the badge. */}
                <Box
                  component={motion.span}
                  key={unreadCount}
                  initial={{ scale: 0.6 }}
                  animate={{ scale: 1 }}
                  transition={{ type: 'spring', stiffness: 500, damping: 15 }}
                  sx={{ display: 'inline-flex' }}
                >
                  <NotificationsOutlinedIcon />
                </Box>
              </Badge>
            </IconButton>
            <Menu
              anchorEl={anchorEl}
              open={Boolean(anchorEl)}
              onClose={() => setAnchorEl(null)}
              transformOrigin={{ horizontal: 'right', vertical: 'top' }}
              anchorOrigin={{ horizontal: 'right', vertical: 'bottom' }}
              slotProps={{ paper: { sx: { width: 340, maxHeight: 420 } } }}
            >
              <Box sx={{ px: 2, py: 1.25 }}>
                <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
                  {t('notifications.title')}
                </Typography>
              </Box>
              <Divider />

              {notifications.length === 0 ? (
                <MenuItem disabled>
                  <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                    {t('notifications.empty')}
                  </Typography>
                </MenuItem>
              ) : (
                notifications.map(n => (
                  <MenuItem
                    key={n.id}
                    data-testid="notification-item"
                    onClick={() => openAppointment(n.appointment_id)}
                    sx={{
                      alignItems: 'flex-start',
                      whiteSpace: 'normal',
                      py: 1.25,
                      ...(n.read_at ? {} : { bgcolor: tint.hover }),
                    }}
                  >
                    <Box sx={{ minWidth: 0 }}>
                      <Typography variant="body2" sx={{ fontWeight: 600 }}>
                        {n.title}
                      </Typography>
                      {n.body && (
                        <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block' }}>
                          {n.body}
                        </Typography>
                      )}
                      <Typography variant="caption" sx={{ color: 'text.disabled' }}>
                        {formatDistanceToNow(new Date(n.created_at), { addSuffix: true, locale: dateLocale() })}
                      </Typography>
                    </Box>
                  </MenuItem>
                ))
              )}
            </Menu>
          </Toolbar>
        </AppBar>

        {/* Page content — AnimatedOutlet fades/slides between routes. A local
            Suspense boundary keeps the sidebar/app-bar mounted while a lazily-
            loaded page chunk resolves (only the content area shows the spinner),
            instead of the top-level full-screen fallback that blanked the whole
            dashboard on a page's first visit. */}
        <Box component="main" sx={{ flex: 1, p: { xs: 2, md: 3 } }}>
          <Suspense fallback={<LoadingState />}>
            <AnimatedOutlet context={{ refreshSignal } satisfies DashboardOutletContext} />
          </Suspense>
        </Box>
      </Box>

      {/* Unpaid-bill hard block. Mounted here rather than inside the outlet so it
          survives navigation and the Suspense fallback; the Dialog portals to
          <body>, so its position in the tree doesn't affect layout. Suppressed
          for org-less users and on the routes that let the owner settle up. */}
      <BillingBlockedDialog
        open={
          !!org
          && isBookingBlocked(billing, org.billing_status)
          && !BILLING_EXEMPT_PATHS.includes(location.pathname)
        }
      />
    </Box>
  )
}
