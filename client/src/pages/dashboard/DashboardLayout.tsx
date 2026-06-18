import { useState } from 'react'
import { Outlet, NavLink, useNavigate } from 'react-router-dom'
import {
  Box, Drawer, List, ListItemButton, ListItemIcon, ListItemText,
  AppBar, Toolbar, IconButton, Typography, Badge, Avatar,
  Menu, MenuItem, Divider, useMediaQuery, useTheme, Tooltip,
} from '@mui/material'
import DashboardOutlinedIcon from '@mui/icons-material/DashboardOutlined'
import CalendarMonthOutlinedIcon from '@mui/icons-material/CalendarMonthOutlined'
import SettingsOutlinedIcon from '@mui/icons-material/SettingsOutlined'
import NotificationsOutlinedIcon from '@mui/icons-material/NotificationsOutlined'
import MenuIcon from '@mui/icons-material/Menu'
import LogoutIcon from '@mui/icons-material/Logout'
import { useTranslation } from 'react-i18next'
import { supabase } from '@/lib/supabase'
import { useOrg } from '@/contexts/OrgContext'
import { useAuth } from '@/contexts/AuthContext'
import { anim } from '@/theme/animations'
import { gradient, elevation, tint } from '@/theme/theme'

const DRAWER_WIDTH = 240

const NAV_ITEMS = [
  { labelKey: 'dashboard.overview',     path: '/dashboard',              icon: <DashboardOutlinedIcon /> },
  { labelKey: 'dashboard.calendar',     path: '/dashboard/calendar',     icon: <CalendarMonthOutlinedIcon /> },
]

const SETTINGS_ITEMS = [
  { labelKey: 'settings.profile',      path: '/dashboard/settings/profile' },
  { labelKey: 'settings.services',     path: '/dashboard/settings/services' },
  { labelKey: 'settings.workingHours', path: '/dashboard/settings/hours' },
  { labelKey: 'settings.team',         path: '/dashboard/settings/team' },
  { labelKey: 'settings.payment',      path: '/dashboard/settings/payment' },
  { labelKey: 'settings.subscription', path: '/dashboard/settings/subscription' },
]

export default function DashboardLayout() {
  const { t } = useTranslation()
  const theme = useTheme()
  const isMobile = useMediaQuery(theme.breakpoints.down('md'))
  const { org } = useOrg()
  const { user } = useAuth()
  const navigate = useNavigate()

  const [mobileOpen, setMobileOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null)

  async function handleLogout() {
    await supabase.auth.signOut()
    navigate('/login')
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
            <Typography sx={{ color: 'white', fontWeight: 800, fontSize: 14, lineHeight: 1 }}>G</Typography>
          </Box>
          <Typography variant="h6" sx={{ fontWeight: 800, color: 'text.primary', letterSpacing: '-0.3px' }}>
            Grafiki
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
        {(org ? NAV_ITEMS : NAV_ITEMS.filter(item => item.path === '/dashboard')).map((item, i) => (
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

        {settingsOpen && SETTINGS_ITEMS.map((item, i) => (
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
      </List>

      <Divider />

      {/* User row */}
      <Box sx={{ px: 2, py: 2, display: 'flex', alignItems: 'center', gap: 1 }}>
        <Avatar sx={{ width: 32, height: 32, fontSize: 13 }}>
          {user?.email?.slice(0, 2).toUpperCase() ?? '?'}
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
          {user?.email ?? ''}
        </Typography>
        <Tooltip title="გასვლა">
          <IconButton size="small" onClick={handleLogout} data-testid="logout-btn">
            <LogoutIcon fontSize="small" />
          </IconButton>
        </Tooltip>
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

            {/* Notification bell */}
            <IconButton onClick={e => setAnchorEl(e.currentTarget)}>
              <Badge badgeContent={0} color="error">
                <NotificationsOutlinedIcon />
              </Badge>
            </IconButton>
            <Menu
              anchorEl={anchorEl}
              open={Boolean(anchorEl)}
              onClose={() => setAnchorEl(null)}
              transformOrigin={{ horizontal: 'right', vertical: 'top' }}
              anchorOrigin={{ horizontal: 'right', vertical: 'bottom' }}
              slotProps={{ paper: { sx: { width: 320, maxHeight: 400 } } }}
            >
              <MenuItem disabled>
                <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                  შეტყობინებები არ არის
                </Typography>
              </MenuItem>
            </Menu>
          </Toolbar>
        </AppBar>

        {/* Page content */}
        <Box component="main" sx={{ flex: 1, p: { xs: 2, md: 3 }, animation: anim.fadeInUp }}>
          <Outlet />
        </Box>
      </Box>
    </Box>
  )
}
