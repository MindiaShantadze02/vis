import { useEffect, useState } from 'react'
import { Link as RouterLink } from 'react-router-dom'
import {
  Box, Card, CardContent, Typography, Chip, Table, TableBody, TableCell,
  TableHead, TableRow, Link as MuiLink, Skeleton, Alert,
} from '@mui/material'
import { supabase } from '@/lib/supabase'
import { PageHeader } from '@/components/ui'

/**
 * Billing + operational health for superadmins.
 *
 * Two RPCs, deliberately kept apart: platform_billing_health answers "is revenue
 * landing?", platform_ops_health answers "is the machinery still running?". The
 * second exists because the worst bug found in the 2026-08-19 sweep was a
 * control that stopped working while nothing failed — a scheduled job that
 * quietly stops would not surface until month end without this.
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
  past_due: number; suspended: number; recovered: number
  median_days_to_recover: number | null
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

interface CronJob {
  job: string; schedule: string; active: boolean
  last_run: string | null; last_success: string | null
  failures_24h: number; stale: boolean
}
interface OtpStats {
  issued: number; verified: number; failed: number
  never_tried: number; hit_the_cap: number; failure_pct: number
}
interface OpsHealth { cron: CronJob[]; otp_7d: OtpStats }

const lari = (n: number) => `₾${Number(n ?? 0).toFixed(2)}`
const shortDate = (s: string | null) =>
  s ? new Date(s).toLocaleString('ka-GE', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—'

function Stat({ label, value, hint, tone }: {
  label: string; value: string; hint?: string; tone?: 'error' | 'warning'
}) {
  return (
    <Box sx={{ px: 2, py: 1.5, borderRadius: 2, minWidth: 170, border: '1px solid', borderColor: 'divider' }}>
      <Typography variant="caption" color="text.secondary">{label}</Typography>
      <Typography
        variant="h6"
        sx={{ fontWeight: 700, color: tone ? `${tone}.main` : 'text.primary' }}
      >
        {value}
      </Typography>
      {hint && <Typography variant="caption" color="text.secondary">{hint}</Typography>}
    </Box>
  )
}

function SectionCard({ title, hint, children }: {
  title: string; hint?: string; children: React.ReactNode
}) {
  return (
    <Card sx={{ mt: 3 }}>
      <CardContent sx={{ p: 3 }}>
        <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>{title}</Typography>
        {hint && (
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>{hint}</Typography>
        )}
        {children}
      </CardContent>
    </Card>
  )
}

export default function BillingHealthPage() {
  const [health, setHealth] = useState<BillingHealth | null>(null)
  const [ops, setOps] = useState<OpsHealth | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    Promise.all([
      supabase.rpc('platform_billing_health', { p_months: 6 }),
      supabase.rpc('platform_ops_health'),
    ]).then(([h, o]) => {
      setHealth((h.data ?? null) as BillingHealth | null)
      setOps((o.data ?? null) as OpsHealth | null)
      setLoading(false)
    })
  }, [])

  const staleJobs = (ops?.cron ?? []).filter(j => j.stale || j.failures_24h > 0)

  return (
    <Box>
      <PageHeader
        title="ბილინგის მდგომარეობა"
        subtitle="შემოსავალი, ამოღება და სისტემური პროცესები"
      />

      {loading ? (
        <Skeleton variant="rounded" height={140} />
      ) : (
        <>
          {/* A stopped job is the failure nobody notices — surface it above everything. */}
          {staleJobs.length > 0 && (
            <Alert severity="error" sx={{ mb: 3 }}>
              დაგეგმილი პროცესი არ მუშაობს:{' '}
              {staleJobs.map(j => j.job).join(', ')}
            </Alert>
          )}

          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 2 }}>
            <Stat
              label="დაუფარავი ბალანსი"
              value={lari(health?.outstanding.amount ?? 0)}
              hint={`${health?.outstanding.orgs ?? 0} ორგანიზაცია · ${health?.outstanding.periods ?? 0} პერიოდი`}
              tone={(health?.outstanding.amount ?? 0) > 0 ? 'warning' : undefined}
            />
            <Stat
              label="ბარათის გარეშე"
              value={String(health?.no_card.length ?? 0)}
              hint="ვერ ჩამოვჭრით"
              tone={(health?.no_card.length ?? 0) > 0 ? 'warning' : undefined}
            />
            <Stat
              label="ვადა იწურება (30 დღე)"
              value={String(health?.expiring_cards.length ?? 0)}
              hint="ბარათი"
            />
            <Stat
              label="ვერიფიკაციის ჩავარდნა (7 დღე)"
              value={`${ops?.otp_7d.failure_pct ?? 0}%`}
              hint={`${ops?.otp_7d.failed ?? 0} / ${(ops?.otp_7d.verified ?? 0) + (ops?.otp_7d.failed ?? 0)}`}
              tone={(ops?.otp_7d.failure_pct ?? 0) >= 25 ? 'error' : undefined}
            />
          </Box>

          {/* Collection — uncollectable is broken out on purpose: a charged/failed
              ratio alone hid the 2026-08-17 no-card regression completely. */}
          <SectionCard
            title="ამოღება თვეების მიხედვით"
            hint="„ვერ ამოღებადი“ = გადასახდელი დადგა, მაგრამ ბარათი არ არის. ეს ცალკე ისმება, რადგან მხოლოდ ჩამოჭრილი/ჩავარდნილი თანაფარდობა ასეთ შემთხვევებს ვერ ხედავს."
          >
            <Box sx={{ overflowX: 'auto' }}>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>თვე</TableCell>
                    <TableCell align="right">ჩამოიჭრა</TableCell>
                    <TableCell align="right">ჩავარდა</TableCell>
                    <TableCell align="right">ვერ ამოღებადი</TableCell>
                    <TableCell align="right">მოლოდინში</TableCell>
                    <TableCell align="right">გაუქმდა</TableCell>
                    <TableCell align="right">ამოღებული</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {(health?.collection_by_month ?? []).map(m => (
                    <TableRow key={m.month} hover>
                      <TableCell>{m.month}</TableCell>
                      <TableCell align="right">{m.charged}</TableCell>
                      <TableCell align="right">{m.failed}</TableCell>
                      <TableCell align="right">
                        {m.uncollectable > 0
                          ? <Chip size="small" color="error" label={m.uncollectable} sx={{ fontWeight: 700 }} />
                          : 0}
                      </TableCell>
                      <TableCell align="right">{m.pending}</TableCell>
                      <TableCell align="right">{m.waived}</TableCell>
                      <TableCell align="right">{lari(m.collected)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Box>
          </SectionCard>

          <SectionCard
            title="შემოსავალი თვეების მიხედვით"
            hint={`ანგარიშსწორებადი ჯავშნები × ₾${health?.appointment_price ?? 0}`}
          >
            <Box sx={{ overflowX: 'auto' }}>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>თვე</TableCell>
                    <TableCell align="right">ჯავშნები</TableCell>
                    <TableCell align="right">შემოსავალი</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {(health?.revenue_by_month ?? []).map(m => (
                    <TableRow key={m.month} hover>
                      <TableCell>{m.month}</TableCell>
                      <TableCell align="right">{m.billable}</TableCell>
                      <TableCell align="right">{lari(m.revenue)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Box>
          </SectionCard>

          {/* Whether the grace/retry settings are tuned right. */}
          <SectionCard
            title="დავალიანების პროცესი"
            hint="თუ თითქმის ყველა აღდგება — შეჩერება ნაადრევია; თუ თითქმის არავინ — პროცესი არ მუშაობს."
          >
            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 2 }}>
              <Stat label="ვადაგადაცილებული" value={String(health?.dunning.past_due ?? 0)} />
              <Stat label="აღდგა" value={String(health?.dunning.recovered ?? 0)} />
              <Stat label="შეჩერდა" value={String(health?.dunning.suspended ?? 0)} />
              <Stat
                label="აღდგენის მედიანა"
                value={health?.dunning.median_days_to_recover != null
                  ? `${health.dunning.median_days_to_recover} დღე`
                  : '—'}
              />
            </Box>
          </SectionCard>

          <SectionCard
            title="ბარათის გარეშე"
            hint="ამ ბიზნესებს ვერ ჩამოვჭრით — დაუკავშირდით ანგარიშის დადგომამდე."
          >
            {(health?.no_card.length ?? 0) === 0 ? (
              <Typography variant="body2" color="text.secondary">ყველას აქვს ბარათი.</Typography>
            ) : (
              <Box sx={{ overflowX: 'auto' }}>
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell>ორგანიზაცია</TableCell>
                      <TableCell>სტატუსი</TableCell>
                      <TableCell align="right">დავალიანება</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {(health?.no_card ?? []).map(o => (
                      <TableRow key={o.org_id} hover>
                        <TableCell>
                          <MuiLink component={RouterLink} to={`/superadmin/orgs/${o.org_id}`} underline="hover">
                            {o.name}
                          </MuiLink>
                        </TableCell>
                        <TableCell>{o.billing_status}</TableCell>
                        <TableCell align="right">{lari(o.owed)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </Box>
            )}
          </SectionCard>

          {(health?.expiring_cards.length ?? 0) > 0 && (
            <SectionCard title="ბარათებს ვადა იწურება (30 დღე)">
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>ორგანიზაცია</TableCell>
                    <TableCell>ბარათი</TableCell>
                    <TableCell>ვადა</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {(health?.expiring_cards ?? []).map(c => (
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
            </SectionCard>
          )}

          <SectionCard
            title="დაგეგმილი პროცესები"
            hint="გაჩერებული პროცესი ჩუმად ვარდება — ბოლო წარმატებული გაშვება ერთადერთი ნიშანია."
          >
            <Box sx={{ overflowX: 'auto' }}>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>პროცესი</TableCell>
                    <TableCell>განრიგი</TableCell>
                    <TableCell>ბოლო წარმატება</TableCell>
                    <TableCell align="right">შეცდომა (24სთ)</TableCell>
                    <TableCell align="right">მდგომარეობა</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {(ops?.cron ?? []).map(j => (
                    <TableRow key={j.job} hover>
                      <TableCell>{j.job}</TableCell>
                      <TableCell><code>{j.schedule}</code></TableCell>
                      <TableCell>{shortDate(j.last_success)}</TableCell>
                      <TableCell align="right">{j.failures_24h}</TableCell>
                      <TableCell align="right">
                        <Chip
                          size="small"
                          label={j.stale ? 'გაჩერდა' : 'აქტიური'}
                          color={j.stale ? 'error' : 'success'}
                          sx={{ fontWeight: 700 }}
                        />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Box>
          </SectionCard>

          <SectionCard
            title="ვერიფიკაცია (7 დღე)"
            hint="ჩავარდნის მკვეთრი ზრდა ან შეტევაა, ან ჩვენი შეცდომა."
          >
            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 2 }}>
              <Stat label="გაიგზავნა" value={String(ops?.otp_7d.issued ?? 0)} />
              <Stat label="დადასტურდა" value={String(ops?.otp_7d.verified ?? 0)} />
              <Stat label="ჩავარდა" value={String(ops?.otp_7d.failed ?? 0)} />
              <Stat label="ლიმიტს მიაღწია" value={String(ops?.otp_7d.hit_the_cap ?? 0)} />
              <Stat label="არ უცდიათ" value={String(ops?.otp_7d.never_tried ?? 0)} />
            </Box>
          </SectionCard>
        </>
      )}
    </Box>
  )
}
