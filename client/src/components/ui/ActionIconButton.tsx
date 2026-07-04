import { forwardRef } from 'react'
import { IconButton, type IconButtonProps } from '@mui/material'

interface ActionIconButtonProps extends Omit<IconButtonProps, 'color'> {
  /** 'danger' tints the button in the error palette (delete/remove actions). */
  tone?: 'default' | 'danger'
  /** Smaller footprint for inline controls squeezed between other fields. */
  compact?: boolean
}

/**
 * Quiet ghost icon button for inline row actions (edit / delete). Borderless at
 * rest so lists stay calm; tints with a soft neutral (or error) wash on hover.
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
          transition: 'background-color 0.15s ease, color 0.15s ease',
          '&:hover': {
            color: danger ? 'error.main' : 'text.primary',
            bgcolor: danger ? 'rgba(220,38,38,0.09)' : 'rgba(30,36,51,0.06)',
          },
          ...sx,
        }}
      />
    )
  },
)

export default ActionIconButton
