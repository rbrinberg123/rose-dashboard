"use client"

import { Columns3, FileSpreadsheet, Filter, Loader2 } from "lucide-react"

import { Button } from "@/components/ui/button"

/**
 * The compact icon actions at the right end of every CRM table's toolbar
 * (2026-10-08): Columns · Filters · Export to Excel. One component so Clients,
 * Contacts, Events, Meetings, Tasks, Touches and Notes look and behave the same.
 *
 * Presentation only — each table passes its own existing handlers:
 *   Columns  → opens / closes its column picker (count = columns shown)
 *   Filters  → opens / closes its filter builder (count = view filters set)
 *   Export   → its own export (green Excel icon; spinner while exporting)
 * Save as… / Save as System are the floppy icons inside ViewSwitcher.
 */
export function TableToolbarActions({
  columnCount,
  filterCount,
  onColumns,
  onFilters,
  onExport,
  exporting,
  exportDisabled,
}: {
  columnCount: number
  filterCount: number
  onColumns: () => void
  onFilters: () => void
  onExport: () => void
  exporting: boolean
  exportDisabled: boolean
}) {
  return (
    <div className="ml-auto flex shrink-0 items-center gap-0.5">
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={onColumns}
        title={`Columns (${columnCount} shown)`}
        aria-label={`Columns, ${columnCount} shown`}
        className="h-7 cursor-pointer gap-0.5 px-1.5 text-muted-foreground hover:text-foreground"
      >
        <Columns3 />
        <span className="text-[11px] tabular-nums">{columnCount}</span>
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={onFilters}
        title={filterCount > 0 ? `Filters (${filterCount} set)` : "Filters"}
        aria-label={filterCount > 0 ? `Filters, ${filterCount} set` : "Filters"}
        className="h-7 cursor-pointer gap-0.5 px-1.5 text-muted-foreground hover:text-foreground"
      >
        <Filter />
        {filterCount > 0 && <span className="text-[11px] tabular-nums">{filterCount}</span>}
      </Button>
      {/* Excel green (#1D6F42) — the one place it is used, so it reads as "Excel". */}
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        onClick={onExport}
        disabled={exporting || exportDisabled}
        title={exporting ? "Exporting…" : "Export to Excel"}
        aria-label={exporting ? "Exporting to Excel" : "Export to Excel"}
        className="cursor-pointer text-[#1D6F42] hover:bg-[#1D6F42]/10 hover:text-[#1D6F42]"
      >
        {exporting ? <Loader2 className="animate-spin" /> : <FileSpreadsheet />}
      </Button>
    </div>
  )
}
