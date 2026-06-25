import { useState } from 'react'
import { Box, Typography, IconButton, Tooltip } from '@mui/material'
import ContentCopyOutlinedIcon from '@mui/icons-material/ContentCopyOutlined'
import OpenInNewOutlinedIcon from '@mui/icons-material/OpenInNewOutlined'
import CheckIcon from '@mui/icons-material/Check'
import { useTranslation } from 'react-i18next'

interface CopyableTextProps {
  /** Text shown to the user. */
  text: string
  /** Value copied to clipboard; defaults to `text`. */
  value?: string
  label?: string
  /** When set, also shows an "open in new tab" button pointing at this URL. */
  href?: string
}

/**
 * Read-only text with a copy-to-clipboard button. Used for the booking
 * link in ProfileSettings, which was previously static and unselectable.
 * Pass `href` to also surface an "open" button (e.g. so an admin can preview
 * the public booking form their customers use).
 */
export default function CopyableText({ text, value, label, href }: CopyableTextProps) {
  const { t } = useTranslation()
  const [copied, setCopied] = useState(false)

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(value ?? text)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      /* clipboard unavailable — no-op */
    }
  }

  return (
    <Box>
      {label && (
        <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block', mb: 0.5 }}>
          {label}
        </Typography>
      )}
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          gap: 1,
          px: 1.5,
          py: 1,
          borderRadius: 2,
          border: '1px solid',
          borderColor: 'divider',
          bgcolor: 'background.default',
        }}
      >
        <Typography
          variant="body2"
          sx={{ flex: 1, fontFamily: 'monospace', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
        >
          {text}
        </Typography>
        {href && (
          <Tooltip title={t('common.openLink')}>
            <IconButton
              size="small"
              component="a"
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={t('common.openLink')}
            >
              <OpenInNewOutlinedIcon sx={{ fontSize: 18 }} />
            </IconButton>
          </Tooltip>
        )}
        <Tooltip title={copied ? t('common.success') : t('common.copy')}>
          <IconButton size="small" onClick={handleCopy} aria-label={t('common.copy')}>
            {copied
              ? <CheckIcon sx={{ fontSize: 18, color: 'success.main' }} />
              : <ContentCopyOutlinedIcon sx={{ fontSize: 18 }} />}
          </IconButton>
        </Tooltip>
      </Box>
    </Box>
  )
}
