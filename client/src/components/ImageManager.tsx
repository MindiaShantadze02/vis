import { useEffect, useRef, useState } from 'react'
import { Box, Typography, CircularProgress, Alert } from '@mui/material'
import { Reorder } from 'framer-motion'
import { useTranslation } from 'react-i18next'
import {
  PhotoCameraOutlined as PhotoCameraOutlinedIcon,
  StarRounded as StarRoundedIcon,
  DeleteOutlined as DeleteOutlinedIcon,
} from '@/components/icons'
import {
  type CatalogImage,
  catalogImageFileError,
  catalogThumbUrl,
  listResourceImages,
  listOrgImages,
  uploadResourceImage,
  uploadOrgImage,
  deleteCatalogImage,
  persistImageOrder,
  setPrimaryImage,
} from '@/lib/catalogImages'

/**
 * Drag-reorder photo grid with set-primary + delete, backed by the
 * `catalog-images` bucket. Works for a room type (`resource_images`) or the org
 * property gallery (`org_images`). Uploads are compressed to WebP client-side
 * (see catalogImages.ts). framer-motion Reorder handles the drag interaction.
 */
interface ImageManagerProps {
  /** 'resource' → resource_images (needs resourceId); 'property' → org_images. */
  scope: 'resource' | 'property'
  orgId: string
  /** Required when scope === 'resource'. */
  resourceId?: string
  max: number
}

export default function ImageManager({ scope, orgId, resourceId, max }: ImageManagerProps) {
  const { t } = useTranslation()
  const table = scope === 'resource' ? 'resource_images' : 'org_images'
  const [images, setImages] = useState<CatalogImage[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    let cancelled = false
    async function run() {
      setLoading(true)
      try {
        const rows = scope === 'resource'
          ? await listResourceImages(resourceId!)
          : await listOrgImages(orgId)
        if (!cancelled) setImages(rows)
      } catch {
        if (!cancelled) setError(t('validation.loadFailed'))
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    if (scope === 'property' || resourceId) run()
    return () => { cancelled = true }
  }, [scope, orgId, resourceId, t])

  async function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) return
    setError(null)
    const room = max - images.length
    const chosen = Array.from(files).slice(0, Math.max(0, room))
    if (chosen.length === 0) { setError(t('image.maxReached', { max })); return }

    setBusy(true)
    try {
      let next = [...images]
      for (const file of chosen) {
        const fileErr = catalogImageFileError(file)
        if (fileErr) { setError(t(`validation.${fileErr}`)); continue }
        const isFirst = next.length === 0
        const row = scope === 'resource'
          ? await uploadResourceImage({ orgId, resourceId: resourceId!, file, sortOrder: next.length, isPrimary: isFirst })
          : await uploadOrgImage({ orgId, file, sortOrder: next.length, isPrimary: isFirst })
        next = [...next, row]
        setImages(next)
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : ''
      setError(msg.includes('image_limit_reached') ? t('image.maxReached', { max }) : t('validation.saveFailed'))
    } finally {
      setBusy(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  function handleReorder(next: CatalogImage[]) {
    setImages(next)
  }

  async function commitOrder() {
    try {
      await persistImageOrder(table, images.map(i => i.id))
    } catch {
      setError(t('validation.saveFailed'))
    }
  }

  async function makePrimary(img: CatalogImage) {
    if (img.is_primary) return
    setImages(prev => prev.map(i => ({ ...i, is_primary: i.id === img.id })))
    try {
      await setPrimaryImage(table, scope === 'resource' ? 'resource_id' : 'org_id', scope === 'resource' ? resourceId! : orgId, img.id)
    } catch {
      setError(t('validation.saveFailed'))
    }
  }

  async function remove(img: CatalogImage) {
    setBusy(true)
    try {
      await deleteCatalogImage(table, img)
      const remaining = images.filter(i => i.id !== img.id)
      // If we removed the primary, promote the first remaining image.
      if (img.is_primary && remaining.length > 0 && !remaining.some(i => i.is_primary)) {
        remaining[0] = { ...remaining[0], is_primary: true }
        await setPrimaryImage(table, scope === 'resource' ? 'resource_id' : 'org_id', scope === 'resource' ? resourceId! : orgId, remaining[0].id)
      }
      setImages(remaining)
    } catch {
      setError(t('validation.saveFailed'))
    } finally {
      setBusy(false)
    }
  }

  if (loading) {
    return <Box sx={{ py: 2, display: 'flex', justifyContent: 'center' }}><CircularProgress size={22} /></Box>
  }

  return (
    <Box>
      <Typography variant="body2" sx={{ fontWeight: 600, mb: 0.5 }}>{t('image.photos')}</Typography>
      <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block', mb: 1 }}>
        {t('image.photosHint', { count: images.length, max })}
      </Typography>

      {error && <Alert severity="error" sx={{ mb: 1.5 }} onClose={() => setError(null)}>{error}</Alert>}

      <Reorder.Group
        axis="y"
        values={images}
        onReorder={handleReorder}
        style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexWrap: 'wrap', gap: 12 }}
      >
        {images.map(img => (
          <Reorder.Item
            key={img.id}
            value={img}
            onDragEnd={commitOrder}
            style={{ position: 'relative', cursor: 'grab' }}
          >
            <Box
              sx={{
                width: 96, height: 96, borderRadius: 2, overflow: 'hidden',
                border: theme => `2px solid ${img.is_primary ? theme.palette.primary.main : 'transparent'}`,
                boxShadow: 1,
              }}
            >
              <Box
                component="img"
                src={catalogThumbUrl(img.storage_path)}
                alt={img.alt_text ?? ''}
                draggable={false}
                sx={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
              />
            </Box>
            {/* Set-primary (star) */}
            <Box
              role="button"
              aria-label={t('image.setPrimary')}
              onClick={() => makePrimary(img)}
              sx={{
                position: 'absolute', top: 2, left: 2, width: 24, height: 24, borderRadius: '50%',
                bgcolor: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center',
                cursor: 'pointer', color: img.is_primary ? 'warning.light' : 'common.white',
              }}
            >
              <StarRoundedIcon sx={{ fontSize: 16 }} />
            </Box>
            {/* Delete */}
            <Box
              role="button"
              aria-label={t('common.delete')}
              onClick={() => remove(img)}
              sx={{
                position: 'absolute', top: 2, right: 2, width: 24, height: 24, borderRadius: '50%',
                bgcolor: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center',
                cursor: 'pointer', color: 'common.white',
              }}
            >
              <DeleteOutlinedIcon sx={{ fontSize: 15 }} />
            </Box>
          </Reorder.Item>
        ))}

        {/* Upload tile */}
        {images.length < max && (
          <Box
            role="button"
            aria-label={t('image.addPhoto')}
            onClick={() => fileRef.current?.click()}
            sx={{
              width: 96, height: 96, borderRadius: 2, display: 'flex', flexDirection: 'column',
              alignItems: 'center', justifyContent: 'center', gap: 0.5, cursor: 'pointer',
              border: theme => `2px dashed ${theme.palette.divider}`, color: 'text.secondary',
              '&:hover': { borderColor: 'primary.main', color: 'primary.main' },
            }}
          >
            {busy ? <CircularProgress size={20} /> : <PhotoCameraOutlinedIcon sx={{ fontSize: 24 }} />}
            <Typography variant="caption">{t('image.addPhoto')}</Typography>
          </Box>
        )}
      </Reorder.Group>

      <input
        ref={fileRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        multiple
        hidden
        onChange={e => handleFiles(e.target.files)}
      />
    </Box>
  )
}
