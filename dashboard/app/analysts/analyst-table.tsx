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
import { Search, X } from "lucide-react"

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
import { SortHeader } from "@/components/sort-header"
import { formatCurrency, formatPercent } from "@/lib/format"
import type { AnalystActivityRow } from "@/lib/types"

const ALL = "__all__"

type GlobalFilter = {
  search: string
  analyst: string // user_id, or ALL
}

const globalFilterFn: FilterFn<AnalystActivityRow> = (row, _columnId, filter: GlobalFilter) => {
  const r = row.original
  if (filter.search) {
    const q = filter.search.toLowerCase()
    if (!(r.display_name ?? "").toLowerCase().includes(q)) return false
  }
  if (filter.analyst && filter.analyst !== ALL) {
    if (r.user_id !== filter.analyst) return false
  }
  return true
}

/** Nulls sort last regardless of direction. */
function nullSafeNumberCmp(a: number | null, b: number | null): number {
  if (a == null && b == null) return 0
  if (a == null) return 1
  if (b == null) return -1
  return a - b
}

const columns: ColumnDef<AnalystActivityRow>[] = [
  {
    id: "display_name",
    accessorKey: "display_name",
    header: ({ column }) => (
      <SortHeader label="Analyst" isSorted={column.getIsSorted()} onClick={() => column.toggleSorting()} />
    ),
    cell: ({ row }) => (
      <div className="font-medium text-foreground">{row.original.display_name ?? "—"}</div>
    ),
  },
  {
    id: "meetings_booked",
    accessorKey: "meetings_booked",
    header: ({ column }) => (
      <SortHeader label="Booked" isSorted={column.getIsSorted()} onClick={() => column.toggleSorting()} align="right" />
    ),
    cell: ({ row }) => (
      <div className="text-right tabular-nums">{row.original.meetings_booked.toLocaleString()}</div>
    ),
  },
  {
    id: "meetings_hosted",
    accessorKey: "meetings_hosted",
    header: ({ column }) => (
      <SortHeader label="Hosted" isSorted={column.getIsSorted()} onClick={() => column.toggleSorting()} align="right" />
    ),
    cell: ({ row }) => (
      <div className="text-right tabular-nums">{row.original.meetings_hosted.toLocaleString()}</div>
    ),
  },
  {
    id: "meetings_in_person_hosted",
    accessorKey: "meetings_in_person_hosted",
    header: ({ column }) => (
      <SortHeader label="In-person hosted" isSorted={column.getIsSorted()} onClick={() => column.toggleSorting()} align="right" />
    ),
    cell: ({ row }) => (
      <div className="text-right tabular-nums">{row.original.meetings_in_person_hosted.toLocaleString()}</div>
    ),
  },
  {
    id: "meetings_virtual_hosted",
    accessorKey: "meetings_virtual_hosted",
    header: ({ column }) => (
      <SortHeader label="Virtual hosted" isSorted={column.getIsSorted()} onClick={() => column.toggleSorting()} align="right" />
    ),
    cell: ({ row }) => (
      <div className="text-right tabular-nums">{row.original.meetings_virtual_hosted.toLocaleString()}</div>
    ),
  },
  {
    id: "cancelled_total",
    // Cancelled = booker-cancellations + host-cancellations on rows where this
    // analyst was either side; treats them as separate countable events.
    accessorFn: (r) => (r.meetings_cancelled_booked ?? 0) + (r.meetings_cancelled_hosted ?? 0),
    header: ({ column }) => (
      <SortHeader label="Cancelled" isSorted={column.getIsSorted()} onClick={() => column.toggleSorting()} align="right" />
    ),
    cell: ({ row }) => {
      const total = (row.original.meetings_cancelled_booked ?? 0) + (row.original.meetings_cancelled_hosted ?? 0)
      return <div className="text-right tabular-nums">{total.toLocaleString()}</div>
    },
  },
  {
    id: "feedback_collected_hosted",
    accessorKey: "feedback_collected_hosted",
    header: ({ column }) => (
      <SortHeader label="Feedback" isSorted={column.getIsSorted()} onClick={() => column.toggleSorting()} align="right" />
    ),
    cell: ({ row }) => (
      <div className="text-right tabular-nums">{row.original.feedback_collected_hosted.toLocaleString()}</div>
    ),
  },
  {
    id: "feedback_collection_rate",
    accessorKey: "feedback_collection_rate",
    sortingFn: (a, b) => nullSafeNumberCmp(a.original.feedback_collection_rate, b.original.feedback_collection_rate),
    header: ({ column }) => (
      <SortHeader label="Feedback rate" isSorted={column.getIsSorted()} onClick={() => column.toggleSorting()} align="right" />
    ),
    cell: ({ row }) => (
      <div className="text-right tabular-nums">{formatPercent(row.original.feedback_collection_rate)}</div>
    ),
  },
  {
    id: "total_labor_cost_attributed",
    accessorKey: "total_labor_cost_attributed",
    sortingFn: "basic",
    header: ({ column }) => (
      <SortHeader label="Labor cost" isSorted={column.getIsSorted()} onClick={() => column.toggleSorting()} align="right" />
    ),
    cell: ({ row }) => (
      <div className="text-right tabular-nums">{formatCurrency(row.original.total_labor_cost_attributed)}</div>
    ),
  },
]

export function AnalystTable({ rows }: { rows: AnalystActivityRow[] }) {
  const [sorting, setSorting] = React.useState<SortingState>([{ id: "meetings_hosted", desc: true }])
  const [filter, setFilter] = React.useState<GlobalFilter>({ search: "", analyst: ALL })

  const analystOptions = React.useMemo(() => {
    const seen = new Map<string, string>()
    for (const r of rows) {
      if (r.user_id && !seen.has(r.user_id)) {
        seen.set(r.user_id, r.display_name ?? "(unnamed)")
      }
    }
    return [...seen.entries()].sort((a, b) => a[1].localeCompare(b[1]))
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
  const hasFilters = filter.search || filter.analyst !== ALL

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-56 max-w-sm">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={filter.search}
            onChange={(e) => setFilter((f) => ({ ...f, search: e.target.value }))}
            placeholder="Search by analyst name"
            className="pl-8"
          />
        </div>

        <Select value={filter.analyst} onValueChange={(v) => setFilter((f) => ({ ...f, analyst: v ?? ALL }))}>
          <SelectTrigger className="w-56">
            <SelectValue placeholder="Analyst" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All analysts</SelectItem>
            {analystOptions.map(([id, name]) => (
              <SelectItem key={id} value={id}>{name}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        {hasFilters ? (
          <Button variant="ghost" size="sm" onClick={() => setFilter({ search: "", analyst: ALL })}>
            <X /> Clear
          </Button>
        ) : null}

        <div className="ml-auto text-xs text-muted-foreground tabular-nums">
          {visibleCount.toLocaleString()} of {rows.length.toLocaleString()} analysts
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
                  No analysts match the current filters.
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
