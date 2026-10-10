/**
 * CRM table density — the ONE token for how tight the CRM list tables sit
 * (Clients, Meetings, Events, Tasks, Touches, Notes, Contacts).
 *
 * Every one of those views builds its header row, body cells and virtualised
 * row height from this object, so the whole family moves together and the pass
 * is reversible from here alone. It is deliberately a plain object of Tailwind
 * class strings + px numbers (not a CSS variable) because the views already
 * compose cells with `cn(...)`, and ROW_H must be a number for the virtualiser.
 *
 * Compact pass (2026-10-10), to fit the tables on a ≈1366px laptop:
 *   body 13px → 12px · header labels 12px → 11px · cell padding x 8px → 6px ·
 *   cell padding y 2px → 0 · two-line rows 34px → 32px · row height held at
 *   30px. (Rows had really been rendering ~37px: the trailing open-record cell
 *   kept the base TableCell `p-2`, out-growing the declared ROW_H and drifting
 *   the virtualiser. `actionCell` drops that padding so rows are truly 30px.)
 * To roll it out site-wide later, point other tables at this object; to undo
 * it, restore the values in the comment above.
 *
 * Long text never wraps: `cell` carries `truncate`, and each view's Cell sets
 * the full value as its `title`, so an ellipsised value is one hover away.
 */
export const CRM_TABLE_DENSITY = {
  /** Body row height in px. ROW_H for the virtualiser — enforced inline per row. */
  rowH: 30,
  /** Row height for a table whose cells stack two lines (Tasks' subject + regarding). */
  rowHTwoLine: 32,
  /** Header cell height. */
  headH: "h-7",
  /** Horizontal cell padding — headers and body alike. */
  padX: "px-1.5",
  /** Padding + centring for a `compact` column (a mark, not a sentence). */
  padXCompact: "px-1 text-center",
  /** Header cell: height + padding. */
  head: "h-7 px-1.5",
  /** Header label (the SortHeader button) — one step under the body text. The
   *  label truncates with an ellipsis (full name on hover via its title) when a
   *  fitted column is narrower than it (useFitColumns), instead of spilling into
   *  the next header. */
  headLabel: "text-[11px] [&>span]:min-w-0 [&>span]:truncate",
  /** Body cell: single line, ellipsis, compact vertical padding, body font. */
  cell: "truncate py-0 text-[12px]",
  /** The trailing open-record button cell. `py-0` matters: the base TableCell's
   *  `p-2` would make it the tallest cell and push every row past ROW_H. */
  actionCell: "w-9 px-2 py-0 leading-none",
  /**
   * The sticky filter/toolbar row above the table (view switcher · quick
   * filters · count · keyword · Columns/Filters/Export). Compact (2026-10-10):
   * py 8px → 6px, gap 8px → 6px, margin below 12px → 8px, and it WRAPS — the
   * old `min-[1360px]:flex-nowrap` crammed a long selected filter instead of
   * letting the overflow drop to a second line.
   */
  toolbar: "relative sticky top-0 z-30 -mx-6 mb-2 flex flex-wrap items-center gap-x-1.5 gap-y-1 px-6 py-1.5",
  /** Height of every toolbar control (selects, search, view switcher, icon buttons). Was h-8. */
  controlH: "h-7",
  /**
   * Put on the table CARD. Turns the shared <Table>'s own wrapper into the
   * vertical scroller (so the sticky <thead> engages) and sizes it to fill the
   * page: `--crm-fill-h` is measured by useFillHeight (components/
   * use-fill-height.ts); the old `calc(100vh-16rem)` is only the pre-hydration
   * fallback. min 300px keeps a short screen usable.
   */
  scroller:
    "[&_[data-slot=table-container]]:h-[var(--crm-fill-h,calc(100vh-16rem))] " +
    "[&_[data-slot=table-container]]:min-h-[300px] " +
    "[&_[data-slot=table-container]]:overflow-y-auto " +
    // Always reserve the vertical scrollbar's width, so the fitted columns
    // (useFitColumns) never flip into a sideways overflow when rows arrive.
    "[&_[data-slot=table-container]]:[scrollbar-gutter:stable]",
} as const
