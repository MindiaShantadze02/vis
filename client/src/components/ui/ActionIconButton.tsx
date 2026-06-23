import { forwardRef } from 'react'
import { IconButton, type IconButtonProps } from '@mui/material'

interface ActionIconButtonProps extends Omit<IconButtonProps, 'color'> {
  /** 'danger' tints the button in the error palette (delete/remove actions). */
  tone?: 'default' | 'danger'
  /** Smaller footprint for inline controls squeezed between other fields. */
  compact?: boolean
}

/**
 * Soft-tinted, rounded square icon button used for inline row actions
 * (edit / delete). Reads as a solid control at rest and fills with the brand
 * (or error) colour on hover, so it sits visually alongside the Switch and
 * Button family instead of floating as a bare ghost icon.
 *
 * forwardRef so it can be used as a Tooltip child.
 */
const ActionIconButton = forwardRef<HTMLButtonElement, ActionIconButtonProps>(
  function ActionIconButton({ tone = 'default', compact = false, sx, ...rest }, ref) {
    const danger = tone === 'danger'
    const side = compact ? 28 : 34
    return (
      <IconButton
        ref={ref}
        size="small"
        {...rest}
        sx={{
          width: side,
          height: side,
          borderRadius: compact ? '8px' : '10px',
          color: danger ? 'error.main' : 'text.secondary',
          bgcolor: danger ? 'rgba(220,38,38,0.06)' : 'rgba(79,70,229,0.06)',
          border: '1px solid',
          borderColor: danger ? 'rgba(220,38,38,0.18)' : 'rgba(79,70,229,0.14)',
          transition: 'all 0.15s ease',
          '&:hover': {
            color: '#fff',
            bgcolor: danger ? 'error.main' : 'primary.main',
            borderColor: danger ? 'error.main' : 'primary.main',
            boxShadow: danger
              ? '0 4px 12px rgba(220,38,38,0.25)'
              : '0 4px 12px rgba(79,70,229,0.22)',
          },
          '&:active': { transform: 'scale(0.94)' },
          ...sx,
        }}
      />
    )
  },
)

export default ActionIconButton
