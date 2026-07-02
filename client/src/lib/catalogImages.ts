/**
 * Catalog images — generic photo upload/management keyed to `resources`
 * (room types now; tables/services later) plus an org-level property gallery.
 *
 * Photos live in the public `catalog-images` storage bucket; metadata rows live
 * in `resource_images` / `org_images` (migration 054). We compress client-side
 * to WebP before upload (main ~1600px + a ~400px thumbnail) so the booking page
 * stays fast and storage/bandwidth stay small — no server work, no paid image
 * transforms. See the plan: this deliberately mirrors the logo-upload pattern in
 * ProfileSettings.tsx but supports multiple ordered images per resource.
 *
 * Path convention (first path segment = org id, enforced by storage RLS):
 *   {org_id}/rooms/{resource_id}/{uuid}.webp        (+ ..._thumb.webp)
 *   {org_id}/property/{uuid}.webp                   (+ ..._thumb.webp)
 */
import imageCompression from 'browser-image-compression'
import { supabase } from './supabase'

const BUCKET = 'catalog-images'

/** Accepted source types. We always re-encode to WebP regardless. */
const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp']
/** Source-file cap (pre-compression). Compression brings it well under the 5 MB bucket cap. */
const MAX_SOURCE_BYTES = 15 * 1024 * 1024
/** Default per-resource image cap. Tier-gating is a later phase; this is the hard UI ceiling. */
export const MAX_IMAGES_PER_RESOURCE = 10
export const MAX_IMAGES_PER_ORG = 12

const MAIN_MAX_DIM = 1600
const THUMB_MAX_DIM = 400

export interface CatalogImage {
  id: string
  created_at: string
  org_id: string
  storage_path: string
  sort_order: number
  is_primary: boolean
  alt_text: string | null
  width: number | null
  height: number | null
  /** Present on resource_images rows only. */
  resource_id?: string
}

/**
 * Validate a source file before compressing/uploading. Returns a `validation.*`
 * i18n key suffix (same convention as imageFileError in validation.ts) or null.
 */
export function catalogImageFileError(file: File): 'invalidImage' | 'fileTooLarge' | null {
  if (!ALLOWED_TYPES.includes(file.type)) return 'invalidImage'
  if (file.size > MAX_SOURCE_BYTES) return 'fileTooLarge'
  return null
}

/** Public download URL for a stored object. */
export function catalogImageUrl(storagePath: string): string {
  return supabase.storage.from(BUCKET).getPublicUrl(storagePath).data.publicUrl
}

/** Derive the thumbnail object key that sits alongside a main image. */
export function thumbPath(storagePath: string): string {
  return storagePath.replace(/\.webp$/, '_thumb.webp')
}

/** Public URL of the small thumbnail variant (falls back to main if none). */
export function catalogThumbUrl(storagePath: string): string {
  return catalogImageUrl(thumbPath(storagePath))
}

async function toWebp(file: File, maxDim: number): Promise<{ blob: Blob; width: number; height: number }> {
  const blob = await imageCompression(file, {
    maxWidthOrHeight: maxDim,
    useWebWorker: true,
    fileType: 'image/webp',
    initialQuality: 0.82,
  })
  // Read intrinsic dimensions of the compressed result for the metadata row.
  const dims = await readDimensions(blob)
  return { blob, ...dims }
}

function readDimensions(blob: Blob): Promise<{ width: number; height: number }> {
  return new Promise(resolve => {
    const url = URL.createObjectURL(blob)
    const img = new Image()
    img.onload = () => {
      resolve({ width: img.naturalWidth, height: img.naturalHeight })
      URL.revokeObjectURL(url)
    }
    img.onerror = () => {
      resolve({ width: 0, height: 0 })
      URL.revokeObjectURL(url)
    }
    img.src = url
  })
}

function uuid(): string {
  return crypto.randomUUID()
}

/** Compress + upload a main image and its thumbnail to the given folder prefix. */
async function uploadPair(folder: string, file: File): Promise<{ storagePath: string; width: number; height: number }> {
  const id = uuid()
  const storagePath = `${folder}/${id}.webp`
  const main = await toWebp(file, MAIN_MAX_DIM)
  const thumb = await toWebp(file, THUMB_MAX_DIM)

  const { error: mainErr } = await supabase.storage
    .from(BUCKET)
    .upload(storagePath, main.blob, { contentType: 'image/webp' })
  if (mainErr) throw mainErr

  const { error: thumbErr } = await supabase.storage
    .from(BUCKET)
    .upload(thumbPath(storagePath), thumb.blob, { contentType: 'image/webp' })
  if (thumbErr) {
    // Roll back the main object so we never leave a half-uploaded pair.
    await supabase.storage.from(BUCKET).remove([storagePath])
    throw thumbErr
  }

  return { storagePath, width: main.width, height: main.height }
}

/**
 * Upload one photo for a room type (or any resource). Uploads the compressed
 * pair, then inserts the metadata row; on row-insert failure the just-uploaded
 * objects are deleted so storage never drifts from the table.
 */
export async function uploadResourceImage(opts: {
  orgId: string
  resourceId: string
  file: File
  sortOrder: number
  isPrimary?: boolean
}): Promise<CatalogImage> {
  const { orgId, resourceId, file, sortOrder, isPrimary = false } = opts
  const { storagePath, width, height } = await uploadPair(`${orgId}/rooms/${resourceId}`, file)

  const { data, error } = await supabase
    .from('resource_images')
    .insert({
      org_id: orgId,
      resource_id: resourceId,
      storage_path: storagePath,
      sort_order: sortOrder,
      is_primary: isPrimary,
      width,
      height,
    })
    .select()
    .single()

  if (error || !data) {
    await supabase.storage.from(BUCKET).remove([storagePath, thumbPath(storagePath)])
    throw error ?? new Error('resource_image_insert_failed')
  }
  return data as CatalogImage
}

/** Upload one photo for the org property gallery. */
export async function uploadOrgImage(opts: {
  orgId: string
  file: File
  sortOrder: number
  isPrimary?: boolean
}): Promise<CatalogImage> {
  const { orgId, file, sortOrder, isPrimary = false } = opts
  const { storagePath, width, height } = await uploadPair(`${orgId}/property`, file)

  const { data, error } = await supabase
    .from('org_images')
    .insert({ org_id: orgId, storage_path: storagePath, sort_order: sortOrder, is_primary: isPrimary, width, height })
    .select()
    .single()

  if (error || !data) {
    await supabase.storage.from(BUCKET).remove([storagePath, thumbPath(storagePath)])
    throw error ?? new Error('org_image_insert_failed')
  }
  return data as CatalogImage
}

/** List images for a resource, ordered for display. */
export async function listResourceImages(resourceId: string): Promise<CatalogImage[]> {
  const { data, error } = await supabase
    .from('resource_images')
    .select('*')
    .eq('resource_id', resourceId)
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: true })
  if (error) throw error
  return (data ?? []) as CatalogImage[]
}

/** List property-gallery images for an org, ordered for display. */
export async function listOrgImages(orgId: string): Promise<CatalogImage[]> {
  const { data, error } = await supabase
    .from('org_images')
    .select('*')
    .eq('org_id', orgId)
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: true })
  if (error) throw error
  return (data ?? []) as CatalogImage[]
}

/** Delete an image: remove the storage pair first, then the metadata row. */
export async function deleteCatalogImage(table: 'resource_images' | 'org_images', image: CatalogImage): Promise<void> {
  await supabase.storage.from(BUCKET).remove([image.storage_path, thumbPath(image.storage_path)])
  const { error } = await supabase.from(table).delete().eq('id', image.id)
  if (error) throw error
}

/** Persist a new display order (assigns sort_order = array index). */
export async function persistImageOrder(table: 'resource_images' | 'org_images', orderedIds: string[]): Promise<void> {
  await Promise.all(
    orderedIds.map((id, i) => supabase.from(table).update({ sort_order: i }).eq('id', id)),
  )
}

/**
 * Mark one image primary and clear the flag on its siblings. `scope` is the
 * resource_id (resource_images) or org_id (org_images) whose set is affected.
 */
export async function setPrimaryImage(
  table: 'resource_images' | 'org_images',
  scopeColumn: 'resource_id' | 'org_id',
  scopeId: string,
  imageId: string,
): Promise<void> {
  const { error: clearErr } = await supabase.from(table).update({ is_primary: false }).eq(scopeColumn, scopeId)
  if (clearErr) throw clearErr
  const { error } = await supabase.from(table).update({ is_primary: true }).eq('id', imageId)
  if (error) throw error
}
