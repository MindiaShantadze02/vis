import type { ReactElement } from 'react'
import { Chip } from '@mui/material'
import type { ChipProps } from '@mui/material'
import { useTranslation } from 'react-i18next'
import { CheckCircleOutlined as CheckCircleOutlinedIcon } from '@/components/icons'
import { CancelOutlined as CancelOutlinedIcon } from '@/components/icons'
import { DoNotDisturbAltOutlined as DoNotDisturbAltOutlinedIcon } from '@/components/icons'
import { TaskAltOutlined as TaskAltOutlinedIcon } from '@/components/icons'
import { EventBusyOutlined as EventBusyOutlinedIcon } from '@/components/icons'
import { ScheduleOutlined as ScheduleOutlinedIcon } from '@/components/icons'

export type AppointmentStatus = 'pending' | 'approved' | 'rejected' | 'cancelled' | 'completed' | 'no_show'

const STATUS_COLOR: Record<AppointmentStatus, ChipProps['color']> = {
  // Amber, not green: a request awaiting the owner is not a booking yet.
  pending:   'warning',
  approved:  'success',
  rejected:  'error',
  cancelled: 'default',
  completed: 'info',
  no_show:   'error',
}

// Each status also carries a distinct icon so meaning isn't conveyed by colour
// alone (a11y / colour-blind users).
const STATUS_ICON: Record<AppointmentStatus, ReactElement> = {
  pending:   <ScheduleOutlinedIcon />,
  approved:  <CheckCircleOutlinedIcon />,
  rejected:  <CancelOutlinedIcon />,
  cancelled: <DoNotDisturbAltOutlinedIcon />,
  completed: <TaskAltOutlinedIcon />,
  no_show:   <EventBusyOutlinedIcon />,
}

interface StatusChipProps {
  status: AppointmentStatus
  size?: ChipProps['size']
  variant?: ChipProps['variant']
}

/**
 * Single source of truth for appointment status presentation.
 * Pairs a localized text label with a semantic theme color so status
 * is never conveyed by color alone (a11y). Replaces the duplicated
 * STATUS_COLOR / STATUS_LABEL maps across the dashboard pages.
 *
 * Tolerates a status outside the union: rows written before a status was retired
 * still exist until the retiring migration is pushed, and rendering a raw i18n
 * key at the customer's name is worse than a plain chip. `t` is given an
 * explicit fallback so a missing key never leaks.
 */
export default function StatusChip({ status, size = 'small', variant = 'filled' }: StatusChipProps) {
  const { t } = useTranslation()
  return (
    <Chip
      label={t(`dashboard.${status}`, { defaultValue: String(status).replace(/_/g, ' ') })}
      color={STATUS_COLOR[status] ?? 'default'}
      icon={STATUS_ICON[status]}
      size={size}
      variant={variant}
      data-testid={`status-${status}`}
    />
  )
}
