import type { ReactElement } from 'react'
import { Chip } from '@mui/material'
import type { ChipProps } from '@mui/material'
import { useTranslation } from 'react-i18next'
import { ScheduleOutlined as ScheduleOutlinedIcon } from '@/components/icons'
import { CheckCircleOutlined as CheckCircleOutlinedIcon } from '@/components/icons'
import { CancelOutlined as CancelOutlinedIcon } from '@/components/icons'
import { DoNotDisturbAltOutlined as DoNotDisturbAltOutlinedIcon } from '@/components/icons'
import { TaskAltOutlined as TaskAltOutlinedIcon } from '@/components/icons'

export type AppointmentStatus = 'pending' | 'approved' | 'rejected' | 'cancelled' | 'completed'

const STATUS_COLOR: Record<AppointmentStatus, ChipProps['color']> = {
  pending:   'warning',
  approved:  'success',
  rejected:  'error',
  cancelled: 'default',
  completed: 'info',
}

// Each status also carries a distinct icon so meaning isn't conveyed by colour
// alone (a11y / colour-blind users).
const STATUS_ICON: Record<AppointmentStatus, ReactElement> = {
  pending:   <ScheduleOutlinedIcon />,
  approved:  <CheckCircleOutlinedIcon />,
  rejected:  <CancelOutlinedIcon />,
  cancelled: <DoNotDisturbAltOutlinedIcon />,
  completed: <TaskAltOutlinedIcon />,
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
 */
export default function StatusChip({ status, size = 'small', variant = 'filled' }: StatusChipProps) {
  const { t } = useTranslation()
  return (
    <Chip
      label={t(`dashboard.${status}`)}
      color={STATUS_COLOR[status]}
      icon={STATUS_ICON[status]}
      size={size}
      variant={variant}
      data-testid={`status-${status}`}
    />
  )
}
