import { useEffect, useRef } from 'react'
import { Alert } from '@mui/material'
import type { SxProps, Theme } from '@mui/material/styles'
import { focusFirstInvalidField } from '@/lib/focusFirstInvalidField'

interface Props {
  /** The error text, or null/empty/undefined to render nothing. */
  message: string | null | undefined
  'data-testid'?: string
  sx?: SxProps<Theme>
}

/**
 * A form error banner that pulls itself — and the offending field — into view
 * whenever the message appears or changes, so a validation error raised on
 * submit is never left off-screen below the fold. When the validators flagged
 * a specific field it focuses that field (the first invalid one, i.e. the
 * topmost); otherwise (e.g. an empty required field that shows no inline error)
 * it just scrolls the banner in. A drop-in replacement for the inline
 * `<Alert severity="error">{error}</Alert>` the forms used.
 */
export default function FormErrorAlert({ message, sx, 'data-testid': testId }: Props) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!message) return
    // Prefer bringing the flagged field into view; otherwise (e.g. an empty
    // required field that shows no inline error) scroll the banner in. Scope
    // the field search to the dialog when the banner is inside one.
    const scope: ParentNode = ref.current?.closest('.MuiDialog-root') ?? document
    if (!focusFirstInvalidField(scope)) {
      const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
      ref.current?.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'center' })
    }
  }, [message])

  if (!message) return null
  return (
    <Alert ref={ref} severity="error" sx={{ mb: 2, ...sx }} data-testid={testId}>
      {message}
    </Alert>
  )
}
