import { useEffect, type ReactNode } from 'react'
import { Card, CardContent, Box, Typography, Skeleton } from '@mui/material'
import { alpha } from '@mui/material/styles'
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
      whileHover={{ y: -2 }}
    >
      <CardContent sx={{ display: 'flex', alignItems: 'flex-start', gap: 2 }}>
        <Box
          sx={{
            width: 48, height: 48, borderRadius: 2,
            bgcolor: alpha(color, 0.12),
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            color, flexShrink: 0,
          }}
        >
          {icon}
        </Box>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography variant="caption" sx={{ color: 'text.secondary' }}>{label}</Typography>
          {loading
            ? <Skeleton width={80} height={36} />
            : <Typography variant="h5" sx={{ fontWeight: 700, mt: 0.25 }}><AnimatedValue value={value} /></Typography>
          }
        </Box>
      </CardContent>
    </Card>
  )
}
