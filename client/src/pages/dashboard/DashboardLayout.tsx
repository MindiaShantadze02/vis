import { useState } from 'react'
import { Outlet, NavLink, useNavigate } from 'react-router-dom'
import {
  Box, Drawer, List, ListItemButton, ListItemIcon, ListItemText,
  AppBar, Toolbar, IconButton, Typography, Badge, Avatar,
  Menu, MenuItem, Divider, useMediaQuery, useTheme, Tooltip,
} from '@mui/material'
import DashboardOutlinedIcon from '@mui/icons-material/DashboardOutlined'
import CalendarMonthOutlinedIcon from '@mui/icons-material/CalendarMonthOutlined'
import EventNoteOutlinedIcon from '@mui/icons-material/EventNoteOutlined'
import SettingsOutlinedIcon from '@mui/icons-material/SettingsOutlined'
import NotificationsOutlinedIcon from '@mui/icons-material/NotificationsOutlined'
import MenuIcon from '@mui/icons-material/Menu'
import LogoutIcon from '@mui/icons-material/Logout'
import { useTranslation } from 'react-i18next'
import { supabase } from '@/lib/supabase'
import { useOrg } from '@/contexts/OrgContext'
import { useAuth } from '@/contexts/AuthContext'

const DRAWER_WIDTH = 240

const NAV_ITEMS = [
  { labelKey: 'dashboard.overview',     path: '/dashboard',             icon: <DashboardOutlinedIcon /> },
  { labelKey: 'dashboard.calendar',     path: '/dashboard/calendar',    icon: <CalendarMonthOutlinedIcon /> },
  { labelKey: 'dashboard.appointments', path: '/dashboard/appointments',icon: <EventNoteOutlinedIcon /> },
]

const SETTINGS_ITEMS = [
  { label: 'პროფილი',        path: '/dashboard/settings/profile' },
  { label: 'სერვისები',      path: '/dashboard/settings/services' },
  { label: 'სამ. საათები',   path: '/dashboard/settings/hours' },
  { label: 'გუნდი',          path: '/dashboard/settings/team' },
  { label: 'გადახდა',        path: '/dashboard/settings/payment' },
  { label: 'გამოწერა',       path: '/dashboard/settings/subscription' },
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
      <Box sx={{ px: 3, py: 3 }}>
        <Typography variant="h6" sx={{ fontWeight: 800, color: 'primary.main', letterSpacing: '-0.5px' }}>
          Grafiki
        </Typography>
        {org && (
          <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block', mt: 0.25 }}>
            {org.name}
          </Typography>
        )}
      </Box>

      <Divider />

      {/* Main nav */}
      <List sx={{ px: 1, pt: 1, flex: 1 }}>
        {NAV_ITEMS.map(item => (
          <ListItemButton
            key={item.path}
            component={NavLink}
            to={item.path}
            end={item.path === '/dashboard'}
            onClick={() => setMobileOpen(false)}
            sx={{
              borderRadius: 2,
              mb: 0.5,
              '&.active': {
                bgcolor: 'primary.main',
                color: 'white',
                '& .MuiListItemIcon-root': { color: 'white' },
              },
              '&:not(.active):hover': { bgcolor: 'action.hover' },
            }}
          >
            <ListItemIcon sx={{ minWidth: 36 }}>{item.icon}</ListItemIcon>
            <ListItemText primary={t(item.labelKey)} primaryTypographyProps={{ variant: 'body2', fontWeight: 500 }} />
          </ListItemButton>
        ))}

        {/* Settings section */}
        <ListItemButton
          onClick={() => setSettingsOpen(o => !o)}
          sx={{ borderRadius: 2, mb: 0.5 }}
        >
          <ListItemIcon sx={{ minWidth: 36 }}><SettingsOutlinedIcon /></ListItemIcon>
          <ListItemText primary={t('dashboard.settings')} primaryTypographyProps={{ variant: 'body2', fontWeight: 500 }} />
        </ListItemButton>

        {settingsOpen && SETTINGS_ITEMS.map(item => (
          <ListItemButton
            key={item.path}
            component={NavLink}
            to={item.path}
            onClick={() => setMobileOpen(false)}
            sx={{
              borderRadius: 2,
              mb: 0.25,
              pl: 4,
              '&.active': { bgcolor: 'secondary.main', color: 'primary.main' },
            }}
          >
            <ListItemText primary={item.label} primaryTypographyProps={{ variant: 'body2' }} />
          </ListItemButton>
        ))}
      </List>

      <Divider />

      {/* User row */}
      <Box sx={{ px: 2, py: 2, display: 'flex', alignItems: 'center', gap: 1 }}>
        <Avatar sx={{ width: 32, height: 32, bgcolor: 'primary.main', fontSize: 14 }}>
          {user?.email?.slice(0, 2).toUpperCase() ?? '?'}
        </Avatar>
        <Typography variant="caption" sx={{ flex: 1, color: 'text.secondary', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {user?.email ?? ''}
        </Typography>
        <Tooltip title="გასვლა">
          <IconButton size="small" onClick={handleLogout}>
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
            bgcolor: 'background.paper',
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
          sx={{ '& .MuiDrawer-paper': { width: DRAWER_WIDTH } }}
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
        <Box component="main" sx={{ flex: 1, p: { xs: 2, md: 3 } }}>
          <Outlet />
        </Box>
      </Box>
    </Box>
  )
}
