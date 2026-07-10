import { supabase } from '@/lib/supabase'

// Shared helpers for the per-service image gallery (migration 074). Used by the
// admin Services settings, the onboarding services step, and — for reads only —
// the public booking service picker.

export const SERVICE_IMAGE_BUCKET = 'service-images'

/** How many images a single service may carry. Enforced client-side; keeps the
 *  gallery tidy and storage bounded (writes are already org-scoped by RLS). */
export const MAX_IMAGES_PER_SERVICE = 6

/** Service photos are shown large on the booking page, so allow up to the
 *  bucket's 5 MB cap (vs. the 2 MB logo/avatar limit). */
export const MAX_SERVICE_IMAGE_BYTES = 5 * 1024 * 1024

/** Max size in MB, for the `validation.fileTooLarge` message. */
export const MAX_SERVICE_IMAGE_MB = 5

export interface ServiceImage {
  id: string
  service_id: string
  url: string
  sort_order: number
}

/** Validate a service image before upload. Returns a `validation.*` key suffix
 *  or null when fine — mirrors `imageFileError`, but with the larger cap. */
export function serviceImageFileError(file: File): 'invalidImage' | 'fileTooLarge' | null {
  if (!file.type.startsWith('image/')) return 'invalidImage'
  if (file.size > MAX_SERVICE_IMAGE_BYTES) return 'fileTooLarge'
  return null
}

/** Upload one file to "<org>/<service>/<uuid>.<ext>" and return its public URL,
 *  or null on failure. A random filename means uploads never collide, so a
 *  service can hold several images without overwriting. Does not toast — the
 *  caller decides how to surface the outcome. */
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
