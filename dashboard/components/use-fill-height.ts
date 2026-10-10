"use client"

import * as React from "react"

/**
 * FILL THE PAGE — sizes a CRM table's scroll body so the table reaches the
 * bottom of the window, whatever sits above it.
 *
 * WHY MEASURED, NOT A PURE-CSS HEIGHT CHAIN: what stands above the table varies
 * per viewer and per route — the View-As banner, the section-nav strip, a
 * masthead, a toolbar that wraps to two lines on a narrow screen. A fixed
 * `calc(100vh - 16rem)` guessed at all of that and left a gap (or overflowed);
 * a full-height flex chain would mean making <main> the scroller for EVERY page
 * in the root layout. Measuring the table's own top edge is exact everywhere
 * and touches nothing outside the CRM pages.
 *
 * HOW: writes `--crm-fill-h` (px) on the card = window height − the scroll
 * container's top (page coordinates) − `bottomGap` (the page's bottom padding +
 * the card's border). CRM_TABLE_DENSITY.scroller reads it as the container's
 * height, so the BODY scrolls inside the table (sticky header + sticky toolbar)
 * and the page itself does not — no double scrollbar. Re-measured on window
 * resize and whenever anything above the table changes height (ResizeObserver
 * on <body>). `min-h-[300px]` in the scroller keeps a short laptop screen usable;
 * below that the page scrolls instead. Until hydration the CSS fallback (the old
 * calc) applies, so first paint is unchanged.
 */
export function useFillHeight(cardRef: React.RefObject<HTMLElement | null>, bottomGap = 25) {
  React.useEffect(() => {
    const card = cardRef.current
    const el = card?.querySelector<HTMLElement>("[data-slot=table-container]")
    if (!card || !el) return
    // Synchronous on purpose: ResizeObserver already batches, and the value only
    // changes when the layout above the table does, so it settles in one pass
    // (setting the same height again changes nothing and fires nothing).
    const measure = () => {
      const top = el.getBoundingClientRect().top + window.scrollY
      const h = Math.floor(window.innerHeight - top - bottomGap)
      card.style.setProperty("--crm-fill-h", `${h}px`)
    }
    measure()
    window.addEventListener("resize", measure)
    const ro = new ResizeObserver(measure)
    ro.observe(document.body)
    return () => {
      window.removeEventListener("resize", measure)
      ro.disconnect()
    }
  }, [cardRef, bottomGap])
}
