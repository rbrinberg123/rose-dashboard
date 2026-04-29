"use client"

import * as React from "react"
import {
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
  type SortingState,
  type FilterFn,
} from "@tanstack/react-table"
import { ArrowUpDown, ArrowUp, ArrowDown, Search, X } from "lucide-react"

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Button } from "@/components/ui/button"
import { MarginBadge } from "@/components/margin-badge"
import { cn } from "@/lib/utils"
import { formatCurrency, formatDate } from "@/lib/format"
import type { ClientPortfolioRow } from "@/lib/types"

const ALL = "__all__"

/**
 * Multi-field filter state lives in TanStack's columnFilters, but for cross-
 * column composition (name OR ticker matches search; status equals; sector
 * equals) we use a single global filter function instead.
 */
type GlobalFilter = {
  search: string
  status: string // "" or ALL = no filter
  sector: string
}

const globalFilterFn: FilterFn<ClientPortfolioRow> = (row, _columnId, filter: GlobalFilter) => {
  const r = row.original
  if (filter.search) {
    const q = filter.search.toLowerCase()
    const hay = `${r.name ?? ""} ${r.ticker_symbol ?? ""}`.toLowerCase()
    if (!hay.includes(q)) return false
  }
  if (filter.status && filter.status !== ALL) {
    if ((r.client_status_label ?? "") !== filter.status) return false
  }
  if (filter.sector && filter.sector !== ALL) {
    if ((r.sector_label ?? "") !== filter.sector) return false
  }
  return true
}

function trim(s: string | null | undefined): string {
  return (s ?? "").trim()
}

function SortHeader({
  label,
  isSorted,
  onClick,
  align = "left",
}: {
  label: string
  isSorted: false | "asc" | "desc"
  onClick: () => void
  align?: "left" | "right"
}) {
  const Icon = isSorted === "asc" ? ArrowUp : isSorted === "desc" ? ArrowDown : ArrowUpDown
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex w-full items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground",
        align === "right" && "justify-end",
      )}
    >
      {align === "left" && <span>{label}</span>}
      <Icon className={cn("size-3 shrink-0", isSorted ? "text-foreground" : "text-muted-foreground/60")} />
      {align === "right" && <span>{label}</span>}
    </button>
  )
}

const columns: ColumnDef<ClientPortfolioRow>[] = [
  {
    id: "name",
    accessorKey: "name",
    header: ({ column }) => (
      <SortHeader label="Client" isSorted={column.getIsSorted()} onClick={() => column.toggleSorting()} />
    ),
    cell: ({ row }) => (
      <div className="min-w-0">
        <div className="truncate font-medium text-foreground">{row.original.name}</div>
        {row.original.ticker_symbol ? (
          <div className="truncate text-xs text-muted-foreground">{row.original.ticker_symbol}</div>
        ) : null}
      </div>
    ),
  },
  {
    id: "client_status_label",
    accessorKey: "client_status_label",
    header: ({ column }) => (
      <SortHeader label="Status" isSorted={column.getIsSorted()} onClick={() => column.toggleSorting()} />
    ),
    cell: ({ row }) => trim(row.original.client_status_label) || "—",
  },
  {
    id: "sector_label",
    accessorKey: "sector_label",
    header: ({ column }) => (
      <SortHeader label="Sector" isSorted={column.getIsSorted()} onClick={() => column.toggleSorting()} />
    ),
    cell: ({ row }) => trim(row.original.sector_label) || "—",
  },
  {
    id: "sales_lead_primary_name",
    accessorKey: "sales_lead_primary_name",
    header: ({ column }) => (
      <SortHeader label="Sales lead" isSorted={column.getIsSorted()} onClick={() => column.toggleSorting()} />
    ),
    cell: ({ row }) => trim(row.original.sales_lead_primary_name) || "—",
  },
  {
    id: "last_meeting_date",
    accessorKey: "last_meeting_date",
    sortingFn: "datetime",
    header: ({ column }) => (
      <SortHeader label="Last meeting" isSorted={column.getIsSorted()} onClick={() => column.toggleSorting()} />
    ),
    cell: ({ row }) => formatDate(row.original.last_meeting_date),
  },
  {
    id: "next_event_date",
    accessorKey: "next_event_date",
    sortingFn: "datetime",
    header: ({ column }) => (
      <SortHeader label="Next event" isSorted={column.getIsSorted()} onClick={() => column.toggleSorting()} />
    ),
    cell: ({ row }) => formatDate(row.original.next_event_date),
  },
  {
    id: "last_note",
    accessorFn: (r) => r.last_note_date ?? "",
    sortingFn: "datetime",
    header: ({ column }) => (
      <SortHeader label="Last note" isSorted={column.getIsSorted()} onClick={() => column.toggleSorting()} />
    ),
    cell: ({ row }) => {
      const r = row.original
      if (!r.last_note_date) return "—"
      return (
        <div className="min-w-0">
          <div>{formatDate(r.last_note_date)}</div>
          <div className="truncate text-xs text-muted-foreground">{trim(r.last_note_status) || "—"}</div>
        </div>
      )
    },
  },
  {
    id: "current_quarter_revenue",
    accessorKey: "current_quarter_revenue",
    sortingFn: "basic",
    header: ({ column }) => (
      <SortHeader label="Q rev" isSorted={column.getIsSorted()} onClick={() => column.toggleSorting()} align="right" />
    ),
    cell: ({ row }) => (
      <div className="text-right tabular-nums">{formatCurrency(row.original.current_quarter_revenue)}</div>
    ),
  },
  {
    id: "current_quarter_margin",
    accessorKey: "current_quarter_margin",
    sortingFn: "basic",
    header: ({ column }) => (
      <SortHeader label="Q margin" isSorted={column.getIsSorted()} onClick={() => column.toggleSorting()} align="right" />
    ),
    cell: ({ row }) => (
      <div className="text-right tabular-nums">{formatCurrency(row.original.current_quarter_margin)}</div>
    ),
  },
  {
    id: "current_quarter_margin_pct",
    accessorKey: "current_quarter_margin_pct",
    sortingFn: (a, b) => {
      // Nulls sort last regardless of direction.
      const av = a.original.current_quarter_margin_pct
      const bv = b.original.current_quarter_margin_pct
      if (av == null && bv == null) return 0
      if (av == null) return 1
      if (bv == null) return -1
      return av - bv
    },
    header: ({ column }) => (
      <SortHeader label="Margin %" isSorted={column.getIsSorted()} onClick={() => column.toggleSorting()} align="right" />
    ),
    cell: ({ row }) => (
      <div className="flex justify-end">
        <MarginBadge value={row.original.current_quarter_margin_pct} />
      </div>
    ),
  },
]

export function PortfolioTable({ rows }: { rows: ClientPortfolioRow[] }) {
  const [sorting, setSorting] = React.useState<SortingState>([{ id: "name", desc: false }])
  const [filter, setFilter] = React.useState<GlobalFilter>({ search: "", status: ALL, sector: ALL })

  // Distinct dropdown values, computed once from the row set.
  const { statuses, sectors } = React.useMemo(() => {
    const s = new Set<string>()
    const sec = new Set<string>()
    for (const r of rows) {
      if (r.client_status_label) s.add(r.client_status_label)
      if (r.sector_label) sec.add(r.sector_label)
    }
    return {
      statuses: [...s].sort(),
      sectors: [...sec].sort(),
    }
  }, [rows])

  const table = useReactTable({
    data: rows,
    columns,
    state: { sorting, globalFilter: filter },
    onSortingChange: setSorting,
    onGlobalFilterChange: (next) => setFilter(next as GlobalFilter),
    globalFilterFn,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
  })

  const visibleCount = table.getFilteredRowModel().rows.length
  const hasFilters = filter.search || filter.status !== ALL || filter.sector !== ALL

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-56 max-w-sm">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={filter.search}
            onChange={(e) => setFilter((f) => ({ ...f, search: e.target.value }))}
            placeholder="Search by name or ticker"
            className="pl-8"
          />
        </div>

        <Select value={filter.status} onValueChange={(v) => setFilter((f) => ({ ...f, status: v ?? ALL }))}>
          <SelectTrigger className="w-44">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All statuses</SelectItem>
            {statuses.map((s) => (
              <SelectItem key={s} value={s}>{s}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={filter.sector} onValueChange={(v) => setFilter((f) => ({ ...f, sector: v ?? ALL }))}>
          <SelectTrigger className="w-56">
            <SelectValue placeholder="Sector" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All sectors</SelectItem>
            {sectors.map((s) => (
              <SelectItem key={s} value={s}>{s}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        {hasFilters ? (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setFilter({ search: "", status: ALL, sector: ALL })}
          >
            <X /> Clear
          </Button>
        ) : null}

        <div className="ml-auto text-xs text-muted-foreground tabular-nums">
          {visibleCount.toLocaleString()} of {rows.length.toLocaleString()} clients
        </div>
      </div>

      <div className="rounded-lg border border-border bg-card">
        <Table>
          <TableHeader className="sticky top-0 z-10 bg-card">
            {table.getHeaderGroups().map((hg) => (
              <TableRow key={hg.id}>
                {hg.headers.map((h) => (
                  <TableHead key={h.id} className="px-3">
                    {h.isPlaceholder ? null : flexRender(h.column.columnDef.header, h.getContext())}
                  </TableHead>
                ))}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {table.getRowModel().rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={columns.length} className="h-32 text-center text-sm text-muted-foreground">
                  No clients match the current filters.
                </TableCell>
              </TableRow>
            ) : (
              table.getRowModel().rows.map((row) => (
                <TableRow key={row.id}>
                  {row.getVisibleCells().map((cell) => (
                    <TableCell key={cell.id} className="px-3 align-top">
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </TableCell>
                  ))}
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}
