import { IconButton, type IconButtonProps } from '@mui/material'

interface ActionIconButtonProps extends Omit<IconButtonProps, 'color'> {
  /** 'danger' tints the button in the error palette (delete/remove actions). */
  tone?: 'default' | 'danger'
}

/**
 * Soft-tinted, rounded square icon button used for inline row actions
 * (edit / delete). Reads as a solid control at rest and fills with the brand
 * (or error) colour on hover, so it sits visually alongside the Switch and
 * Button family instead of floating as a bare ghost icon.
 */
export default function ActionIconButton({ tone = 'default', sx, ...rest }: ActionIconButtonProps) {
  const danger = tone === 'danger'
  return (
    <IconButton
      size="small"
      {...rest}
      sx={{
        width: 34,
        height: 34,
        borderRadius: '10px',
        color: danger ? 'error.main' : 'text.secondary',
        bgcolor: danger ? 'rgba(220,38,38,0.06)' : 'rgba(124,58,237,0.06)',
        border: '1px solid',
        borderColor: danger ? 'rgba(220,38,38,0.18)' : 'rgba(124,58,237,0.14)',
        transition: 'all 0.15s ease',
        '&:hover': {
          color: '#fff',
          bgcolor: danger ? 'error.main' : 'primary.main',
          borderColor: danger ? 'error.main' : 'primary.main',
          boxShadow: danger
            ? '0 4px 12px rgba(220,38,38,0.25)'
            : '0 4px 12px rgba(124,58,237,0.22)',
        },
        '&:active': { transform: 'scale(0.94)' },
        ...sx,
      }}
    />
  )
}
