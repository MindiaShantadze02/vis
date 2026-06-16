import {
  Dialog, DialogTitle, DialogContent, DialogContentText,
  DialogActions, Button, CircularProgress,
} from '@mui/material'
import { useTranslation } from 'react-i18next'

interface ConfirmDialogProps {
  open: boolean
  title: string
  message?: string
  /** Label for the confirm button; defaults to common.confirm. */
  confirmLabel?: string
  cancelLabel?: string
  /** When true, the confirm button uses the error color (destructive actions). */
  destructive?: boolean
  loading?: boolean
  onConfirm: () => void
  onClose: () => void
}

/**
 * Reusable confirmation dialog for destructive actions (delete service,
 * remove override, remove team member) that previously executed with no
 * confirmation step.
 */
export default function ConfirmDialog({
  open, title, message, confirmLabel, cancelLabel,
  destructive = true, loading = false, onConfirm, onClose,
}: ConfirmDialogProps) {
  const { t } = useTranslation()
  return (
    <Dialog open={open} onClose={loading ? undefined : onClose} maxWidth="sm" fullWidth>
      <DialogTitle sx={{ fontWeight: 700 }}>{title}</DialogTitle>
      {message && (
        <DialogContent>
          <DialogContentText sx={{ color: 'text.secondary' }}>{message}</DialogContentText>
        </DialogContent>
      )}
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={onClose} disabled={loading} color="inherit">
          {cancelLabel ?? t('common.cancel')}
        </Button>
        <Button
          onClick={onConfirm}
          disabled={loading}
          variant="contained"
          color={destructive ? 'error' : 'primary'}
        >
          {loading ? <CircularProgress size={20} color="inherit" /> : (confirmLabel ?? t('common.confirm'))}
        </Button>
      </DialogActions>
    </Dialog>
  )
}
