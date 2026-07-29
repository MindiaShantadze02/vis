/**
 * Signup source attribution. First-touch: the earliest ?src= / utm_source / ?ref
 * a visitor arrives with is remembered in localStorage and stamped onto the org
 * at creation (organisations.acquisition_source), surfaced to superadmin. A
 * later visit never overwrites the first-seen value.
 */
const KEY = 'vis-acq'

export function captureAcquisitionSource(search: string = window.location.search): void {
  try {
    if (localStorage.getItem(KEY)) return // first-touch — don't overwrite
    const p = new URLSearchParams(search)
    const src = p.get('src') ?? p.get('utm_source') ?? p.get('ref')
    if (src && src.trim()) localStorage.setItem(KEY, src.trim().slice(0, 60))
  } catch { /* storage unavailable (SSR / private mode) */ }
}

export function getAcquisitionSource(): string | null {
  try { return localStorage.getItem(KEY) } catch { return null }
}
