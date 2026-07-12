/**
 * Focus and smooth-scroll the first invalid field (the topmost element MUI
 * marked `aria-invalid="true"`) into view. Returns whether one was found.
 *
 * Call it right after raising validation errors so the offending field is
 * brought on-screen instead of the user being left staring at an unchanged
 * page. Because the invalid state is applied on the next React render, callers
 * should defer this to a `requestAnimationFrame` (or run it from an effect
 * keyed on the error) so the `aria-invalid` attribute is already in the DOM.
 *
 * `root` scopes the search — pass a dialog root so a background form's fields
 * are never grabbed; defaults to the whole document.
 */
export function focusFirstInvalidField(root: ParentNode = document): boolean {
  const el = root.querySelector<HTMLElement>('[aria-invalid="true"]')
  if (!el) return false
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  // Focus without the browser's instant jump, then smooth-scroll it centred.
  el.focus({ preventScroll: true })
  el.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'center' })
  return true
}
