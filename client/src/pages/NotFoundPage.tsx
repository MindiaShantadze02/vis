import { Box, Button, Typography } from '@mui/material'
import { useNavigate } from 'react-router-dom'
import SearchOffOutlinedIcon from '@mui/icons-material/SearchOffOutlined'
import { EmptyState } from '@/components/ui'

// Catch-all 404. Replaces the old silent redirect to '/' so a mistyped or dead
// link reads as "not found" instead of bouncing the user to login.
export default function NotFoundPage() {
  const navigate = useNavigate()

  return (
    <Box
      sx={{
        minHeight: '100vh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        bgcolor: 'background.default',
        p: 2,
      }}
    >
      <Typography
        sx={{ fontWeight: 800, fontSize: '5rem', lineHeight: 1, color: 'primary.main', letterSpacing: '-2px' }}
      >
        404
      </Typography>
      <EmptyState
        icon={<SearchOffOutlinedIcon />}
        title="გვერდი ვერ მოიძებნა"
        caption="შესაძლოა მისამართი არასწორია ან გვერდი აღარ არსებობს."
        action={
          <Button variant="contained" onClick={() => navigate('/')} data-testid="notfound-home">
            მთავარ გვერდზე დაბრუნება
          </Button>
        }
      />
    </Box>
  )
}
