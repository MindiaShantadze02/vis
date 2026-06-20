import { useState } from 'react'
import {
  Button, Menu, MenuItem, ListItemIcon, ListItemText, Tooltip,
} from '@mui/material'
import KeyboardArrowDownIcon from '@mui/icons-material/KeyboardArrowDown'
import CheckIcon from '@mui/icons-material/Check'
import { GE, RU, GB } from 'country-flag-icons/react/3x2'
import { useTranslation } from 'react-i18next'
import { SUPPORTED_LANGUAGES } from '@/lib/i18n'

// Flat SVG flags — render identically across platforms (unlike emoji) and sit
// flush with the flat dashboard chrome.
const FLAGS: Record<string, typeof GE> = { GE, RU, GB }

function Flag({ country, size = 18 }: { country: string; size?: number }) {
  const Component = FLAGS[country]
  if (!Component) return null
  // 3x2 ratio; rounded corners keep it consistent with the rest of the UI.
  return <Component style={{ width: size, height: (size * 2) / 3, borderRadius: 2, display: 'block' }} />
}

export default function LanguageSwitcher() {
  const { t, i18n } = useTranslation()
  const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null)

  // i18n.language can be a region variant (e.g. "en-US"); match on the base code.
  const current = i18n.language?.split('-')[0]
  const currentLang = SUPPORTED_LANGUAGES.find(l => l.code === current) ?? SUPPORTED_LANGUAGES[0]

  function selectLanguage(code: string) {
    void i18n.changeLanguage(code)
    setAnchorEl(null)
  }

  return (
    <>
      <Tooltip title={t('settings.language')}>
        <Button
          onClick={e => setAnchorEl(e.currentTarget)}
          data-testid="language-switcher-btn"
          color="inherit"
          size="small"
          startIcon={<Flag country={currentLang.country} />}
          endIcon={<KeyboardArrowDownIcon sx={{ fontSize: 16, color: 'text.secondary' }} />}
          sx={{ textTransform: 'none', color: 'text.primary', fontWeight: 500, px: 1 }}
        >
          {currentLang.label}
        </Button>
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
            <ListItemIcon sx={{ minWidth: 30 }}>
              <Flag country={lang.country} />
            </ListItemIcon>
            <ListItemText primary={lang.label} />
            {lang.code === current && (
              <CheckIcon fontSize="small" sx={{ ml: 2, color: 'primary.main' }} />
            )}
          </MenuItem>
        ))}
      </Menu>
    </>
  )
}
