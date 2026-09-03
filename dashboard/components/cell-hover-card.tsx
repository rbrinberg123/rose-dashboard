"use client"

import * as React from "react"
import { createPortal } from "react-dom"
import type { LucideIcon } from "lucide-react"

import { cn } from "@/lib/utils"

/**
 * A small icon in a table cell that reveals a paragraph of text on hover, on
 * focus, or on tap.
 *
 * WHY THE PANEL IS PORTALLED — the same fix the collapsed nav rail's fly-out
 * uses (components/nav.tsx, useFlyout). Two separate things clip a panel
 * rendered inline in a table cell, and a z-index alone beats neither:
 *
 *   1. The table's scroll wrapper is `overflow-x: auto`, which makes overflow-y
 *      compute to auto too — so it clips on BOTH axes and an absolutely
 *      positioned child is cut off at the cell's edge. Hence `position: fixed`,
 *      anchored off the trigger's measured rect.
 *   2. The sticky <thead> (z-20) and the sticky frozen columns (z-10/z-30) each
 *      establish their own stacking context — `position: sticky` always does,
 *      unlike relative/absolute, which need a z-index first. A panel inside one
 *      of those cells is capped inside that context's layer, so a neighbouring
 *      sticky cell can still paint over it however high the panel's z-index is.
 *      Portalling to <body> lifts it out, where its z-index competes at the
 *      root.
 *
 * z-[60] matches the nav fly-out — clear of sticky headers (z-20), frozen
 * columns and hover cards (z-30), and the sidebar (z-40).
 */

/** Panel width. Wide enough for a readable measure (~55 characters), narrow
 *  enough to sit beside a table cell without covering the row it describes. */
const PANEL_W = 340

/** Gap between the trigger icon and the panel. Small enough that the pointer
 *  crosses it well inside the close grace period. */
const GAP = 8

/** Viewport margin the panel keeps on every side. */
const EDGE = 8

/** Below this much room underneath the icon, the panel opens upward instead. */
const MIN_BELOW = 140

type Placement = {
  left: number
  top?: number
  bottom?: number
  maxHeight: number
}

/**
 * Un-hard-wrap the source text into display paragraphs.
 *
 * Client notes arrive hard-wrapped at ~78 columns (measured: median line length
 * 76, 90th percentile 80, max 80 across all 103 non-blank notes). Rendered with
 * `white-space: pre-wrap` in a 340px panel those baked-in breaks land
 * mid-sentence and the paragraph reads as ragged half-lines. So a SINGLE newline
 * is treated as what it is — a wrap artifact — and collapsed to a space.
 *
 * A BLANK line is different: that is a deliberate paragraph break, and it is
 * kept. No note in the source uses one today (0 of 103), but AI summaries and
 * future notes may, and losing real structure would be the worse failure.
 */
function paragraphs(text: string): string[] {
  return text
    .trim()
    .split(/\n[ \t]*\n+/)
    .map((p) => p.replace(/\s*\n\s*/g, " ").trim())
    .filter(Boolean)
}

/**
 * Fixed-position placement from the trigger's viewport rect: left-aligned to the
 * icon and clamped inside the viewport, opening downward unless the space below
 * is cramped and there is more of it above. maxHeight is whatever room is left
 * in the chosen direction, which is what makes a long note scroll rather than
 * run off the screen.
 */
function place(rect: DOMRect): Placement {
  const left = Math.min(Math.max(EDGE, rect.left), window.innerWidth - PANEL_W - EDGE)
  const below = window.innerHeight - rect.bottom - GAP - EDGE
  const above = rect.top - GAP - EDGE
  if (below < MIN_BELOW && above > below) {
    return { left, bottom: window.innerHeight - rect.top + GAP, maxHeight: above }
  }
  return { left, top: rect.bottom + GAP, maxHeight: below }
}

export function CellHoverCard({
  icon: Icon,
  color,
  label,
  meta,
  text,
  emptyLabel,
}: {
  icon: LucideIcon
  /** Icon colour when there IS content. Empty state is always muted. */
  color: string
  /** Accessible name for the trigger, and the panel's heading. */
  label: string
  /** Optional small heading meta, right-aligned beside the label (e.g. a date). */
  meta?: string | null
  /** The body text. Blank/null renders a muted, non-interactive icon instead. */
  text?: string | null
  /** Tooltip on the muted icon, e.g. "No note on record". */
  emptyLabel: string
}) {
  const triggerRef = React.useRef<HTMLButtonElement>(null)
  const panelRef = React.useRef<HTMLDivElement>(null)
  const [open, setOpen] = React.useState(false)
  const [pos, setPos] = React.useState<Placement | null>(null)
  const closeTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null)
  const panelId = React.useId()

  const cancelClose = () => {
    if (closeTimer.current) {
      clearTimeout(closeTimer.current)
      closeTimer.current = null
    }
  }
  React.useEffect(() => cancelClose, [])

  const show = React.useCallback(() => {
    cancelClose()
    const rect = triggerRef.current?.getBoundingClientRect()
    if (rect) setPos(place(rect))
    setOpen(true)
  }, [])

  // Grace period so crossing the gap from icon to panel doesn't flicker it shut.
  const hide = () => {
    cancelClose()
    closeTimer.current = setTimeout(() => setOpen(false), 90)
  }

  const close = React.useCallback(() => {
    cancelClose()
    setOpen(false)
  }, [])

  // A fixed panel is anchored to a rect measured once, so any scroll would slide
  // the row out from under it. Close instead of chasing the trigger — the panel
  // is a glance, not a workspace. Capture phase catches the table's own inner
  // scroll container, which does not bubble a scroll event.
  React.useEffect(() => {
    if (!open) return
    window.addEventListener("scroll", close, true)
    window.addEventListener("resize", close)
    return () => {
      window.removeEventListener("scroll", close, true)
      window.removeEventListener("resize", close)
    }
  }, [open, close])

  // Empty: a muted, non-interactive glyph. Kept in the layout rather than
  // omitted so the two icons stay in the same two slots on every row and the
  // column does not jitter.
  if (!text || !text.trim()) {
    return (
      <span
        title={emptyLabel}
        aria-label={emptyLabel}
        className="inline-flex size-[18px] items-center justify-center"
      >
        <Icon className="size-3.5 text-muted-foreground/35" aria-hidden="true" />
      </span>
    )
  }

  const onBlur = (e: React.FocusEvent) => {
    const to = e.relatedTarget as Node | null
    if (triggerRef.current?.contains(to) || panelRef.current?.contains(to)) return
    close()
  }

  // The portal is still a React child of this component, so panel key events
  // bubble to the trigger's handler — hence the containment check.
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape" && open) {
      e.stopPropagation()
      close()
      triggerRef.current?.focus()
      return
    }
    // Tab from the trigger moves INTO the panel so a keyboard user can scroll a
    // long note; Tab again leaves it (the panel's own handler closes and lets
    // focus continue). Portalling means this hand-off must be explicit.
    if (e.key === "Tab" && !e.shiftKey && open && !panelRef.current?.contains(e.target as Node)) {
      if (panelRef.current) {
        e.preventDefault()
        panelRef.current.focus()
      }
    }
  }

  const hoverAndFocus = {
    onMouseEnter: show,
    onMouseLeave: hide,
    onFocus: show,
    onBlur,
  }

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        aria-label={label}
        aria-expanded={open}
        aria-describedby={open ? panelId : undefined}
        // Tap-to-open on touch, where there is no hover. On a mouse the panel is
        // already open by the time this fires, so the toggle reads as a no-op
        // unless the user clicks a second time to dismiss it.
        onClick={() => (open ? close() : show())}
        onKeyDown={onKeyDown}
        {...hoverAndFocus}
        className="inline-flex size-[18px] cursor-pointer items-center justify-center rounded-sm transition-colors hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[#1E2858]"
      >
        <Icon className="size-3.5" style={{ color }} aria-hidden="true" />
      </button>
      {open &&
        pos &&
        createPortal(
          <div
            id={panelId}
            ref={panelRef}
            role="tooltip"
            tabIndex={-1}
            {...hoverAndFocus}
            onKeyDown={onKeyDown}
            style={{
              position: "fixed",
              left: pos.left,
              ...(pos.top == null ? { bottom: pos.bottom } : { top: pos.top }),
              width: PANEL_W,
              maxHeight: Math.max(pos.maxHeight, MIN_BELOW),
            }}
            className={cn(
              "z-[60] overflow-y-auto overscroll-contain rounded-md border border-[#EDEFF3]",
              "bg-white p-3 shadow-lg focus:outline-none",
            )}
          >
            <div className="mb-1.5 flex items-baseline justify-between gap-3">
              <span
                className="text-[10px] font-semibold uppercase tracking-wider"
                style={{ color }}
              >
                {label}
              </span>
              {meta && (
                <span className="shrink-0 text-[10px] text-muted-foreground">{meta}</span>
              )}
            </div>
            {/* One <p> per real paragraph, each reflowed to the panel's own
                measure — see paragraphs(). */}
            <div className="space-y-2">
              {paragraphs(text).map((p, i) => (
                <p key={i} className="text-xs leading-relaxed text-foreground">
                  {p}
                </p>
              ))}
            </div>
          </div>,
          document.body,
        )}
    </>
  )
}
