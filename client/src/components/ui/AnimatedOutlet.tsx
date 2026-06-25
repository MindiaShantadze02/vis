import { useLocation, useOutlet } from 'react-router-dom'
import { AnimatePresence, motion } from 'framer-motion'
import { pageTransition } from '@/theme/motion'

/**
 * Drop-in replacement for react-router's <Outlet> that animates route changes
 * with a quick fade + rise (see `pageTransition`). `mode="wait"` lets the old
 * page finish exiting before the new one enters, keyed on the pathname so
 * navigating between sibling routes triggers the transition.
 *
 * Honours reduced-motion globally via <MotionConfig> in main.tsx.
 */
export default function AnimatedOutlet({ context }: { context?: unknown }) {
  const location = useLocation()
  const outlet = useOutlet(context)

  return (
    <AnimatePresence mode="wait" initial={false}>
      <motion.div
        key={location.pathname}
        variants={pageTransition}
        initial="initial"
        animate="animate"
        exit="exit"
      >
        {outlet}
      </motion.div>
    </AnimatePresence>
  )
}
