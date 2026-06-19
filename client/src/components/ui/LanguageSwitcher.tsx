import { useState } from 'react'
import {
  IconButton, Menu, MenuItem, ListItemIcon, ListItemText, Tooltip,
} from '@mui/material'
import TranslateOutlinedIcon from '@mui/icons-material/TranslateOutlined'
import CheckIcon from '@mui/icons-material/Check'
import { useTranslation } from 'react-i18next'
import { SUPPORTED_LANGUAGES } from '@/lib/i18n'

export default function LanguageSwitcher() {
  const { t, i18n } = useTranslation()
  const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null)

  // i18n.language can be a region variant (e.g. "en-US"); match on the base code.
  const current = i18n.language?.split('-')[0]

  function selectLanguage(code: string) {
    void i18n.changeLanguage(code)
    setAnchorEl(null)
  }

  return (
    <>
      <Tooltip title={t('settings.language')}>
        <IconButton onClick={e => setAnchorEl(e.currentTarget)} data-testid="language-switcher-btn">
          <TranslateOutlinedIcon />
        </IconButton>
      </Tooltip>
      <Menu
        anchorEl={anchorEl}
        open={Boolean(anchorEl)}
        onClose={() => setAnchorEl(null)}
        transformOrigin={{ horizontal: 'right', vertical: 'top' }}
        anchorOrigin={{ horizontal: 'right', vertical: 'bottom' }}
      >
        {SUPPORTED_LANGUAGES.map(lang => (
          <MenuItem
            key={lang.code}
            selected={lang.code === current}
            onClick={() => selectLanguage(lang.code)}
            data-testid={`language-option-${lang.code}`}
          >
            <ListItemIcon sx={{ minWidth: 32 }}>
              {lang.code === current && <CheckIcon fontSize="small" />}
            </ListItemIcon>
            <ListItemText primary={lang.label} />
          </MenuItem>
        ))}
      </Menu>
    </>
  )
}
