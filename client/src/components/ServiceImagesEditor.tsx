import { useRef } from 'react'
import { Box, Typography, CircularProgress } from '@mui/material'
import { Add as AddIcon, Close as CloseIcon } from '@/components/icons'
import { useTranslation } from 'react-i18next'
import { MAX_IMAGES_PER_SERVICE } from '@/lib/serviceImages'

// Presentational gallery editor shared by the admin Services dialog and the
// onboarding services step. It owns no persistence — the parent supplies the
// current images (each with a stable key and a displayable url, which may be a
// blob: preview or a stored URL) and handles add/remove. Uploading is a spinner
// on the add tile.

export interface EditorImage {
  key: string
  url: string
}

interface Props {
  images: EditorImage[]
  uploading?: boolean
  onAdd: (files: File[]) => void
  onRemove: (key: string) => void
  max?: number
  'data-testid'?: string
}

const TILE = 72

export default function ServiceImagesEditor({
  images, uploading = false, onAdd, onRemove, max = MAX_IMAGES_PER_SERVICE, ...rest
}: Props) {
  const { t } = useTranslation()
  const ref = useRef<HTMLInputElement>(null)
  const atMax = images.length >= max

  return (
    <Box data-testid={rest['data-testid']}>
      <Typography variant="body2" sx={{ fontWeight: 600, mb: 0.5 }}>
        {t('settings.serviceImages')}
      </Typography>
      <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block', mb: 1 }}>
        {t('settings.serviceImagesHelp', { max })}
      </Typography>

      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
        {images.map(img => (
          <Box
            key={img.key}
            sx={{
              position: 'relative', width: TILE, height: TILE,
              borderRadius: 1.5, overflow: 'hidden',
              border: '1px solid', borderColor: 'divider',
            }}
          >
            <Box
              component="img"
              src={img.url}
              alt=""
              sx={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
            />
            <Box
              onClick={() => onRemove(img.key)}
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
        ))}

        {!atMax && (
          <Box
            onClick={() => !uploading && ref.current?.click()}
            role="button"
            aria-label={t('settings.addServiceImages')}
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
      </Box>

      <input
        ref={ref}
        type="file"
        accept="image/*"
        multiple
        style={{ display: 'none' }}
        data-testid="service-image-input"
        onChange={e => {
          const files = Array.from(e.target.files ?? [])
          if (files.length) onAdd(files)
          e.target.value = ''
        }}
      />
    </Box>
  )
}
