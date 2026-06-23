import { Outlet, NavLink, useNavigate } from 'react-router-dom'
import {
  Box, List, ListItemButton, ListItemIcon, ListItemText,
  Typography, Divider,
} from '@mui/material'
import InsightsOutlinedIcon from '@mui/icons-material/InsightsOutlined'
import StorefrontOutlinedIcon from '@mui/icons-material/StorefrontOutlined'
import AdminPanelSettingsOutlinedIcon from '@mui/icons-material/AdminPanelSettingsOutlined'
import ArrowBackIosNewIcon from '@mui/icons-material/ArrowBackIosNew'
import LogoutIcon from '@mui/icons-material/Logout'
import { supabase } from '@/lib/supabase'
import { gradient, elevation } from '@/theme/theme'

const DRAWER_WIDTH = 240

const NAV_ITEMS = [
  { label: 'მიმოხილვა',      path: '/superadmin',        icon: <InsightsOutlinedIcon />,            end: true },
  { label: 'ორგანიზაციები',  path: '/superadmin/orgs',   icon: <StorefrontOutlinedIcon />,          end: false },
  { label: 'სუპერ-ადმინები', path: '/superadmin/admins', icon: <AdminPanelSettingsOutlinedIcon />,  end: false },
]

export default function SuperAdminLayout() {
  const navigate = useNavigate()

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

  return (
    <Box sx={{ display: 'flex', minHeight: '100vh' }}>
      <Box
        component="aside"
        sx={{
          width: DRAWER_WIDTH, flexShrink: 0,
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
            <Typography sx={{ color: 'white', fontWeight: 800, fontSize: 14, lineHeight: 1 }}>G</Typography>
          </Box>
          <Box>
            <Typography variant="subtitle2" sx={{ fontWeight: 800, lineHeight: 1.1 }}>Grafiki</Typography>
            <Typography variant="caption" sx={{ color: 'rgba(255,255,255,0.6)' }}>სუპერ-ადმინი</Typography>
          </Box>
        </Box>

        {/* Nav */}
        <List sx={{ flex: 1 }}>
          {NAV_ITEMS.map(item => (
            <NavLink key={item.path} to={item.path} end={item.end} style={{ textDecoration: 'none' }}>
              {({ isActive }) => (
                <ListItemButton sx={navItemSx(isActive)}>
                  <ListItemIcon>{item.icon}</ListItemIcon>
                  <ListItemText primary={item.label} primaryTypographyProps={{ fontSize: 14, fontWeight: 600 }} />
                </ListItemButton>
              )}
            </NavLink>
          ))}
        </List>

        <Divider sx={{ borderColor: 'rgba(255,255,255,0.12)', my: 1 }} />

        <ListItemButton sx={navItemSx(false)} onClick={() => navigate('/dashboard')}>
          <ListItemIcon><ArrowBackIosNewIcon sx={{ fontSize: 18 }} /></ListItemIcon>
          <ListItemText primary="დაშბორდზე დაბრუნება" primaryTypographyProps={{ fontSize: 13 }} />
        </ListItemButton>
        <ListItemButton sx={navItemSx(false)} onClick={handleLogout}>
          <ListItemIcon><LogoutIcon sx={{ fontSize: 18 }} /></ListItemIcon>
          <ListItemText primary="გასვლა" primaryTypographyProps={{ fontSize: 13 }} />
        </ListItemButton>
      </Box>

      <Box component="main" sx={{ flex: 1, p: { xs: 2, md: 4 }, bgcolor: 'background.default', minWidth: 0 }}>
        <Outlet />
      </Box>
    </Box>
  )
}
