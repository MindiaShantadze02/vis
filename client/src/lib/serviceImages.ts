import { supabase } from '@/lib/supabase'

// Shared helpers for the single service thumbnail (services.image_url). Used by
// the admin Services settings and the onboarding services step; the public
// booking picker only reads the stored URL.

export const SERVICE_IMAGE_BUCKET = 'service-images'

/** Service photos are shown large on the booking page, so allow up to the
 *  bucket's 5 MB cap (vs. the 2 MB logo/avatar limit). */
export const MAX_SERVICE_IMAGE_BYTES = 5 * 1024 * 1024

/** Max size in MB, for the `validation.fileTooLarge` message. */
export const MAX_SERVICE_IMAGE_MB = 5

/** Validate a service image before upload. Returns a `validation.*` key suffix
 *  or null when fine — mirrors `imageFileError`, but with the larger cap. */
export function serviceImageFileError(file: File): 'invalidImage' | 'fileTooLarge' | null {
  if (!file.type.startsWith('image/')) return 'invalidImage'
  if (file.size > MAX_SERVICE_IMAGE_BYTES) return 'fileTooLarge'
  return null
}

/** Below this width a service photo is being stretched across the booking
 *  card, which is where "my photos look blurry" comes from. The card is ~1040
 *  CSS px at its widest; 1200 gives a little headroom without demanding a
 *  professional shot. */
export const RECOMMENDED_SERVICE_IMAGE_WIDTH = 1200

/**
 * The pixel size of an image file, or null if it can't be decoded. Async by
 * nature (the browser has to parse the file), so it is kept apart from the
 * synchronous `serviceImageFileError` validation.
 */
export async function imageDimensions(file: File): Promise<{ width: number; height: number } | null> {
  const url = URL.createObjectURL(file)
  try {
    return await new Promise(resolve => {
      const img = new Image()
      img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight })
      img.onerror = () => resolve(null)
      img.src = url
    })
  } finally {
    URL.revokeObjectURL(url)
  }
}

/**
 * True when this file is too small for the slot it will be shown in, i.e. the
 * browser will have to enlarge it. Nothing downstream can recover that detail —
 * the storage renderer never upscales — so the only remedy is a bigger file,
 * which is why the owner is told at upload time rather than left to notice.
 */
export async function isLowResolution(file: File): Promise<boolean> {
  const size = await imageDimensions(file)
  return !!size && size.width < RECOMMENDED_SERVICE_IMAGE_WIDTH
}

/** Upload one file to "<org>/<service>/<uuid>.<ext>" and return its public URL,
 *  or null on failure. The random filename means a replacement never collides
 *  with the outgoing thumbnail (which the caller deletes separately). Does not
 *  toast — the caller decides how to surface the outcome. */
export async function uploadServiceImage(
  orgId: string,
  serviceId: string,
  file: File,
): Promise<string | null> {
  if (serviceImageFileError(file)) return null
  const ext = (file.name.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg'
  const path = `${orgId}/${serviceId}/${crypto.randomUUID()}.${ext}`
  const { error } = await supabase.storage.from(SERVICE_IMAGE_BUCKET).upload(path, file, { upsert: false })
  if (error) return null
  const { data } = supabase.storage.from(SERVICE_IMAGE_BUCKET).getPublicUrl(path)
  return data.publicUrl
}

/** Extract the storage object path ("<org>/<service>/<uuid>.<ext>") from a
 *  stored public URL so it can be removed via the Storage API. Returns null for
 *  external/malformed URLs. */
export function serviceImagePath(url: string | null): string | null {
  if (!url) return null
  const marker = `/${SERVICE_IMAGE_BUCKET}/`
  const at = url.indexOf(marker)
  if (at === -1) return null
  return url.slice(at + marker.length).split('?')[0] || null
}

/** Best-effort delete of the underlying storage object for an image URL. The
 *  metadata row is deleted separately (or cascades); orphaned files, if any,
 *  are harmless. */
export async function removeServiceImageFile(url: string | null): Promise<void> {
  const path = serviceImagePath(url)
  if (path) await supabase.storage.from(SERVICE_IMAGE_BUCKET).remove([path])
}
