import { useRef } from 'react'
import { Box, Typography, CircularProgress } from '@mui/material'
import { Add as AddIcon, Close as CloseIcon } from '@/components/icons'
import { useTranslation } from 'react-i18next'
import { SkeletonImage } from '@/components/ui'

// Presentational thumbnail picker shared by the admin Services dialog and the
// onboarding services step. It owns no persistence — the parent supplies the
// current image url (a blob: preview while staged, or the stored URL) and
// handles pick/remove. Uploading is a spinner on the tile.
//
// Replaces the multi-image gallery editor: a service carries one photo.

interface Props {
  /** Current thumbnail, or null when the service has none yet. */
  url: string | null
  uploading?: boolean
  onPick: (file: File) => void
  onRemove: () => void
  'data-testid'?: string
}

const TILE = 72

export default function ServiceThumbnailPicker({
  url, uploading = false, onPick, onRemove, ...rest
}: Props) {
  const { t } = useTranslation()
  const ref = useRef<HTMLInputElement>(null)

  return (
    <Box data-testid={rest['data-testid']}>
      <Typography variant="body2" sx={{ fontWeight: 600, mb: 0.5 }}>
        {t('settings.serviceImage')}
      </Typography>
      <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block', mb: 1 }}>
        {t('settings.serviceImageHelp')}
      </Typography>

      {url ? (
        <Box
          sx={{
            position: 'relative', width: TILE, height: TILE,
            borderRadius: 1.5, overflow: 'hidden',
            border: '1px solid', borderColor: 'divider',
          }}
        >
          <SkeletonImage src={url} alt="" sx={{ width: '100%', height: '100%' }} />
          <Box
            onClick={onRemove}
            role="button"
            aria-label={t('common.delete')}
            data-testid="service-image-remove"
            sx={{
              position: 'absolute', top: 2, right: 2,
              width: 20, height: 20, borderRadius: '50%',
              bgcolor: 'rgba(0,0,0,0.55)', color: '#fff',
              display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer',
              '&:hover': { bgcolor: 'rgba(0,0,0,0.75)' },
            }}
          >
            <CloseIcon sx={{ fontSize: 13 }} />
          </Box>
        </Box>
      ) : (
        <Box
          onClick={() => !uploading && ref.current?.click()}
          role="button"
          aria-label={t('settings.addServiceImage')}
          data-testid="service-image-add"
          sx={{
            width: TILE, height: TILE, borderRadius: 1.5,
            border: '1px dashed', borderColor: 'divider',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            cursor: uploading ? 'default' : 'pointer', color: 'text.secondary',
            '&:hover': { borderColor: 'primary.main', color: 'primary.main' },
          }}
        >
          {uploading ? <CircularProgress size={18} /> : <AddIcon />}
        </Box>
      )}

      <input
        ref={ref}
        type="file"
        accept="image/*"
        style={{ display: 'none' }}
        data-testid="service-image-input"
        onChange={e => {
          const file = e.target.files?.[0]
          if (file) onPick(file)
          e.target.value = ''
        }}
      />
    </Box>
  )
}
