import { createContext, useCallback, useContext, useState } from 'react'
import type { ReactNode } from 'react'
import { Snackbar, Alert } from '@mui/material'
import type { AlertColor } from '@mui/material'

interface ToastState {
  open: boolean
  message: string
  severity: AlertColor
}

interface ToastContextValue {
  /** Show a toast. `severity` defaults to 'success'. */
  showToast: (message: string, severity?: AlertColor) => void
  success: (message: string) => void
  error: (message: string) => void
}

const ToastContext = createContext<ToastContextValue>({
  showToast: () => {},
  success: () => {},
  error: () => {},
})

/**
 * App-level snackbar. Replaces the inline `<Alert>` blocks that auto-hid
 * success messages after 3s and were easy to miss. Mounted once near the
 * root so any page can call `useToast()`.
 */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<ToastState>({ open: false, message: '', severity: 'success' })

  const showToast = useCallback((message: string, severity: AlertColor = 'success') => {
    setToast({ open: true, message, severity })
  }, [])

  const success = useCallback((message: string) => showToast(message, 'success'), [showToast])
  const error = useCallback((message: string) => showToast(message, 'error'), [showToast])

  const handleClose = (_e?: unknown, reason?: string) => {
    if (reason === 'clickaway') return
    setToast(prev => ({ ...prev, open: false }))
  }

  return (
    <ToastContext.Provider value={{ showToast, success, error }}>
      {children}
      <Snackbar
        open={toast.open}
        autoHideDuration={4000}
        onClose={handleClose}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Alert onClose={handleClose} severity={toast.severity} variant="filled" sx={{ width: '100%' }}>
          {toast.message}
        </Alert>
      </Snackbar>
    </ToastContext.Provider>
  )
}

export function useToast() {
  return useContext(ToastContext)
}
