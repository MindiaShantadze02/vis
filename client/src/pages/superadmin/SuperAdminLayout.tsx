import { useState } from 'react'
import { NavLink, useNavigate } from 'react-router-dom'
import {
  Box, List, ListItemButton, ListItemIcon, ListItemText,
  Typography, Divider, Drawer, AppBar, Toolbar, IconButton,
} from '@mui/material'
import { InsightsOutlined as InsightsOutlinedIcon } from '@/components/icons'
import { StorefrontOutlined as StorefrontOutlinedIcon } from '@/components/icons'
import { AdminPanelSettingsOutlined as AdminPanelSettingsOutlinedIcon } from '@/components/icons'
import { ArrowBackIosNew as ArrowBackIosNewIcon } from '@/components/icons'
import { Logout as LogoutIcon } from '@/components/icons'
import { Menu as MenuIcon } from '@/components/icons'
import { supabase } from '@/lib/supabase'
import { useBreakpoints } from '@/hooks/useBreakpoints'
import { AnimatedOutlet } from '@/components/ui'
import { gradient, elevation } from '@/theme/theme'

const DRAWER_WIDTH = 240

const NAV_ITEMS = [
  { label: 'მიმოხილვა',      path: '/superadmin',        icon: <InsightsOutlinedIcon />,            end: true },
  { label: 'ორგანიზაციები',  path: '/superadmin/orgs',   icon: <StorefrontOutlinedIcon />,          end: false },
  { label: 'სუპერ-ადმინები', path: '/superadmin/admins', icon: <AdminPanelSettingsOutlinedIcon />,  end: false },
]

export default function SuperAdminLayout() {
  const navigate = useNavigate()
  const { isCompact } = useBreakpoints()
  const [mobileOpen, setMobileOpen] = useState(false)

  async function handleLogout() {
    await supabase.auth.signOut()
    navigate('/login')
  }

  const navItemSx = (active: boolean) => ({
    borderRadius: 2,
    mb: 0.5,
    color: active ? 'white' : 'rgba(255,255,255,0.75)',
    bgcolor: active ? 'rgba(255,255,255,0.12)' : 'transparent',
    '&:hover': { bgcolor: 'rgba(255,255,255,0.08)' },
    '& .MuiListItemIcon-root': { color: 'inherit', minWidth: 38 },
  })

  const sidebar = (
    <Box
      sx={{
        width: DRAWER_WIDTH, height: '100%',
        bgcolor: '#15182b', color: 'white',
        display: 'flex', flexDirection: 'column',
        px: 1.5, py: 2.5,
      }}
    >
      {/* Brand */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, px: 1, mb: 3 }}>
        <Box
          sx={{
            width: 32, height: 32, borderRadius: '10px',
            background: gradient.brand,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            boxShadow: elevation.glowSoft, flexShrink: 0,
          }}
        >
          <Typography sx={{ color: 'white', fontWeight: 800, fontSize: 14, lineHeight: 1 }}>V</Typography>
        </Box>
        <Box>
          <Typography variant="subtitle2" sx={{ fontWeight: 800, lineHeight: 1.1 }}>Vis</Typography>
          <Typography variant="caption" sx={{ color: 'rgba(255,255,255,0.6)' }}>სუპერ-ადმინი</Typography>
        </Box>
      </Box>

      {/* Nav */}
      <List sx={{ flex: 1 }}>
        {NAV_ITEMS.map(item => (
          <NavLink key={item.path} to={item.path} end={item.end} style={{ textDecoration: 'none' }} onClick={() => setMobileOpen(false)}>
            {({ isActive }) => (
              <ListItemButton sx={navItemSx(isActive)}>
                <ListItemIcon>{item.icon}</ListItemIcon>
                <ListItemText primary={item.label} slotProps={{ primary: { sx: { fontSize: 14, fontWeight: 600 } } }} />
              </ListItemButton>
            )}
          </NavLink>
        ))}
      </List>

      <Divider sx={{ borderColor: 'rgba(255,255,255,0.12)', my: 1 }} />

      <ListItemButton sx={navItemSx(false)} onClick={() => navigate('/dashboard')}>
        <ListItemIcon><ArrowBackIosNewIcon sx={{ fontSize: 18 }} /></ListItemIcon>
        <ListItemText primary="დაშბორდზე დაბრუნება" slotProps={{ primary: { sx: { fontSize: 13 } } }} />
      </ListItemButton>
      <ListItemButton sx={navItemSx(false)} onClick={handleLogout}>
        <ListItemIcon><LogoutIcon sx={{ fontSize: 18 }} /></ListItemIcon>
        <ListItemText primary="გასვლა" slotProps={{ primary: { sx: { fontSize: 13 } } }} />
      </ListItemButton>
    </Box>
  )

  return (
    <Box sx={{ display: 'flex', minHeight: '100vh' }}>
      {/* Desktop sidebar */}
      {!isCompact && (
        <Box component="aside" sx={{ flexShrink: 0 }}>
          {sidebar}
        </Box>
      )}

      {/* Mobile drawer */}
      {isCompact && (
        <Drawer
          open={mobileOpen}
          onClose={() => setMobileOpen(false)}
          ModalProps={{ keepMounted: true }}
          sx={{ '& .MuiDrawer-paper': { border: 0 } }}
        >
          {sidebar}
        </Drawer>
      )}

      <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        {/* Mobile top bar with hamburger */}
        {isCompact && (
          <AppBar
            position="sticky"
            elevation={0}
            sx={{ bgcolor: 'background.paper', borderBottom: '1px solid', borderColor: 'divider', color: 'text.primary' }}
          >
            <Toolbar>
              <IconButton edge="start" onClick={() => setMobileOpen(true)} aria-label="menu">
                <MenuIcon />
              </IconButton>
            </Toolbar>
          </AppBar>
        )}

        <Box component="main" sx={{ flex: 1, p: { xs: 2, md: 4 }, bgcolor: 'background.default', minWidth: 0 }}>
          <AnimatedOutlet />
        </Box>
      </Box>
    </Box>
  )
}
