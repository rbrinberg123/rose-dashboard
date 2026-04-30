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
import {
  currentQuarter,
  sortQuarters,
  type QuarterKey,
} from "@/components/quarter-selector"
import { formatPercent, formatQuarter } from "@/lib/format"
import type { FeedbackByAnalystRow } from "@/lib/types"

const ALL_QUARTERS = "__all_quarters__"

type GlobalFilter = {
  search: string
  period: string
}

const globalFilterFn: FilterFn<FeedbackByAnalystRow> = (row, _columnId, filter: GlobalFilter) => {
  const r = row.original
  if (filter.search) {
    const q = filter.search.toLowerCase()
    if (!(r.display_name ?? "").toLowerCase().includes(q)) return false
  }
  if (filter.period && filter.period !== ALL_QUARTERS) {
    if (`${r.period_year}-${r.period_quarter}` !== filter.period) return false
  }
  return true
}

function nullSafeNumberCmp(a: number | null, b: number | null): number {
  if (a == null && b == null) return 0
  if (a == null) return 1
  if (b == null) return -1
  return a - b
}

const columns: ColumnDef<FeedbackByAnalystRow>[] = [
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
    id: "period",
    accessorFn: (r) => r.period_year * 10 + r.period_quarter,
    header: ({ column }) => (
      <SortHeader label="Quarter" isSorted={column.getIsSorted()} onClick={() => column.toggleSorting()} />
    ),
    cell: ({ row }) => formatQuarter(row.original.period_year, row.original.period_quarter),
  },
  {
    id: "total_hosted",
    accessorKey: "total_hosted",
    header: ({ column }) => (
      <SortHeader label="Hosted" isSorted={column.getIsSorted()} onClick={() => column.toggleSorting()} align="right" />
    ),
    cell: ({ row }) => (
      <div className="text-right tabular-nums">{row.original.total_hosted.toLocaleString()}</div>
    ),
  },
  {
    id: "hosted_with_feedback",
    accessorKey: "hosted_with_feedback",
    header: ({ column }) => (
      <SortHeader label="Feedback" isSorted={column.getIsSorted()} onClick={() => column.toggleSorting()} align="right" />
    ),
    cell: ({ row }) => (
      <div className="text-right tabular-nums">{row.original.hosted_with_feedback.toLocaleString()}</div>
    ),
  },
  {
    id: "feedback_rate",
    accessorKey: "feedback_rate",
    sortingFn: (a, b) => nullSafeNumberCmp(a.original.feedback_rate, b.original.feedback_rate),
    header: ({ column }) => (
      <SortHeader label="Rate" isSorted={column.getIsSorted()} onClick={() => column.toggleSorting()} align="right" />
    ),
    cell: ({ row }) => (
      <div className="text-right tabular-nums">{formatPercent(row.original.feedback_rate)}</div>
    ),
  },
]

export function FeedbackByAnalystTable({ rows }: { rows: FeedbackByAnalystRow[] }) {
  const quarterOptions = React.useMemo(() => {
    const seen = new Map<string, QuarterKey>()
    for (const r of rows) {
      const key = `${r.period_year}-${r.period_quarter}`
      if (!seen.has(key)) seen.set(key, { year: r.period_year, quarter: r.period_quarter })
    }
    return sortQuarters([...seen.values()])
  }, [rows])

  const initialPeriod = React.useMemo<string>(() => {
    const cur = currentQuarter()
    const has = quarterOptions.some((q) => q.year === cur.year && q.quarter === cur.quarter)
    if (has) return `${cur.year}-${cur.quarter}`
    if (quarterOptions.length > 0) return `${quarterOptions[0].year}-${quarterOptions[0].quarter}`
    return ALL_QUARTERS
  }, [quarterOptions])

  const [sorting, setSorting] = React.useState<SortingState>([{ id: "feedback_rate", desc: false }])
  const [filter, setFilter] = React.useState<GlobalFilter>({ search: "", period: initialPeriod })

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
  const hasFilters = filter.search || filter.period === ALL_QUARTERS

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

        <Select
          value={filter.period}
          onValueChange={(v) => { if (v) setFilter((f) => ({ ...f, period: v })) }}
        >
          <SelectTrigger className="w-44">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL_QUARTERS}>All quarters</SelectItem>
            {quarterOptions.map((q) => (
              <SelectItem key={`${q.year}-${q.quarter}`} value={`${q.year}-${q.quarter}`}>
                {formatQuarter(q.year, q.quarter)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {hasFilters ? (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setFilter({ search: "", period: initialPeriod })}
          >
            <X /> Clear
          </Button>
        ) : null}

        <div className="ml-auto text-xs text-muted-foreground tabular-nums">
          {visibleCount.toLocaleString()} of {rows.length.toLocaleString()} rows
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
                    ? "No feedback data for any analyst yet."
                    : "No rows match the current filters."}
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
