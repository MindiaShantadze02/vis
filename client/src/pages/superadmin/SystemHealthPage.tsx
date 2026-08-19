import { useEffect, useState } from 'react'
import {
  Box, Grid, Typography, Chip, Table, TableBody, TableCell, TableHead, TableRow,
  Alert, useTheme,
} from '@mui/material'
import { ScheduleOutlined as ScheduleIcon } from '@/components/icons'
import { SmsOutlined as SmsIcon } from '@/components/icons'
import { supabase } from '@/lib/supabase'
import { PageHeader, StatCard } from '@/components/ui'
import { Section, ScrollX } from './_shared'
import { dateTime } from './format'

/**
 * Machine health, split out from the billing page because it answers a different
 * question: not "did the money arrive" but "is anything still running".
 *
 * This page exists because of the 2026-08-17 regression — a billing control
 * stopped working and NOTHING failed. The same shape of failure applies to the
 * scheduled jobs: if the nightly close quietly stops, nobody finds out until
 * month end, when there are no invoices. A last-successful-run column is the
 * only thing that makes that visible in time.
 */

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

/** Plain-language description of what each scheduled job is actually for. */
const JOB_PURPOSE: Record<string, string> = {
  'billing-close': 'თვის ანგარიშის დახურვა',
  'billing-charge': 'თანხის ჩამოჭრა',
  'complete-elapsed-appointments': 'გასული ჯავშნების დასრულება',
  'dispatch-appointment-reminders': 'შეხსენების SMS',
  'purge-expired-data': 'ვადაგასული მონაცემების წაშლა',
  'reject-elapsed-pending': 'დაუდასტურებელი ჯავშნების გაუქმება',
}

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

export default function SystemHealthPage() {
  const theme = useTheme()
  const [ops, setOps] = useState<OpsHealth | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    supabase.rpc('platform_ops_health').then(({ data }) => {
      setOps((data ?? null) as OpsHealth | null)
      setLoading(false)
    })
  }, [])

  const jobs = ops?.cron ?? []
  const broken = jobs.filter(j => j.stale || j.failures_24h > 0)
  const otp = ops?.otp_7d
  const answered = (otp?.verified ?? 0) + (otp?.failed ?? 0)

  return (
    <Box>
      <PageHeader
        title="სისტემა"
        subtitle="ავტომატური პროცესები და SMS დადასტურება"
      />

      {/* A stopped job is the failure nobody notices. Put it above everything. */}
      {!loading && broken.length > 0 && (
        <Alert severity="error" sx={{ mb: 3 }}>
          შეჩერებულია: {broken.map(j => JOB_PURPOSE[j.job] ?? j.job).join(', ')}
        </Alert>
      )}
      {!loading && broken.length === 0 && jobs.length > 0 && (
        <Alert severity="success" sx={{ mb: 3 }}>
          ყველა ავტომატური პროცესი მუშაობს.
        </Alert>
      )}

      <Grid container spacing={2}>
        <Grid size={{ xs: 12, sm: 6 }}>
          <StatCard
            label="გაჩერებული პროცესი"
            value={broken.length}
            icon={<ScheduleIcon />}
            color={broken.length > 0 ? theme.palette.error.main : theme.palette.success.main}
            loading={loading}
          />
        </Grid>
        <Grid size={{ xs: 12, sm: 6 }}>
          <StatCard
            label="არასწორი კოდი (7 დღე)"
            value={`${otp?.failure_pct ?? 0}%`}
            icon={<SmsIcon />}
            color={(otp?.failure_pct ?? 0) >= 25 ? theme.palette.error.main : theme.palette.primary.main}
            loading={loading}
          />
        </Grid>
      </Grid>

      <Box sx={{ mt: 3 }}>
        <Section
          title="ავტომატური პროცესები"
          hint="გაჩერებული პროცესი ხმას არ იღებს — ბოლო წარმატებული გაშვება ერთადერთი ნიშანია, რომ ჯერ კიდევ მუშაობს."
        >
          <ScrollX>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>რას აკეთებს</TableCell>
                  <TableCell>სიხშირე</TableCell>
                  <TableCell>ბოლოს იმუშავა</TableCell>
                  <TableCell align="right">შეცდომა (24სთ)</TableCell>
                  <TableCell align="right">მდგომარეობა</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {jobs.map(j => (
                  <TableRow key={j.job} hover>
                    <TableCell>
                      <Typography variant="body2" sx={{ fontWeight: 500 }}>
                        {JOB_PURPOSE[j.job] ?? j.job}
                      </Typography>
                      <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                        {j.job}
                      </Typography>
                    </TableCell>
                    <TableCell>
                      <Typography variant="caption" sx={{ fontFamily: 'monospace' }}>
                        {j.schedule}
                      </Typography>
                    </TableCell>
                    <TableCell>{dateTime(j.last_success)}</TableCell>
                    <TableCell align="right">
                      {j.failures_24h > 0
                        ? <Chip size="small" color="error" label={j.failures_24h} sx={{ fontWeight: 700 }} />
                        : '—'}
                    </TableCell>
                    <TableCell align="right">
                      <Chip
                        size="small"
                        label={j.stale ? 'გაჩერდა' : 'მუშაობს'}
                        color={j.stale ? 'error' : 'success'}
                        sx={{ fontWeight: 700 }}
                      />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </ScrollX>
        </Section>

        <Section
          title="SMS დადასტურება"
          hint="ბოლო 7 დღე. არასწორი კოდების მკვეთრი ზრდა ან შეტევაა, ან ჩვენი მხრიდან შეცდომა — ორივე შემთხვევაში აქ ჩანს პირველად."
        >
          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
            <Figure label="გაიგზავნა" value={String(otp?.issued ?? 0)} />
            <Figure label="დადასტურდა" value={String(otp?.verified ?? 0)} tone="success" />
            <Figure
              label="არასწორი კოდი"
              value={String(otp?.failed ?? 0)}
              tone={(otp?.failure_pct ?? 0) >= 25 ? 'error' : undefined}
            />
            <Figure
              label="დაიბლოკა"
              value={String(otp?.hit_the_cap ?? 0)}
              tone={(otp?.hit_the_cap ?? 0) > 0 ? 'warning' : undefined}
            />
            <Figure label="არ სცადეს" value={String(otp?.never_tried ?? 0)} />
          </Box>
          <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block', mt: 2 }}>
            პროცენტი ითვლება მხოლოდ იმ კოდებზე, რომლებზეც პასუხი გაეცა ({answered}) — გაგზავნილი,
            მაგრამ უპასუხოდ დარჩენილი კოდები არ ითვლება.
          </Typography>
        </Section>
      </Box>
    </Box>
  )
}
