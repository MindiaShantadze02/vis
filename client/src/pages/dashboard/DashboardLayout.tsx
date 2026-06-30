import { useState } from 'react'
import { NavLink, useNavigate } from 'react-router-dom'

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
  AppBar, Toolbar, IconButton, Typography, Badge, Avatar,
  Menu, MenuItem, Divider, useMediaQuery, useTheme,
} from '@mui/material'
import DashboardOutlinedIcon from '@mui/icons-material/DashboardOutlined'
import CalendarMonthOutlinedIcon from '@mui/icons-material/CalendarMonthOutlined'
import SettingsOutlinedIcon from '@mui/icons-material/SettingsOutlined'
import AdminPanelSettingsOutlinedIcon from '@mui/icons-material/AdminPanelSettingsOutlined'
import NotificationsOutlinedIcon from '@mui/icons-material/NotificationsOutlined'
import MenuIcon from '@mui/icons-material/Menu'
import LogoutIcon from '@mui/icons-material/Logout'
import PersonOutlineIcon from '@mui/icons-material/Person2Outlined'
import { formatDistanceToNow } from 'date-fns'
import { motion } from 'framer-motion'
import { useTranslation } from 'react-i18next'
import { supabase } from '@/lib/supabase'
import { useOrg } from '@/contexts/OrgContext'
import { useAuth } from '@/contexts/AuthContext'
import { useSuperadmin } from '@/hooks/useSuperadmin'
import { useNotifications } from '@/hooks/useNotifications'
import { LanguageSwitcher, AnimatedOutlet } from '@/components/ui'
import { dateLocale } from '@/lib/dateLocale'
import { displayGeorgianPhone } from '@/lib/validation'
import { anim } from '@/theme/animations'
import { gradient, elevation, tint } from '@/theme/theme'

const DRAWER_WIDTH = 240

const NAV_ITEMS = [
  { labelKey: 'dashboard.overview',     path: '/dashboard',              icon: <DashboardOutlinedIcon /> },
  { labelKey: 'dashboard.calendar',     path: '/dashboard/calendar',     icon: <CalendarMonthOutlinedIcon /> },
]

import type { SettingsNavId } from '@/lib/verticals'
import { useVertical } from '@/lib/verticals'

// Settings sections keyed by stable id. Which ones (and their order) appear is
// decided per vertical via VerticalConfig.settingsNav — so a restaurant sees
// "Tables" instead of "Services"/"Team", while appointments are unchanged.
const SETTINGS_ITEMS: Record<SettingsNavId, { labelKey: string; path: string }> = {
  profile:      { labelKey: 'settings.profile',      path: '/dashboard/settings/profile' },
  services:     { labelKey: 'settings.services',     path: '/dashboard/settings/services' },
  tables:       { labelKey: 'restaurant.tables',     path: '/dashboard/settings/tables' },
  rooms:        { labelKey: 'hotel.rooms',           path: '/dashboard/settings/rooms' },
  hours:        { labelKey: 'settings.workingHours', path: '/dashboard/settings/hours' },
  team:         { labelKey: 'settings.team',         path: '/dashboard/settings/team' },
  payment:      { labelKey: 'settings.payment',      path: '/dashboard/settings/payment' },
  subscription: { labelKey: 'settings.subscription', path: '/dashboard/settings/subscription' },
}

export default function DashboardLayout() {
  const { t } = useTranslation()
  const theme = useTheme()
  const isMobile = useMediaQuery(theme.breakpoints.down('md'))
  const { org } = useOrg()
  const vertical = useVertical()
  // The settings sections (and their order) shown for this org's vertical.
  // filter(Boolean) tolerates ids without a built section yet (e.g. hotel 'rooms').
  const settingsItems = vertical.settingsNav
    .map(id => SETTINGS_ITEMS[id])
    .filter(Boolean)
  // The week-calendar is appointment-specific; hide it for verticals that don't use it.
  const mainNav = NAV_ITEMS.filter(item =>
    item.path === '/dashboard/calendar' ? vertical.showCalendar : true,
  )
  const { user } = useAuth()
  const { isSuperadmin } = useSuperadmin()
  const navigate = useNavigate()
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
    // The overview lists pending requests first; that's where an admin acts on
    // a booking. (We don't deep-link to a single appointment yet.)
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
        <Box onClick={() => navigate('/dashboard')} sx={{ display: 'flex', alignItems: 'center', gap: 1.5, cursor: 'pointer' }}>
          <Box
            sx={{
              width: 32, height: 32, borderRadius: '10px',
              background: gradient.brand,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              boxShadow: elevation.glowSoft,
              flexShrink: 0,
            }}
          >
            <Typography sx={{ color: 'white', fontWeight: 800, fontSize: 14, lineHeight: 1 }}>V</Typography>
          </Box>
          <Typography variant="h6" sx={{ fontWeight: 800, color: 'text.primary', letterSpacing: '-0.3px' }}>
            Vis
          </Typography>
        </Box>
        {org && (
          <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block', mt: 0.5, pl: '44px' }}>
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
                bgcolor: 'secondary.main',
                color: 'primary.dark',
                borderLeftColor: 'primary.main',
                '& .MuiListItemIcon-root': { color: 'primary.main' },
              },
              '&:not(.active):hover': {
                bgcolor: tint.hover,
                borderLeftColor: tint.hoverBorder,
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

        {settingsOpen && settingsItems.map((item, i) => (
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
                bgcolor: 'secondary.main',
                color: 'primary.dark',
                borderLeftColor: 'primary.main',
              },
              '&:not(.active):hover': {
                bgcolor: tint.hover,
                borderLeftColor: tint.hoverBorder,
              },
            }}
          >
            <ListItemText primary={t(item.labelKey)} slotProps={{ primary: { variant: 'body2' } }} />
          </ListItemButton>
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

      <Divider />

      {/* User identity row (logout now lives in the nav above). */}
      <Box sx={{ px: 2, py: 2, display: 'flex', alignItems: 'center', gap: 1 }}>
        <Avatar sx={{ width: 32, height: 32 }}>
          <PersonOutlineIcon fontSize="small" />
        </Avatar>
        <Typography
          variant="caption"
          sx={{
            flex: 1,
            color: 'text.secondary',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {displayGeorgianPhone(user?.phone)}
        </Typography>
      </Box>
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

        {/* Page content — AnimatedOutlet fades/slides between routes. */}
        <Box component="main" sx={{ flex: 1, p: { xs: 2, md: 3 } }}>
          <AnimatedOutlet context={{ refreshSignal } satisfies DashboardOutletContext} />
        </Box>
      </Box>
    </Box>
  )
}
