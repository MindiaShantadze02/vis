import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Box, Typography, Card, TextField, Chip,
} from '@mui/material'
import { Search as SearchIcon } from '@/components/icons'
import { GroupOutlined as GroupOutlinedIcon } from '@/components/icons'
import { DeleteOutlined as DeleteOutlinedIcon } from '@/components/icons'
import { format } from 'date-fns'
import { useTranslation } from 'react-i18next'
import { supabase } from '@/lib/supabase'
import { useOrg } from '@/contexts/OrgContext'
import { PageHeader, LoadingState, EmptyState, ConfirmDialog, ActionIconButton, useToast } from '@/components/ui'
import { dateLocale } from '@/lib/dateLocale'
import { surface } from '@/theme/theme'

/** PostgREST may type a to-one relation as an array; normalize to one object. */
function pickOne<T>(rel: T | T[] | null | undefined): T | null {
  if (Array.isArray(rel)) return rel[0] ?? null
  return rel ?? null
}

interface ClientRow {
  customerId: string
  firstName: string
  lastName: string | null
  phone: string
  count: number
  lastVisit: string
  // Any appointment id belonging to the client — the erase RPC is keyed by
  // appointment but anonymizes the shared customer record (all their visits).
  apptId: string
  erased: boolean
}

/**
 * Client management — the org's distinct customers, with a per-client
 * "erase data" action (Art. 16 right to erasure). This is the dedicated home
 * for the destructive erase, moved out of the appointment approve/reject flow.
 */
export default function ClientsPage() {
  const { t } = useTranslation()
  const { org } = useOrg()
  const toast = useToast()

  const [rows, setRows] = useState<ClientRow[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [confirmErase, setConfirmErase] = useState<ClientRow | null>(null)
  const [erasing, setErasing] = useState(false)

  const load = useCallback(async () => {
    if (!org) return
    setLoading(true)
    const { data } = await supabase
      .from('appointments')
      .select('id, customer_id, scheduled_at, customers(first_name, last_name, phone_number)')
      .eq('org_id', org.id)
      .order('scheduled_at', { ascending: false })
      .limit(5000)

    // Collapse the appointment rows into one entry per customer. Rows arrive
    // newest-first, so the first time we see a customer carries their latest
    // visit and (post-anonymization) their current name/phone.
    const byCustomer = new Map<string, ClientRow>()
    for (const raw of (data ?? [])) {
      const r = raw as Record<string, unknown>
      const customerId = r.customer_id as string | null
      if (!customerId) continue
      const c = pickOne(r.customers as never) as
        { first_name: string; last_name: string | null; phone_number: string } | null
      const existing = byCustomer.get(customerId)
      if (existing) {
        existing.count += 1
      } else {
        const phone = c?.phone_number ?? ''
        byCustomer.set(customerId, {
          customerId,
          firstName: c?.first_name ?? '—',
          lastName: c?.last_name ?? null,
          phone,
          count: 1,
          lastVisit: r.scheduled_at as string,
          apptId: r.id as string,
          erased: phone === '' || c?.first_name === 'erased',
        })
      }
    }
    setRows([...byCustomer.values()])
    setLoading(false)
  }, [org])

  useEffect(() => { load() }, [load])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return rows
    return rows.filter(r =>
      `${r.firstName} ${r.lastName ?? ''}`.toLowerCase().includes(q) ||
      r.phone.toLowerCase().includes(q),
    )
  }, [rows, search])

  async function eraseClient(row: ClientRow) {
    setErasing(true)
    const { error } = await supabase.rpc('erase_customer_data', { p_appointment_id: row.apptId })
    setErasing(false)
    setConfirmErase(null)
    if (error) { toast.error(error.message); return }
    toast.success(t('dashboard.eraseDone'))
    load()
  }

  return (
    <Box>
      <PageHeader title={t('clients.title')} />

      {loading ? <LoadingState /> : (
        <>
          <TextField
            size="small"
            placeholder={`${t('common.search')}...`}
            value={search}
            onChange={e => setSearch(e.target.value)}
            slotProps={{
              input: { startAdornment: <SearchIcon sx={{ mr: 0.5, color: 'text.secondary', fontSize: 20 }} /> },
              htmlInput: { 'data-testid': 'clients-search' },
            }}
            sx={{ mb: 2.5, width: { xs: '100%', sm: 320 } }}
          />

          {filtered.length === 0 ? (
            <EmptyState icon={<GroupOutlinedIcon />} title={t('clients.empty')} />
          ) : (
            <Box sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 3, overflow: 'hidden', bgcolor: 'background.paper' }}>
              {filtered.map((row, i) => (
                <Box
                  key={row.customerId}
                  data-testid="client-row"
                  sx={{
                    display: 'flex', alignItems: 'center', gap: 1.5, px: 2, py: 1.75,
                    borderBottom: i < filtered.length - 1 ? '1px solid' : 'none',
                    borderColor: 'divider',
                    '&:hover': { bgcolor: surface.hover },
                  }}
                >
                  <Box sx={{ flex: 1, minWidth: 0 }}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
                      <Typography variant="body2" sx={{ fontWeight: 600 }} noWrap>
                        {row.firstName} {row.lastName ?? ''}
                      </Typography>
                      {row.erased && (
                        <Chip size="small" label={t('clients.erased')} sx={{ height: 20, fontSize: 11 }} />
                      )}
                    </Box>
                    <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                      {row.erased ? '—' : row.phone}
                    </Typography>
                  </Box>

                  <Box sx={{ textAlign: 'right', flexShrink: 0, display: { xs: 'none', sm: 'block' } }}>
                    <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block' }}>
                      {t('clients.appointments', { n: row.count })}
                    </Typography>
                    <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                      {t('clients.lastVisit')}: {format(new Date(row.lastVisit), 'd MMM yyyy', { locale: dateLocale() })}
                    </Typography>
                  </Box>

                  <ActionIconButton
                    tone="danger"
                    aria-label={t('dashboard.eraseClientData')}
                    data-testid="client-erase"
                    disabled={row.erased}
                    onClick={() => setConfirmErase(row)}
                  >
                    <DeleteOutlinedIcon fontSize="small" />
                  </ActionIconButton>
                </Box>
              ))}
            </Box>
          )}
        </>
      )}

      {/* Erase confirmation (Art. 16) — destructive, kept as a centered confirm. */}
      <ConfirmDialog
        open={!!confirmErase}
        title={t('clients.eraseTitle')}
        message={t('clients.eraseMessage', {
          name: confirmErase ? `${confirmErase.firstName} ${confirmErase.lastName ?? ''}`.trim() : '',
        })}
        confirmLabel={t('dashboard.eraseConfirm')}
        loading={erasing}
        onClose={() => setConfirmErase(null)}
        onConfirm={() => { if (confirmErase) eraseClient(confirmErase) }}
      />
    </Box>
  )
}
