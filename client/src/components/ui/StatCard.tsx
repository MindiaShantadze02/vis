import { useEffect, type ReactNode } from 'react'
import { Card, CardContent, Box, Typography, Skeleton } from '@mui/material'
import { motion, animate, useMotionValue, useTransform } from 'framer-motion'
import { EASE, fadeInUp } from '@/theme/motion'

interface StatCardProps {
  label: string
  value: string | number
  icon: ReactNode
  /** Resolved color string (pass a theme palette token, e.g. theme.palette.primary.main). */
  color: string
  loading?: boolean
}

/**
 * Counts the leading integer of `value` up from 0 on mount, preserving any
 * prefix/suffix (e.g. the "₾" on revenue). Falls back to rendering the value
 * verbatim when it has no integer to animate (or a decimal we leave static).
 * Driven by a motion value so the count-up writes straight to the DOM without
 * triggering React re-renders.
 */
function AnimatedValue({ value }: { value: string | number }) {
  const text = String(value)
  const match = text.match(/^(.*?)(\d[\d,]*)(.*)$/)
  const target = match ? parseInt(match[2].replace(/,/g, ''), 10) : NaN

  const count = useMotionValue(0)
  const display = useTransform(count, v =>
    match && Number.isFinite(target) ? `${match[1]}${Math.round(v)}${match[3]}` : text,
  )

  useEffect(() => {
    if (!Number.isFinite(target)) return
    const controls = animate(count, target, { duration: 0.8, ease: EASE })
    return () => controls.stop()
  }, [target, count])

  if (!Number.isFinite(target)) return <>{text}</>
  return <motion.span>{display}</motion.span>
}

/**
 * Metric card with a tinted icon badge. Extracted from OverviewPage so
 * the stat grid is consistent and the tint derives from a real color
 * via MUI's `alpha` (no fragile `${color}15` hex concatenation).
 */
export default function StatCard({ label, value, icon, color, loading }: StatCardProps) {
  return (
    <Card
      data-testid="stat-card"
      component={motion.div}
      variants={fadeInUp}
      initial="hidden"
      animate="visible"
    >
      <CardContent sx={{ display: 'flex', alignItems: 'flex-start', gap: 2 }}>
        <Box
          sx={{
            width: 44, height: 44, borderRadius: 2,
            bgcolor: 'rgba(30,36,51,0.05)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            color, flexShrink: 0,
          }}
        >
          {icon}
        </Box>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography variant="caption" sx={{ color: 'text.secondary', overflowWrap: 'anywhere' }}>{label}</Typography>
          {loading
            ? <Skeleton width={80} height={36} />
            : <Typography variant="h5" sx={{ fontWeight: 700, mt: 0.25 }}><AnimatedValue value={value} /></Typography>
          }
        </Box>
      </CardContent>
    </Card>
  )
}

export interface StatItem {
  label: string
  value: string | number
  icon: ReactNode
  /** Resolved colour string (e.g. theme.palette.primary.main). */
  color: string
}

/**
 * A single panel of metrics split by hairline dividers — a "stat strip". Reads
 * as one cohesive band instead of a row of individually-boxed cards (the KPI
 * cliché). Segments sit side by side on desktop and stack on mobile.
 */
export function StatStrip({ items, loading }: { items: StatItem[]; loading?: boolean }) {
  // Mobile packs the segments 2-up instead of stacking four full-width rows
  // (which pushed the content below them under the fold).
  const lastRowStart = items.length - 2
  return (
    <Card
      component={motion.div}
      variants={fadeInUp}
      initial="hidden"
      animate="visible"
      sx={{
        mb: 4,
        display: { xs: 'grid', sm: 'flex' },
        gridTemplateColumns: '1fr 1fr',
        flexDirection: { sm: 'row' },
      }}
    >
      {items.map((it, i) => (
        <Box
          key={i}
          sx={{
            flex: 1,
            display: 'flex',
            // Mobile stacks the segment vertically (icon over label over value),
            // centred — the horizontal row only starts at the sm breakpoint.
            flexDirection: { xs: 'column', sm: 'row' },
            alignItems: 'center',
            textAlign: { xs: 'center', sm: 'left' },
            gap: { xs: 1, sm: 1.75 },
            p: 2.5,
            minWidth: 0,
            borderColor: 'divider',
            borderStyle: 'solid',
            borderWidth: 0,
            // Desktop: hairline between horizontal segments. Mobile 2×2 grid:
            // hairline after odd columns and under the top row.
            ...(i < items.length - 1 && {
              borderRightWidth: { xs: i % 2 === 0 ? '1px' : 0, sm: '1px' },
            }),
            ...(i < lastRowStart && {
              borderBottomWidth: { xs: '1px', sm: 0 },
            }),
          }}
        >
          <Box
            sx={{
              width: 44, height: 44, borderRadius: 2, flexShrink: 0,
              bgcolor: 'rgba(30,36,51,0.05)', color: it.color,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}
          >
            {it.icon}
          </Box>
          <Box sx={{ minWidth: 0 }}>
            <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block', overflowWrap: 'anywhere' }}>{it.label}</Typography>
            {loading
              ? <Skeleton width={64} height={32} />
              : <Typography variant="h5" sx={{ fontWeight: 700, mt: 0.25 }}><AnimatedValue value={it.value} /></Typography>
            }
          </Box>
        </Box>
      ))}
    </Card>
  )
}
