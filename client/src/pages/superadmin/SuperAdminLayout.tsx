import { Outlet } from 'react-router-dom'
import { Box, Typography } from '@mui/material'

export default function SuperAdminLayout() {
  return (
    <Box sx={{ display: 'flex', minHeight: '100vh' }}>
      <Box component="aside" sx={{ width: 240, bgcolor: '#1a1a2e', color: 'white', p: 2 }}>
        <Typography variant="h6" sx={{ fontWeight: 700 }}>Grafiki · ადმინი</Typography>
      </Box>
      <Box component="main" sx={{ flex: 1, p: 3 }}>
        <Outlet />
      </Box>
    </Box>
  )
}
