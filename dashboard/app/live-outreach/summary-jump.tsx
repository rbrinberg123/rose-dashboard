"use client"

// Click delegation for the Event Summary → detail-card jump.
//
// PROGRESSIVE ENHANCEMENT. The summary rows are server-rendered as real
// `<a href="#event-...">` anchors, so the jump works with no JavaScript at all
// (native hash navigation, and `scroll-mt-*` on the card keeps it clear of the
// sticky mobile top bar). This wrapper only upgrades that: ONE delegated
// listener for the whole summary rather than a handler per row, adding smooth
// scrolling and a brief arrival flash.
//
// The flash is driven by the Web Animations API rather than a CSS class so it
// stays self-contained here — no global keyframe, and re-clicking the same row
// replays it (a CSS `:target` animation would fire only on the first arrival).
import * as React from "react"

/** Light brand-blue wash — the palette's "new" pill fill. */
const FLASH_TINT = "#EEF2FB"
const FLASH_MS = 1100

export function SummaryJumpScroller({ children }: { children: React.ReactNode }) {
  const onClick = React.useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    // Leave modified clicks alone — open-in-new-tab etc. stay the browser's job.
    if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
    const link = (e.target as HTMLElement).closest?.("a[data-jump-to]")
    const id = link instanceof HTMLElement ? link.dataset.jumpTo : null
    if (!id) return
    const target = document.getElementById(id)
    // No target (shouldn't happen) → fall through to the native anchor.
    if (!target) return

    e.preventDefault()
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches
    target.scrollIntoView({ behavior: reduced ? "auto" : "smooth", block: "start" })

    // Keep the address bar in step, but with replaceState so it does not push a
    // history entry or trigger a second, instant jump.
    history.replaceState(null, "", `#${id}`)

    if (reduced || typeof target.animate !== "function") return
    // fill defaults to "none", so the card reverts to its own white background
    // when the animation ends — nothing to clean up.
    // Hold the tint briefly so it registers after the scroll settles, then fade.
    target.animate(
      [
        { backgroundColor: FLASH_TINT, offset: 0 },
        { backgroundColor: FLASH_TINT, offset: 0.45 },
        { backgroundColor: "#FFFFFF", offset: 1 },
      ],
      { duration: FLASH_MS, easing: "ease-out" },
    )
  }, [])

  // A plain wrapper: it adds no layout of its own, just the listener.
  return <div onClick={onClick}>{children}</div>
}
