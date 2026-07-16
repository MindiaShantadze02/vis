import { Box, Container, Typography, Button, Divider, Stack } from '@mui/material'
import { ArrowBackIosNew as ArrowBackIosNewIcon } from '@/components/icons'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { getLegalDoc, type LegalDocType } from './legalContent'

/** Renders a bullet list or a paragraph from a legal content block. */
function LegalBlock({ block }: { block: string | string[] }) {
  if (Array.isArray(block)) {
    return (
      <Stack component="ul" spacing={0.75} sx={{ pl: 3, my: 1 }}>
        {block.map((item, i) => (
          <Typography key={i} component="li" variant="body2" sx={{ color: 'text.secondary', lineHeight: 1.7 }}>
            {item}
          </Typography>
        ))}
      </Stack>
    )
  }
  return (
    <Typography variant="body2" sx={{ color: 'text.secondary', lineHeight: 1.7, mb: 1.5 }}>
      {block}
    </Typography>
  )
}

/** Public, standalone Privacy Policy / Terms page (no auth). Content is
 *  language-aware via i18n and falls back to Georgian. */
export default function LegalPage({ type }: { type: LegalDocType }) {
  const navigate = useNavigate()
  const { i18n } = useTranslation()
  const resolved = i18n.resolvedLanguage ?? i18n.language
  const doc = getLegalDoc(type, resolved)
  // Mirrors getLegalDoc's fallback: only Georgian gets Georgian chrome text,
  // every other language (including Russian) gets English.
  const isKa = resolved === 'ka'

  return (
    <Box sx={{ minHeight: '100vh', bgcolor: 'background.default', py: { xs: 3, md: 6 } }}>
      <Container maxWidth="md">
        <Button
          startIcon={<ArrowBackIosNewIcon sx={{ fontSize: 14 }} />}
          onClick={() => (window.history.length > 1 ? navigate(-1) : navigate('/'))}
          size="small"
          sx={{ mb: 2, color: 'text.secondary' }}
        >
          {isKa ? 'უკან' : 'Back'}
        </Button>

        <Typography variant="h4" sx={{ fontWeight: 800, letterSpacing: '-0.5px', mb: 0.5 }}>
          {doc.title}
        </Typography>
        <Typography variant="caption" sx={{ color: 'text.secondary' }}>
          {isKa ? 'ბოლო განახლება:' : 'Last updated:'} {doc.updated}
        </Typography>
        {doc.note && (
          <Typography variant="body2" sx={{ color: 'text.secondary', fontStyle: 'italic', mt: 1.5 }}>
            {doc.note}
          </Typography>
        )}

        <Divider sx={{ my: 3 }} />

        {doc.sections.map((section, i) => (
          <Box key={i} sx={{ mb: 3 }}>
            <Typography variant="h6" sx={{ fontWeight: 700, mb: 1 }}>
              {section.heading}
            </Typography>
            {section.body.map((block, j) => (
              <LegalBlock key={j} block={block} />
            ))}
          </Box>
        ))}
      </Container>
    </Box>
  )
}
