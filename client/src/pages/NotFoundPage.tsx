import { Box, Button, Typography } from '@mui/material'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { SearchOffOutlined as SearchOffOutlinedIcon } from '@/components/icons'
import { EmptyState } from '@/components/ui'
import { useDocumentMeta } from '@/lib/seo'

// Catch-all 404. Replaces the old silent redirect to '/' so a mistyped or dead
// link reads as "not found" instead of bouncing the user to login.
// NOTE: the SPA catch-all rewrite still serves HTTP 200 for unknown paths —
// the client-side noindex below is the best we can signal without SSR.
export default function NotFoundPage() {
  const navigate = useNavigate()
  const { t } = useTranslation()
  useDocumentMeta({ title: t('seo.notFoundTitle'), noindex: true })

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
