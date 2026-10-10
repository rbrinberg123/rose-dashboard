"use client"

import * as React from "react"

/**
 * FIT THE COLUMNS TO THE CONTAINER — the structural fix for CRM tables
 * overflowing sideways.
 *
 * DIAGNOSED (2026-10-10): every CRM table set `min-width` = the SUM of its
 * fixed px column widths, with automatic table layout. So the table could never
 * be narrower than that sum, whatever the window: at 1366px with the sidebar
 * EXPANDED (256px, not 58) every table but Touches overflowed by 81–127px, and
 * at 1280px (a 1920 laptop at 150%) five tables overflowed by 1–15px. Auto
 * layout also let unbreakable content widen a column past its declared width
 * (the Tasks Status pill 117px in a 104px column, Meetings FB Status, the
 * Clients avatar columns). The 15px vertical-scrollbar gutter was NOT a cause:
 * clientWidth already excludes it.
 *
 * THE FIX: measure the scroll container and share its width out.
 *   - FIXED columns keep their declared width: content that cannot shrink —
 *     dates, numbers, avatar circles, tickers, check/flag marks.
 *   - FLEXIBLE columns (text, titles, notes, pills, links) absorb the
 *     difference, scaled down proportionally, each to a floor of half its
 *     declared width (min 64px); their cells truncate with the full value on
 *     hover, so nothing is lost.
 *   - Only when the container is narrower than every floor added up does the
 *     table scroll sideways (Clients and Meetings keep their frozen identity
 *     columns then). `minWidth` is that floor.
 * The views pair this with `table-fixed` + a <colgroup>, so the widths handed
 * out here are binding: no cell's min-content can push a column wider.
 *
 * Before the first measurement (server render / first paint) the declared
 * widths are used, i.e. exactly the old behaviour.
 */

type FitColumn = { key: string; width: string; compact?: boolean; renderer?: string }

const FLEX_RENDERERS = new Set(["text", "body", "subject", "title", "regarding", "url", "statePill", "statusPill"])
const FLOOR_RATIO = 0.5
const FLOOR_MIN = 64

function declared(c: FitColumn): number {
  return parseInt(c.width, 10) || 100
}

function isFlexible(c: FitColumn): boolean {
  if (c.compact) return false
  const w = declared(c)
  if (c.renderer === "people") return w >= 140 // avatar + name (Contacts' Contact column)
  return w >= 100 && FLEX_RENDERERS.has(c.renderer ?? "text")
}

/** Pure: the fitted px width per column, plus the table's floor width. */
export function fitColumns<T extends FitColumn>(
  columns: readonly T[],
  containerWidth: number | null,
  extraPx: number,
): { fitted: T[]; minWidth: number } {
  let fixed = extraPx
  let flex = 0
  let floor = 0
  for (const c of columns) {
    if (isFlexible(c)) {
      flex += declared(c)
      floor += Math.max(FLOOR_MIN, Math.round(declared(c) * FLOOR_RATIO))
    } else {
      fixed += declared(c)
    }
  }
  const minWidth = fixed + floor
  // Unmeasured, or room for everything at its declared width: unchanged.
  if (containerWidth === null || flex === 0 || containerWidth >= fixed + flex) {
    return { fitted: columns.map((c) => ({ ...c, width: `${declared(c)}px` })), minWidth: Math.min(minWidth, fixed + flex) }
  }
  const scale = Math.max(0, (containerWidth - fixed) / flex)
  const fitted = columns.map((c) => {
    if (!isFlexible(c)) return { ...c, width: `${declared(c)}px` }
    const w = Math.max(Math.max(FLOOR_MIN, Math.round(declared(c) * FLOOR_RATIO)), Math.floor(declared(c) * scale))
    return { ...c, width: `${w}px` }
  })
  return { fitted, minWidth }
}

/**
 * Hook form: observes the card's scroll container (`[data-slot=table-container]`)
 * and returns the columns with fitted px widths + the table's min-width.
 * `extraPx` = the non-data columns (the 36px open-record column, Clients' Jump to).
 */
export function useFitColumns<T extends FitColumn>(
  cardRef: React.RefObject<HTMLElement | null>,
  columns: readonly T[],
  extraPx: number,
): { fitted: T[]; minWidth: number } {
  const [containerWidth, setContainerWidth] = React.useState<number | null>(null)
  React.useEffect(() => {
    const el = cardRef.current?.querySelector<HTMLElement>("[data-slot=table-container]")
    if (!el) return
    const sync = () => setContainerWidth(el.clientWidth)
    sync()
    const ro = new ResizeObserver(sync)
    ro.observe(el)
    return () => ro.disconnect()
  }, [cardRef])
  return React.useMemo(() => fitColumns(columns, containerWidth, extraPx), [columns, containerWidth, extraPx])
}
