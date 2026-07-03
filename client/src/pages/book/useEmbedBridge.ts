import { useEffect } from 'react'

// True when the app is running inside an iframe (any embedding site). Comparing
// window.self/top is allowed cross-origin (only *reading properties* of a
// cross-origin top would throw), so this is safe. A rare throw ⇒ treat as framed.
export const inIframe: boolean = (() => {
  try {
    return window.self !== window.top
  } catch {
    return true
  }
})()

interface VisMessage {
  type: 'vis:resize' | 'vis:booked' | 'vis:redirect'
  [k: string]: unknown
}

/** Post a message to the embedding page (no-op when not framed). */
export function postToParent(msg: VisMessage): void {
  if (inIframe) window.parent.postMessage({ source: 'vis', ...msg }, '*')
}

/**
 * When embedded, continuously report the document height to the parent so the
 * host's embed.js can size the iframe to its content (no fixed height, no empty
 * band, no clipping). Mounted once, app-wide; a no-op outside an iframe.
 */
export function EmbedBridge(): null {
  useEffect(() => {
    if (!inIframe) return

    let raf = 0
    const send = () => {
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(() => {
        // Measure the app content, NOT documentElement.scrollHeight — the latter is
        // floored to the iframe's own viewport height, so it can never shrink below
        // the current iframe height (a feedback loop). #root hugs its content.
        const root = document.getElementById('root')
        const h = Math.ceil(root ? root.getBoundingClientRect().height : document.body.scrollHeight)
        if (h > 0) postToParent({ type: 'vis:resize', height: h })
      })
    }

    const ro = new ResizeObserver(send)
    ro.observe(document.body)
    window.addEventListener('load', send)

    // The host's embed.js loads async and may attach its listener AFTER our first
    // height burst. It pings us ('vis:hello') once ready; we reply with the height.
    const onHostMessage = (e: MessageEvent) => {
      const d = e.data as { source?: string; type?: string } | null
      if (d && d.source === 'vis-host' && d.type === 'vis:hello') send()
    }
    window.addEventListener('message', onHostMessage)

    send()
    // Belt-and-suspenders resends to cover a late-attaching host on a static step.
    const timers = [200, 600, 1200].map(ms => window.setTimeout(send, ms))

    return () => {
      cancelAnimationFrame(raf)
      ro.disconnect()
      window.removeEventListener('load', send)
      window.removeEventListener('message', onHostMessage)
      timers.forEach(clearTimeout)
    }
  }, [])

  return null
}
