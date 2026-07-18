import type { ReactNode } from 'react'
import { Drawer, Box, Typography, IconButton } from '@mui/material'
import { Close as CloseIcon } from '@/components/icons'
import { useTranslation } from 'react-i18next'

interface SideDrawerProps {
  open: boolean
  onClose: () => void
  /** Header title (left of the close button). */
  title?: ReactNode
  /** Body content — scrolls independently of the sticky header/footer. */
  children: ReactNode
  /** Optional sticky footer, typically the action buttons. */
  actions?: ReactNode
  /** Optional element rendered before the title (e.g. a back button). */
  headerStart?: ReactNode
  /** Desktop paper width; mobile is always full-width. Default 480. */
  width?: number | string
  /** Disable backdrop/escape close (e.g. while saving). */
  disableClose?: boolean
  'data-testid'?: string
}

/**
 * Large right-anchored drawer used across the dashboard in place of centered
 * modal dialogs. Provides a sticky header with an X close button, a scrollable
 * body, and an optional sticky footer for actions — so long forms and detail
 * views get more room than a Dialog and a consistent close affordance.
 */
export default function SideDrawer({
  open, onClose, title, children, actions, headerStart,
  width = 480, disableClose = false, 'data-testid': testId,
}: SideDrawerProps) {
  const { t } = useTranslation()
  return (
    <Drawer
      anchor="right"
      open={open}
      onClose={disableClose ? undefined : onClose}
      slotProps={{
        paper: {
          'data-testid': testId,
          // Present the modal drawer as a dialog for a11y and so tests/queries
          // that look up role="dialog" still resolve after the Dialog→Drawer swap.
          role: 'dialog',
          'aria-modal': true,
          sx: {
            width: { xs: '100%', sm: width },
            maxWidth: '100%',
            display: 'flex',
            flexDirection: 'column',
          },
        } as never,
      }}
    >
      {/* Sticky header — title + X close. */}
      <Box
        sx={{
          display: 'flex', alignItems: 'center', gap: 1,
          px: 3, py: 2,
          borderBottom: '1px solid', borderColor: 'divider',
          position: 'sticky', top: 0, zIndex: 1,
          bgcolor: 'background.paper',
          flexShrink: 0,
        }}
      >
        {headerStart}
        <Typography variant="h6" sx={{ fontWeight: 700, flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {title}
        </Typography>
        <IconButton onClick={onClose} disabled={disableClose} aria-label={t('common.close')} data-testid="drawer-close" edge="end">
          <CloseIcon />
        </IconButton>
      </Box>

      {/* Scrollable body. */}
      <Box sx={{ flex: 1, overflow: 'auto', p: 3 }}>
        {children}
      </Box>

      {/* Optional sticky footer with actions. */}
      {actions && (
        <Box
          sx={{
            display: 'flex', gap: 1, justifyContent: 'flex-end', flexWrap: 'wrap',
            px: 3, py: 2,
            borderTop: '1px solid', borderColor: 'divider',
            position: 'sticky', bottom: 0,
            bgcolor: 'background.paper',
            flexShrink: 0,
          }}
        >
          {actions}
        </Box>
      )}
    </Drawer>
  )
}
