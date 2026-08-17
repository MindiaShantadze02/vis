// Supabase Storage image transformations for the public buckets (logos,
// covers, service thumbnails, member photos).
//
// A public object lives at   /storage/v1/object/public/<bucket>/<path>
// and its rendered variant at /storage/v1/render/image/public/<bucket>/<path>?width=…
//
// Two things make this worth doing:
//   * Owners upload whatever their phone produced — 4000px, several MB — and we
//     were shipping the original to every visitor and letting the browser scale
//     it. The rendered variant is resized and re-encoded server-side.
//   * Screens are not all 1x. Asking for the CSS width alone is soft on a
//     retina display; `srcSet` lets the browser pick the 2x variant.
//
// VERIFIED behaviour (2026-08-17, project dnmecnpugjxkjonqsfxx): the renderer
// never upscales — requesting width=1600 on a 334px-wide source returns 334px.
// So it is always safe to ask for the ideal size; a small upload is simply
// served at its own size, and the caller never pays for pixels that don't exist.

const OBJECT_SEGMENT = '/storage/v1/object/public/'
const RENDER_SEGMENT = '/storage/v1/render/image/public/'

/**
 * Default render quality. Deliberately high (not the usual 80): the renderer
 * caps at the source size, so for the many uploads that are already SMALLER
 * than their slot, a transform is a straight re-encode — at q80 that threw away
 * data we can never get back (measured: a 24.6KB source came back as 20.5KB).
 * At q90 the re-encode is visually lossless, and because the renderer answers
 * browsers in WebP the result is still no heavier than the original JPEG
 * (measured on a service photo: origin JPEG 64.7KB vs q90 WebP 59.6KB).
 */
const DEFAULT_QUALITY = 90

/** Is this a Supabase public-object URL we can ask the renderer to resize?
 *  blob: previews, data: URIs and third-party URLs are passed through as-is. */
function isTransformable(url: string): boolean {
  return url.includes(OBJECT_SEGMENT)
}

/**
 * A resized variant of a stored image. `width` is in **device** pixels (already
 * multiplied by DPR by the caller). Returns the URL untouched when it isn't a
 * Supabase public object.
 */
export function storageImage(url: string, width: number, quality = DEFAULT_QUALITY): string {
  if (!isTransformable(url) || !Number.isFinite(width) || width <= 0) return url
  const base = url.split('?')[0].replace(OBJECT_SEGMENT, RENDER_SEGMENT)
  // Cache-buster (?v=…) on logo/cover URLs must survive, or a replaced image
  // keeps serving the old render.
  const version = url.split('?')[1]
  const params = new URLSearchParams({ width: String(Math.round(width)), quality: String(quality) })
  if (version) params.set('v', new URLSearchParams(version).get('v') ?? version)
  return `${base}?${params}`
}

/**
 * A 1x/2x `srcSet` for an image laid out `cssWidth` CSS pixels wide, so retina
 * screens get the denser variant and 1x screens don't pay for it. Returns
 * undefined for non-transformable URLs (the caller then just uses `src`).
 */
export function storageSrcSet(
  url: string,
  cssWidth: number,
  quality = DEFAULT_QUALITY,
): string | undefined {
  if (!isTransformable(url) || !Number.isFinite(cssWidth) || cssWidth <= 0) return undefined
  return [
    `${storageImage(url, cssWidth, quality)} 1x`,
    `${storageImage(url, cssWidth * 2, quality)} 2x`,
  ].join(', ')
}
