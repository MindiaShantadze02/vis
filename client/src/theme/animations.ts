import { keyframes } from '@emotion/react'

export const fadeInUp = keyframes`
  from { opacity: 0; transform: translateY(16px); }
  to   { opacity: 1; transform: translateY(0); }
`

export const fadeIn = keyframes`
  from { opacity: 0; }
  to   { opacity: 1; }
`

export const scaleIn = keyframes`
  from { opacity: 0; transform: scale(0.94); }
  to   { opacity: 1; transform: scale(1); }
`

export const slideInLeft = keyframes`
  from { opacity: 0; transform: translateX(-12px); }
  to   { opacity: 1; transform: translateX(0); }
`

export const anim = {
  fadeInUp:    `${fadeInUp}    0.35s cubic-bezier(0.16,1,0.3,1) both`,
  fadeIn:      `${fadeIn}      0.25s ease both`,
  scaleIn:     `${scaleIn}     0.25s cubic-bezier(0.16,1,0.3,1) both`,
  slideInLeft: `${slideInLeft} 0.3s  cubic-bezier(0.16,1,0.3,1) both`,
}
