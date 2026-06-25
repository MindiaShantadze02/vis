import type { Variants, Transition } from 'framer-motion'

// ── Shared motion language ────────────────────────────────────
// Framer Motion equivalents of the CSS keyframes in animations.ts.
// Everything reuses the same cubic-bezier the MUI theme already uses
// (transitions in theme.ts, the LinearProgress bar, etc.) so motion
// added with Framer feels native to the existing UI rather than
// bolted-on. Keep durations in the 0.15–0.35s band used elsewhere.

/** The easing curve used across the whole app (cubic-bezier(0.16,1,0.3,1)). */
export const EASE = [0.16, 1, 0.3, 1] as const

export const DURATION = {
  fast:   0.2,
  base:   0.3,
  slow:   0.35,
} as const

export const baseTransition: Transition = { duration: DURATION.base, ease: EASE }

// ── Item variants ─────────────────────────────────────────────

/** Mirrors the `fadeInUp` keyframe (opacity + 16px rise). */
export const fadeInUp: Variants = {
  hidden:  { opacity: 0, y: 16 },
  visible: { opacity: 1, y: 0, transition: { duration: DURATION.slow, ease: EASE } },
}

/** Mirrors the `scaleIn` keyframe (opacity + scale 0.94→1). */
export const scaleIn: Variants = {
  hidden:  { opacity: 0, scale: 0.94 },
  visible: { opacity: 1, scale: 1, transition: { duration: DURATION.fast, ease: EASE } },
}

/** Mirrors the `slideInLeft` keyframe (opacity + 12px from left). */
export const slideInLeft: Variants = {
  hidden:  { opacity: 0, x: -12 },
  visible: { opacity: 1, x: 0, transition: { duration: DURATION.base, ease: EASE } },
}

// ── Staggered lists ───────────────────────────────────────────
// Parent orchestrates children; pair `staggerContainer` on the wrapper
// with `listItem` on each child. Matches the ~50–60ms manual stagger
// already used in DashboardLayout nav + Step1 service cards.

export const staggerContainer: Variants = {
  hidden:  {},
  visible: { transition: { staggerChildren: 0.05, delayChildren: 0.02 } },
}

export const listItem: Variants = {
  hidden:  { opacity: 0, y: 12 },
  visible: { opacity: 1, y: 0, transition: { duration: DURATION.base, ease: EASE } },
}

// ── Route / page transitions ──────────────────────────────────
// Used with <AnimatePresence mode="wait"> keyed on the route. A quick
// fade + small rise so navigation feels intentional, not instant.

export const pageTransition: Variants = {
  initial: { opacity: 0, y: 8 },
  animate: { opacity: 1, y: 0, transition: { duration: DURATION.base, ease: EASE } },
  exit:    { opacity: 0, y: -8, transition: { duration: DURATION.fast, ease: EASE } },
}

/** Directional slide for the multi-step booking flow. `dir` is +1 (forward) or -1 (back). */
export const stepVariants = {
  enter:  (dir: number) => ({ opacity: 0, x: dir > 0 ? 40 : -40 }),
  center: { opacity: 1, x: 0, transition: { duration: DURATION.base, ease: EASE } },
  exit:   (dir: number) => ({ opacity: 0, x: dir > 0 ? -40 : 40, transition: { duration: DURATION.fast, ease: EASE } }),
}

/** Gentle attention pulse (e.g. scarcity "N left" cue). */
export const pulse: Variants = {
  rest:   { scale: 1 },
  pulse:  { scale: [1, 1.06, 1], transition: { duration: 1.6, ease: 'easeInOut', repeat: Infinity } },
}
