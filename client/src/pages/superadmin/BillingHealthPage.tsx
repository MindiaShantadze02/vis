import { useEffect, useState } from 'react'
import { Link as RouterLink } from 'react-router-dom'
import {
  Box, Grid, Typography, Chip, Table, TableBody, TableCell, TableHead, TableRow,
  Link as MuiLink, Alert, useTheme,
} from '@mui/material'
import { CreditCardOutlined as CreditCardOutlinedIcon } from '@/components/icons'
import { InsightsOutlined as InsightsOutlinedIcon } from '@/components/icons'
import { ErrorOutlineOutlined as WarningIcon } from '@/components/icons'
import { EventBusyOutlined as CalendarCheckIcon } from '@/components/icons'
import { supabase } from '@/lib/supabase'
import { PageHeader, StatCard, EmptyState } from '@/components/ui'
import { Section, ScrollX, Pager } from './_shared'
import { usePaged } from './usePaged'
import { lari, monthLabel } from './format'

/**
 * The money page: what we are owed, what we collected, and who we cannot charge.
 *
 * Retro-cancellation lives here rather than on the platform overview — it is a
 * billing-integrity number (occurrences a business tried to take off its own
 * invoice), so it belongs next to the invoice, not next to signup counts.
 * Machine health moved out to /superadmin/system for the same reason.
 */

interface Outstanding { amount: number; periods: number; orgs: number; oldest_due: string | null }
interface CollectionMonth {
  month: string; charged: number; failed: number; pending: number
  waived: number; uncollectable: number; collected: number
}
interface RevenueMonth { month: string; billable: number; revenue: number }
interface NoCardOrg { org_id: string; name: string; slug: string; billing_status: string; owed: number }
interface ExpiringCard { org_id: string; name: string; last4: string; expires_at: string }
interface Dunning {
  past_due: number; suspended: number; recovered: number; median_days_to_recover: number | null
}
interface BillingHealth {
  months: number
  appointment_price: number
  outstanding: Outstanding
  collection_by_month: CollectionMonth[]
  no_card: NoCardOrg[]
  expiring_cards: ExpiringCard[]
  dunning: Dunning
  revenue_by_month: RevenueMonth[]
}

interface RetroOrg {
  org_id: string; name: string; slug: string; bookings: number; billable: number
  retro_billed: number; free_corrections: number; retro_rate_pct: number
}
interface RetroStats {
  window_days: number; grace_hours: number
  totals: { bookings: number; billable: number; retro_billed: number; free_corrections: number; orgs_affected: number }
  orgs: RetroOrg[]
}

/** Small label/value pair used inside sections, where a full StatCard is too heavy. */
function Figure({ label, value, tone }: { label: string; value: string; tone?: 'error' | 'warning' | 'success' }) {
  return (
    <Box sx={{ minWidth: 150 }}>
      <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block' }}>
        {label}
      </Typography>
      <Typography variant="h6" sx={{ fontWeight: 700, color: tone ? `${tone}.main` : 'text.primary' }}>
        {value}
      </Typography>
    </Box>
  )
}

export default function BillingHealthPage() {
  const theme = useTheme()
  const [health, setHealth] = useState<BillingHealth | null>(null)
  const [retro, setRetro] = useState<RetroStats | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    Promise.all([
      supabase.rpc('platform_billing_health', { p_months: 6 }),
      supabase.rpc('platform_retro_cancel_stats', { p_days: 90 }),
    ]).then(([h, r]) => {
      setHealth((h.data ?? null) as BillingHealth | null)
      setRetro((r.data ?? null) as RetroStats | null)
      setLoading(false)
    })
  }, [])

  const revenue = health?.revenue_by_month ?? []
  const thisMonth = revenue.length ? revenue[revenue.length - 1] : null
  const owed = health?.outstanding.amount ?? 0
  const noCard = health?.no_card ?? []
  const expiring = health?.expiring_cards ?? []
  const retroOrgs = retro?.orgs ?? []

  // Only the lists that grow with the number of businesses are paged; the
  // month-based tables are six rows by construction.
  const noCardPage = usePaged(noCard, 10)
  const expiringPage = usePaged(expiring, 10)
  const retroPage = usePaged(retroOrgs, 10)

  return (
    <Box>
      <PageHeader
        title="ბილინგი"
        subtitle="რამდენი შემოვიდა, რამდენი გვმართებს და ვისგან ვერ ჩამოვჭრით"
      />

      {/* Owed money that we have no way to collect is the one thing worth
          interrupting for — it is silent otherwise. */}
      {!loading && noCard.some(o => o.owed > 0) && (
        <Alert severity="warning" sx={{ mb: 3 }}>
          {noCard.filter(o => o.owed > 0).length} ბიზნესს აქვს დავალიანება, მაგრამ ბარათი არ აქვს
          მიბმული — ავტომატურად ვერ ჩამოიჭრება.
        </Alert>
      )}

      <Grid container spacing={2} sx={{ mb: 1 }}>
        <Grid size={{ xs: 12, sm: 6, lg: 3 }}>
          <StatCard
            label="გვმართებენ"
            value={lari(owed)}
            icon={<WarningIcon />}
            color={owed > 0 ? theme.palette.warning.main : theme.palette.success.main}
            loading={loading}
          />
        </Grid>
        <Grid size={{ xs: 12, sm: 6, lg: 3 }}>
          <StatCard
            label="ამ თვის შემოსავალი"
            value={lari(thisMonth?.revenue ?? 0)}
            icon={<InsightsOutlinedIcon />}
            color={theme.palette.primary.main}
            loading={loading}
          />
        </Grid>
        <Grid size={{ xs: 12, sm: 6, lg: 3 }}>
          <StatCard
            label="ბარათი არ აქვს"
            value={noCard.length}
            icon={<CreditCardOutlinedIcon />}
            color={noCard.length > 0 ? theme.palette.warning.main : theme.palette.success.main}
            loading={loading}
          />
        </Grid>
        <Grid size={{ xs: 12, sm: 6, lg: 3 }}>
          <StatCard
            label="ბარათს ვადა ეწურება"
            value={health?.expiring_cards.length ?? 0}
            icon={<CalendarCheckIcon />}
            color={theme.palette.info.main}
            loading={loading}
          />
        </Grid>
      </Grid>

      <Box sx={{ mt: 3 }}>
        <Section
          title="შემოსავალი თვეების მიხედვით"
          hint={`თითოეული ჯავშანი, რომელიც ანგარიშში შედის, ჯდება ₾${health?.appointment_price ?? 0}.`}
        >
          {revenue.length === 0 ? (
            <EmptyState title="ჯერ არაფერია" caption="შემოსავალი გამოჩნდება პირველი დახურული თვის შემდეგ." />
          ) : (
            <ScrollX>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>თვე</TableCell>
                    <TableCell align="right">ჯავშნები</TableCell>
                    <TableCell align="right">შემოსავალი</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {revenue.map(m => (
                    <TableRow key={m.month} hover>
                      <TableCell>{monthLabel(m.month)}</TableCell>
                      <TableCell align="right">{m.billable}</TableCell>
                      <TableCell align="right" sx={{ fontWeight: 600 }}>{lari(m.revenue)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </ScrollX>
          )}
        </Section>

        {/* 'ბარათის გარეშე' is broken out on purpose. A plain charged-vs-failed
            ratio hid the 2026-08-17 regression completely: no-card orgs were
            skipped silently and never landed in either column. */}
        <Section
          title="გადახდები"
          hint="„ბარათის გარეშე“ ნიშნავს, რომ თანხა დასაფარია, მაგრამ ჩამოსაჭრელი ბარათი არ არსებობს — ეს ცალკე ითვლება, რადგან წარმატებულ/ჩავარდნილ თანაფარდობაში საერთოდ არ ჩანს."
        >
          {(health?.collection_by_month.length ?? 0) === 0 ? (
            <EmptyState title="გადახდები ჯერ არ ყოფილა" />
          ) : (
            <ScrollX>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>თვე</TableCell>
                    <TableCell align="right">ჩამოიჭრა</TableCell>
                    <TableCell align="right">ვერ ჩამოიჭრა</TableCell>
                    <TableCell align="right">ბარათის გარეშე</TableCell>
                    <TableCell align="right">მოლოდინში</TableCell>
                    <TableCell align="right">არ დაერიცხა</TableCell>
                    <TableCell align="right">შემოსული</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {(health?.collection_by_month ?? []).map(m => (
                    <TableRow key={m.month} hover>
                      <TableCell>{monthLabel(m.month)}</TableCell>
                      <TableCell align="right">{m.charged}</TableCell>
                      <TableCell align="right">
                        {m.failed > 0
                          ? <Chip size="small" color="warning" label={m.failed} sx={{ fontWeight: 700 }} />
                          : '—'}
                      </TableCell>
                      <TableCell align="right">
                        {m.uncollectable > 0
                          ? <Chip size="small" color="error" label={m.uncollectable} sx={{ fontWeight: 700 }} />
                          : '—'}
                      </TableCell>
                      <TableCell align="right">{m.pending || '—'}</TableCell>
                      <TableCell align="right">{m.waived || '—'}</TableCell>
                      <TableCell align="right" sx={{ fontWeight: 600 }}>{lari(m.collected)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </ScrollX>
          )}
        </Section>

        <Section
          title="რა ხდება, როცა არ იხდიან"
          hint="თუ თითქმის ყველა ბოლოს იხდის — შეჩერება ნაადრევია. თუ თითქმის არავინ — შეხსენება არ მუშაობს."
        >
          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
            <Figure label="ვადაგადაცილდა" value={String(health?.dunning.past_due ?? 0)} />
            <Figure label="ბოლოს გადაიხადა" value={String(health?.dunning.recovered ?? 0)} tone="success" />
            <Figure label="შეჩერდა" value={String(health?.dunning.suspended ?? 0)} tone="error" />
            <Figure
              label="საშუალოდ გადახდამდე"
              value={health?.dunning.median_days_to_recover != null
                ? `${health.dunning.median_days_to_recover} დღე`
                : '—'}
            />
          </Box>
        </Section>

        <Section
          title="ბარათი არ აქვს მიბმული"
          hint="ამ ბიზნესებს ავტომატურად ვერ ჩამოვჭრით. დაუკავშირდით ანგარიშის დადგომამდე, არა შემდეგ."
        >
          {noCard.length === 0 ? (
            <EmptyState title="ყველას აქვს ბარათი" caption="ავტომატური ჩამოჭრა ყველასთვის მუშაობს." />
          ) : (
            <ScrollX>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>ბიზნესი</TableCell>
                    <TableCell>სტატუსი</TableCell>
                    <TableCell align="right">დავალიანება</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {noCardPage.paged.map(o => (
                    <TableRow key={o.org_id} hover>
                      <TableCell>
                        <MuiLink component={RouterLink} to={`/superadmin/orgs/${o.org_id}`} underline="hover">
                          {o.name}
                        </MuiLink>
                      </TableCell>
                      <TableCell>{o.billing_status}</TableCell>
                      <TableCell align="right" sx={{ fontWeight: o.owed > 0 ? 700 : 400 }}>
                        {o.owed > 0 ? lari(o.owed) : '—'}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </ScrollX>
          )}
          <Pager
            count={noCardPage.count}
            page={noCardPage.page}
            rowsPerPage={noCardPage.rowsPerPage}
            onPage={noCardPage.setPage}
            onRowsPerPage={noCardPage.setRowsPerPage}
          />
        </Section>

        {expiring.length > 0 && (
          <Section
            title="ბარათს ვადა ეწურება"
            hint="მომდევნო 30 დღეში. ერთი შეხსენება აქ ერთ დავალიანებას აცილებს."
          >
            <ScrollX>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>ბიზნესი</TableCell>
                    <TableCell>ბარათი</TableCell>
                    <TableCell>ვადა</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {expiringPage.paged.map(c => (
                    <TableRow key={c.org_id} hover>
                      <TableCell>
                        <MuiLink component={RouterLink} to={`/superadmin/orgs/${c.org_id}`} underline="hover">
                          {c.name}
                        </MuiLink>
                      </TableCell>
                      <TableCell>•••• {c.last4}</TableCell>
                      <TableCell>{c.expires_at}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </ScrollX>
          </Section>
        )}

        <Section
          title="გვიანი გაუქმებები"
          hint={`ჯავშანი, რომელიც შემდგარი ვიზიტის შემდეგ გაუქმდა. ${retro?.grace_hours ?? 24} საათში შესწორება უფასოა — მის შემდეგ ჯავშანი ანგარიშში რჩება. ბოლო ${retro?.window_days ?? 90} დღე.`}
        >
          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 4, mb: 3 }}>
            <Figure label="სულ ჯავშანი" value={String(retro?.totals.bookings ?? 0)} />
            <Figure label="დროული შესწორება" value={String(retro?.totals.free_corrections ?? 0)} />
            <Figure
              label="გვიან — ანგარიშში დარჩა"
              value={String(retro?.totals.retro_billed ?? 0)}
              tone={(retro?.totals.retro_billed ?? 0) > 0 ? 'warning' : undefined}
            />
          </Box>

          {retroOrgs.length === 0 ? (
            <EmptyState title="გვიანი გაუქმება არ ყოფილა" />
          ) : (
            <ScrollX>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>ბიზნესი</TableCell>
                    <TableCell align="right">ჯავშნები</TableCell>
                    <TableCell align="right">დროული შესწორება</TableCell>
                    <TableCell align="right">გვიანი</TableCell>
                    <TableCell align="right">წილი</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {retroPage.paged.map(o => (
                    <TableRow key={o.org_id} hover>
                      <TableCell>
                        <MuiLink component={RouterLink} to={`/superadmin/orgs/${o.org_id}`} underline="hover">
                          {o.name}
                        </MuiLink>
                      </TableCell>
                      <TableCell align="right">{o.bookings}</TableCell>
                      <TableCell align="right">{o.free_corrections}</TableCell>
                      <TableCell align="right">{o.retro_billed}</TableCell>
                      <TableCell align="right">
                        <Chip
                          size="small"
                          label={`${o.retro_rate_pct}%`}
                          color={o.retro_rate_pct >= 20 ? 'error' : o.retro_rate_pct >= 5 ? 'warning' : 'default'}
                          sx={{ fontWeight: 700 }}
                        />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </ScrollX>
          )}
          <Pager
            count={retroPage.count}
            page={retroPage.page}
            rowsPerPage={retroPage.rowsPerPage}
            onPage={retroPage.setPage}
            onRowsPerPage={retroPage.setRowsPerPage}
          />
        </Section>
      </Box>
    </Box>
  )
}
