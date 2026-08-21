import * as React from "react"
import { TableHead, TableRow } from "@/components/ui/table"
import {
  BRAND_BLUE,
  BRAND_NAVY,
  DEEP_TEAL,
  GROUP_RULE_HEIGHT,
} from "@/lib/design"
import { cn } from "@/lib/utils"

/**
 * SHARED GROUPED-TABLE HEADER.
 *
 * Extracted verbatim from the Client Portfolio table so every grouped table in
 * the app wears one header. Two tiers over the white card:
 *
 *   1. UNFILLED section bands — navy small-caps, no background tint. The bands
 *      used to be filled medium-grey caps; the fill made the group heading the
 *      heaviest thing in the header, which is not where the eye should go.
 *   2. A navy → blue → teal sweep at the header/body boundary, cut into one
 *      segment per section by the same white gutters that separate the labels.
 *
 * Consumers supply a `bands` list (label + colSpan, left to right) and render
 * their own middle tier of sub-column headers between the two rows.
 */

/** One primary section of the header, in table order. */
export type GroupBand = {
  key: string
  label: string
  /** Visible column count — must match, or the band stops sitting over its own
   *  columns. */
  colSpan: number
  /** Freeze this band to the left edge, for tables with frozen identity
   *  columns. Only meaningful on the first band. */
  sticky?: boolean
}

/**
 * The light rule colour — THE one value for every rule on these tables: the
 * vertical section dividers in the data rows, the hairline under each group
 * label, and the header's vertical section dividers (see SectionDivider).
 */
export const GROUP_DIVIDER = "#EEF0F4"

/** Vertical section divider for the DATA rows. */
export const BODY_SECTION_START_STYLE: React.CSSProperties = {
  borderLeft: `1px solid ${GROUP_DIVIDER}`,
}

/**
 * Vertical divider between primary sections in the HEADER — the line running
 * down each white gutter, from the top of the group-label row to the gradient
 * bar that closes the header.
 *
 * Rendered as its own absolutely-positioned element, NOT as the cell's
 * border-left, because a cell-edge border DOES NOT PAINT up here. The table is
 * `border-collapse: collapse` (Tailwind Preflight sets it), which makes cell
 * borders part of the TABLE's border grid rather than of the cell itself — and
 * the header is a `sticky` <thead> carrying an opaque `bg-card` fill, so it
 * paints in its own layer on top of that grid and covers the line. The border
 * computed perfectly (1px solid, correct colour, correct x); it was just
 * buried. The BODY dividers are cell borders and are fine, because those cells
 * sit inside no sticky, opaque-filled ancestor.
 *
 * One segment per header ROW rather than one tall element: an absolutely
 * positioned child takes BOTH axes from the same containing block, and the <th>
 * is static — so anchoring vertically to the sticky <thead> (the nearest
 * positioned ancestor, and the only box that knows the full header height)
 * would drag the horizontal anchor there too and lose the cell's x. Per-row
 * segments stack seamlessly and need no hard-coded header height.
 *
 * `left: -0.5px` + `1px` wide straddles the cell boundary, which is the exact
 * midpoint of the white gutter: the gutter is the inset (SECTION_GUTTER_CLASS +
 * the cell's own px) taken off BOTH sides of that shared boundary.
 *
 * The host cell must be `relative` for this to anchor to it.
 */
export function SectionDivider() {
  return (
    <span
      aria-hidden="true"
      className="pointer-events-none absolute inset-y-0 w-px"
      style={{ left: "-0.5px", backgroundColor: GROUP_DIVIDER }}
    />
  )
}

/** Thickness of the gradient bars closing the header. Heavier than the hairline
 *  under the group labels — this is the header/body boundary, so it reads as a
 *  deliberate bar rather than a rule — but only just.
 *
 *  NOT a local number: it is the shared GROUP_RULE_HEIGHT, the same value
 *  Planning V2's group-band rule renders at, so every grouped table header
 *  carries identical weight. Retune it in lib/design.ts, which moves them all. */
export const SWEEP_HEIGHT = GROUP_RULE_HEIGHT

// h-8 (32px) is the band's height, and the label is centred inside it by the
// inner div (see GROUP_LABEL_CLASS) rather than by the cell. The cell keeps
// align-bottom only so that inner div — which carries the hairline as its
// bottom border — stays pinned to the bottom of the band.
export const GROUP_BAND_CLASS =
  "h-8 px-1.5 align-bottom text-center text-[11px] font-semibold uppercase tracking-wider"

/**
 * The group label's own box: full band height, text centred in it, hairline on
 * its bottom edge.
 *
 * `align-bottom` on the cell alone left ALL the slack above the text and none
 * below, so the label sat right on top of the hairline. Stretching this div to
 * the band's full height and centring with flex splits that slack evenly, which
 * is what puts the label in the middle of its band. It also self-adjusts: change
 * h-8 and the label re-centres instead of needing a hand-tuned padding.
 */
export const GROUP_LABEL_CLASS = "flex h-full items-center justify-center"

export const GROUP_BAND_STYLE: React.CSSProperties = { color: BRAND_NAVY }

/**
 * The white gutter between sections in the HEADER. `mx-1` on top of the cell's
 * own `px-1.5` gives ~10px of air each side of a boundary, i.e. a ~20px white
 * gap between one section's gradient segment and the next. The gradient bar
 * carries the same inset, so the gutters in the bar are what you actually read
 * the section boundaries from.
 */
export const SECTION_GUTTER_CLASS = "mx-1"

/**
 * Thin rule under each group label, separating it from the sub-column headers.
 *
 * Carried by an INSET inner element rather than the cell's own border-bottom,
 * so it stops short of the cell edges and the white gutters break it into one
 * short line per section instead of one rule running the table's width. It uses
 * the same SECTION_GUTTER_CLASS inset as the gradient bar below, so the two
 * rows' segments start and end on exactly the same x positions.
 */
export const GROUP_LABEL_UNDERLINE_STYLE: React.CSSProperties = {
  borderBottom: `1px solid ${GROUP_DIVIDER}`,
}

/**
 * The sub-column row is plain card white, same as the band row above it — the
 * header reads as one unshaded block, with the gradient sweep at the bottom
 * doing the separating from the data instead of a tint.
 *
 * It still needs an EXPLICIT background rather than transparent: on tables with
 * frozen columns those cells would otherwise let the body scroll through them.
 */
export const SUBHEADER_BG = "var(--card)"

/**
 * The header/body boundary rule: one continuous navy → blue → teal sweep read
 * left to right across the full table width, drawn as one segment per group so
 * each segment sits exactly over its own columns.
 *
 * The first band always carries navy → blue; the remaining bands share blue →
 * teal evenly, so the sweep always starts on navy and lands exactly on teal at
 * the right edge no matter how many sections are toggled on. Because adjacent
 * segments share a stop — segment i ends on sweepStop(i+1) and segment i+1
 * begins there — the handoffs are invisible and the whole thing reads as one
 * bar. That is also why the segments are NOT rounded and carry no left divider:
 * either would notch the sweep at every group boundary.
 *
 * Composed from the brand tokens (not written as hex) and ending on the same
 * DEEP_TEAL the Planning header ends on, so the tables stay in step.
 */
export function sweepStop(i: number, total: number): string {
  if (total <= 1) return DEEP_TEAL
  if (i <= 0) return BRAND_NAVY
  if (i === 1) return BRAND_BLUE
  const pct = Math.round(((i - 1) / (total - 1)) * 100)
  return `color-mix(in srgb, ${DEEP_TEAL} ${pct}%, ${BRAND_BLUE})`
}

export function bandRule(i: number, total: number): string {
  return `linear-gradient(90deg, ${sweepStop(i, total)}, ${sweepStop(i + 1, total)})`
}

/**
 * TIER 1 — the section bands. Each band's colSpan equals its visible column
 * count so it sits exactly over its columns. The first band carries no divider
 * (nothing to its left to divide it from).
 *
 * `border-b-0`: TableRow applies `border-b` by default, which is right for data
 * rows but would draw a full-width rule under the group labels. The inset
 * per-section underline replaces it.
 */
export function GroupBandRow({ bands }: { bands: readonly GroupBand[] }) {
  return (
    <TableRow className="bg-card border-b-0">
      {bands.map((band, i) => (
        <TableHead
          key={band.key}
          colSpan={band.colSpan}
          className={cn(GROUP_BAND_CLASS, "relative")}
          style={
            band.sticky
              ? { ...GROUP_BAND_STYLE, position: "sticky", left: 0, zIndex: 30 }
              : GROUP_BAND_STYLE
          }
        >
          {i > 0 && <SectionDivider />}
          <div
            className={cn(SECTION_GUTTER_CLASS, GROUP_LABEL_CLASS)}
            style={GROUP_LABEL_UNDERLINE_STYLE}
          >
            {band.label}
          </div>
        </TableHead>
      ))}
    </TableRow>
  )
}

/**
 * TIER 3 — the header/body boundary: the ramp, broken into one bar per group.
 * The gradient still runs continuously ACROSS the segments — each picks up the
 * ramp where the last left off — so the row reads as one sweep with the sections
 * called out, rather than N unrelated bars.
 *
 * The bar sits on an inset inner div using the SAME px-1.5 (cell) + mx-1 (inner)
 * inset as the group-label underline above it, so the white gutters land in
 * exactly the same places and the top labels and bottom bars share one section
 * rhythm.
 *
 * h-auto + an explicit height collapses this row onto the bar. TableHead ships
 * `h-10` and `align-middle`, which would centre a 4.5px bar in a 40px row and
 * leave ~18px of dead space above and below. lineHeight 0 stops the cell's
 * inline box re-inflating the row.
 *
 * No border of any kind on these cells, transparent or otherwise. The section
 * dividers above are out-of-flow elements, not cell borders, so no cell in the
 * header has a border box to match — put one here and this row's content would
 * start 1px right of the labels' and the two rows' segments would stop lining
 * up.
 */
export function GradientSweepRow({ bands }: { bands: readonly GroupBand[] }) {
  return (
    <TableRow className="border-b-0">
      {bands.map((band, i) => (
        <TableHead
          key={`sweep-${band.key}`}
          colSpan={band.colSpan}
          aria-hidden="true"
          className="h-auto px-1.5 align-top"
          style={{
            height: SWEEP_HEIGHT,
            lineHeight: 0,
            paddingTop: 0,
            paddingBottom: 0,
            ...(band.sticky ? { position: "sticky", left: 0, zIndex: 30 } : null),
          }}
        >
          <div
            className={cn(SECTION_GUTTER_CLASS, "rounded-full")}
            style={{
              height: SWEEP_HEIGHT,
              backgroundImage: bandRule(i, bands.length),
            }}
          />
        </TableHead>
      ))}
    </TableRow>
  )
}
