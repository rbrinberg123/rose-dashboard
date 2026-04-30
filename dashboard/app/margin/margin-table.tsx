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
import { AlertTriangle, Search, X } from "lucide-react"

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { SortHeader } from "@/components/sort-header"
import { MarginBadge } from "@/components/margin-badge"
import { formatCurrency } from "@/lib/format"
import { cn } from "@/lib/utils"
import type { ClientQuarterlyPnlRow } from "@/lib/types"

type GlobalFilter = {
  search: string
}

const globalFilterFn: FilterFn<ClientQuarterlyPnlRow> = (row, _columnId, filter: GlobalFilter) => {
  const r = row.original
  if (filter.search) {
    const q = filter.search.toLowerCase()
    if (!(r.client_account_name ?? "").toLowerCase().includes(q)) return false
  }
  return true
}

function nullSafeNumberCmp(a: number | null, b: number | null): number {
  if (a == null && b == null) return 0
  if (a == null) return 1
  if (b == null) return -1
  return a - b
}

function FlagDot({ on, title, color }: { on: boolean; title: string; color: string }) {
  if (!on) return <span className="text-xs text-muted-foreground">—</span>
  return (
    <span title={title} className={cn("inline-flex items-center", color)}>
      <AlertTriangle className="size-4" />
    </span>
  )
}

const columns: ColumnDef<ClientQuarterlyPnlRow>[] = [
  {
    id: "client_account_name",
    accessorKey: "client_account_name",
    header: ({ column }) => (
      <SortHeader label="Client" isSorted={column.getIsSorted()} onClick={() => column.toggleSorting()} />
    ),
    cell: ({ row }) => (
      <div className="font-medium text-foreground">{row.original.client_account_name ?? "—"}</div>
    ),
  },
  {
    id: "revenue",
    accessorKey: "revenue",
    sortingFn: "basic",
    header: ({ column }) => (
      <SortHeader label="Revenue" isSorted={column.getIsSorted()} onClick={() => column.toggleSorting()} align="right" />
    ),
    cell: ({ row }) => (
      <div className="text-right tabular-nums">{formatCurrency(row.original.revenue)}</div>
    ),
  },
  {
    id: "contract_revenue",
    accessorKey: "contract_revenue",
    sortingFn: "basic",
    header: ({ column }) => (
      <SortHeader label="Contract" isSorted={column.getIsSorted()} onClick={() => column.toggleSorting()} align="right" />
    ),
    cell: ({ row }) => (
      <div className="text-right tabular-nums">{formatCurrency(row.original.contract_revenue)}</div>
    ),
  },
  {
    id: "revenue_adjustment",
    accessorKey: "revenue_adjustment",
    sortingFn: "basic",
    header: ({ column }) => (
      <SortHeader label="Rev adj" isSorted={column.getIsSorted()} onClick={() => column.toggleSorting()} align="right" />
    ),
    cell: ({ row }) => {
      const v = row.original.revenue_adjustment
      const cls = v < 0 ? "text-rose-700 dark:text-rose-300" : v > 0 ? "text-emerald-700 dark:text-emerald-300" : ""
      return <div className={cn("text-right tabular-nums", cls)}>{formatCurrency(v)}</div>
    },
  },
  {
    id: "meeting_count",
    accessorKey: "meeting_count",
    sortingFn: "basic",
    header: ({ column }) => (
      <SortHeader label="Meetings" isSorted={column.getIsSorted()} onClick={() => column.toggleSorting()} align="right" />
    ),
    cell: ({ row }) => (
      <div className="text-right tabular-nums">{row.original.meeting_count.toLocaleString()}</div>
    ),
  },
  {
    id: "meeting_labor_cost",
    accessorKey: "meeting_labor_cost",
    sortingFn: "basic",
    header: ({ column }) => (
      <SortHeader label="Labor" isSorted={column.getIsSorted()} onClick={() => column.toggleSorting()} align="right" />
    ),
    cell: ({ row }) => (
      <div className="text-right tabular-nums">{formatCurrency(row.original.meeting_labor_cost)}</div>
    ),
  },
  {
    id: "direct_cost",
    accessorKey: "direct_cost",
    sortingFn: "basic",
    header: ({ column }) => (
      <SortHeader label="Direct" isSorted={column.getIsSorted()} onClick={() => column.toggleSorting()} align="right" />
    ),
    cell: ({ row }) => (
      <div className="text-right tabular-nums">{formatCurrency(row.original.direct_cost)}</div>
    ),
  },
  {
    id: "overhead_share",
    accessorKey: "overhead_share",
    sortingFn: "basic",
    header: ({ column }) => (
      <SortHeader label="Overhead" isSorted={column.getIsSorted()} onClick={() => column.toggleSorting()} align="right" />
    ),
    cell: ({ row }) => (
      <div className="text-right tabular-nums">{formatCurrency(row.original.overhead_share)}</div>
    ),
  },
  {
    id: "margin",
    accessorKey: "margin",
    sortingFn: "basic",
    header: ({ column }) => (
      <SortHeader label="Margin" isSorted={column.getIsSorted()} onClick={() => column.toggleSorting()} align="right" />
    ),
    cell: ({ row }) => {
      const v = row.original.margin
      const cls = v < 0 ? "text-rose-700 dark:text-rose-300 font-medium" : ""
      return <div className={cn("text-right tabular-nums", cls)}>{formatCurrency(v)}</div>
    },
  },
  {
    id: "margin_pct",
    accessorKey: "margin_pct",
    sortingFn: (a, b) => nullSafeNumberCmp(a.original.margin_pct, b.original.margin_pct),
    header: ({ column }) => (
      <SortHeader label="Margin %" isSorted={column.getIsSorted()} onClick={() => column.toggleSorting()} align="right" />
    ),
    cell: ({ row }) => (
      <div className="flex justify-end">
        <MarginBadge value={row.original.margin_pct} />
      </div>
    ),
  },
  {
    id: "has_missing_salary",
    accessorFn: (r) => (r.has_missing_salary ? 1 : 0),
    header: ({ column }) => (
      <SortHeader label="Salary?" isSorted={column.getIsSorted()} onClick={() => column.toggleSorting()} />
    ),
    cell: ({ row }) => (
      <FlagDot
        on={row.original.has_missing_salary}
        title="One or more meeting users had no salary on the meeting date"
        color="text-rose-600 dark:text-rose-400"
      />
    ),
  },
  {
    id: "has_no_overhead_alloc",
    accessorFn: (r) => (r.has_no_overhead_alloc ? 1 : 0),
    header: ({ column }) => (
      <SortHeader label="Overhead?" isSorted={column.getIsSorted()} onClick={() => column.toggleSorting()} />
    ),
    cell: ({ row }) => (
      <FlagDot
        on={row.original.has_no_overhead_alloc}
        title="Has revenue but no meetings and no override → got $0 overhead"
        color="text-amber-600 dark:text-amber-400"
      />
    ),
  },
]

export function MarginTable({ rows }: { rows: ClientQuarterlyPnlRow[] }) {
  // Default sort: smallest (most negative) margin first — most-painful clients on top.
  const [sorting, setSorting] = React.useState<SortingState>([{ id: "margin", desc: false }])
  const [filter, setFilter] = React.useState<GlobalFilter>({ search: "" })

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
  const hasFilters = !!filter.search

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-56 max-w-sm">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={filter.search}
            onChange={(e) => setFilter((f) => ({ ...f, search: e.target.value }))}
            placeholder="Search by client name"
            className="pl-8"
          />
        </div>

        {hasFilters ? (
          <Button variant="ghost" size="sm" onClick={() => setFilter({ search: "" })}>
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
                  {rows.length === 0
                    ? "No P&L data available yet."
                    : "No clients match the current filters."}
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
