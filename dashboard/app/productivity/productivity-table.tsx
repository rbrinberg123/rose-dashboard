"use client"

import * as React from "react"
import Link from "next/link"
import {
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
  type FilterFn,
  type SortingState,
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
import { Button } from "@/components/ui/button"
import { SortHeader } from "@/components/sort-header"
import { formatCurrency, formatPercent } from "@/lib/format"
import type { ProductivityAggregateRow } from "@/lib/types"

const searchFilter: FilterFn<ProductivityAggregateRow> = (row, _id, query: string) => {
  const q = query.trim().toLowerCase()
  if (!q) return true
  return (row.original.display_name ?? "").toLowerCase().includes(q)
}

function nullSafeNumberCmp(a: number | null, b: number | null): number {
  if (a == null && b == null) return 0
  if (a == null) return 1
  if (b == null) return -1
  return a - b
}

const columns: ColumnDef<ProductivityAggregateRow>[] = [
  {
    id: "display_name",
    accessorKey: "display_name",
    header: ({ column }) => (
      <SortHeader
        label="Person"
        isSorted={column.getIsSorted()}
        onClick={() => column.toggleSorting()}
      />
    ),
    cell: ({ row }) => (
      <div>
        {row.original.display_name ? (
          <Link
            href={`/productivity-detail?display_name=${encodeURIComponent(row.original.display_name)}`}
            className="font-medium text-[#1E2858] hover:underline"
          >
            {row.original.display_name}
          </Link>
        ) : (
          <span className="font-medium text-foreground">—</span>
        )}
      </div>
    ),
  },
  {
    id: "booked",
    accessorKey: "booked",
    header: ({ column }) => (
      <SortHeader
        label="Booked"
        isSorted={column.getIsSorted()}
        onClick={() => column.toggleSorting()}
        align="right"
      />
    ),
    cell: ({ row }) => (
      <div className="text-right tabular-nums">{row.original.booked.toLocaleString()}</div>
    ),
  },
  {
    id: "hosted",
    accessorKey: "hosted",
    header: ({ column }) => (
      <SortHeader
        label="Hosted"
        isSorted={column.getIsSorted()}
        onClick={() => column.toggleSorting()}
        align="right"
      />
    ),
    cell: ({ row }) => (
      <div className="text-right tabular-nums">{row.original.hosted.toLocaleString()}</div>
    ),
  },
  {
    id: "in_person_hosted",
    accessorKey: "in_person_hosted",
    header: ({ column }) => (
      <SortHeader
        label="In-person hosted"
        isSorted={column.getIsSorted()}
        onClick={() => column.toggleSorting()}
        align="right"
      />
    ),
    cell: ({ row }) => (
      <div className="text-right tabular-nums">
        {row.original.in_person_hosted.toLocaleString()}
      </div>
    ),
  },
  {
    id: "virtual_hosted",
    accessorKey: "virtual_hosted",
    header: ({ column }) => (
      <SortHeader
        label="Virtual hosted"
        isSorted={column.getIsSorted()}
        onClick={() => column.toggleSorting()}
        align="right"
      />
    ),
    cell: ({ row }) => (
      <div className="text-right tabular-nums">
        {row.original.virtual_hosted.toLocaleString()}
      </div>
    ),
  },
  {
    id: "feedback",
    accessorKey: "feedback",
    header: ({ column }) => (
      <SortHeader
        label="Feedback"
        isSorted={column.getIsSorted()}
        onClick={() => column.toggleSorting()}
        align="right"
      />
    ),
    cell: ({ row }) => (
      <div className="text-right tabular-nums">{row.original.feedback.toLocaleString()}</div>
    ),
  },
  {
    id: "feedback_rate",
    accessorKey: "feedback_rate",
    sortingFn: (a, b) =>
      nullSafeNumberCmp(a.original.feedback_rate, b.original.feedback_rate),
    header: ({ column }) => (
      <SortHeader
        label="Feedback rate"
        isSorted={column.getIsSorted()}
        onClick={() => column.toggleSorting()}
        align="right"
      />
    ),
    cell: ({ row }) => (
      <div className="text-right tabular-nums">
        {formatPercent(row.original.feedback_rate)}
      </div>
    ),
  },
  {
    id: "labor_cost",
    accessorKey: "labor_cost",
    sortingFn: "basic",
    header: ({ column }) => (
      <SortHeader
        label="Labor cost"
        isSorted={column.getIsSorted()}
        onClick={() => column.toggleSorting()}
        align="right"
      />
    ),
    cell: ({ row }) => (
      <div className="text-right tabular-nums">{formatCurrency(row.original.labor_cost)}</div>
    ),
  },
]

export function ProductivityTable({ rows }: { rows: ProductivityAggregateRow[] }) {
  const [sorting, setSorting] = React.useState<SortingState>([{ id: "hosted", desc: true }])
  const [search, setSearch] = React.useState("")

  const table = useReactTable({
    data: rows,
    columns,
    state: { sorting, globalFilter: search },
    onSortingChange: setSorting,
    onGlobalFilterChange: (next) => setSearch((next as string) ?? ""),
    globalFilterFn: searchFilter,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
  })

  const visibleCount = table.getFilteredRowModel().rows.length
  const hasFilter = search.trim().length > 0

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-56 max-w-sm flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by person"
            className="pl-8"
          />
        </div>

        {hasFilter ? (
          <Button variant="ghost" size="sm" onClick={() => setSearch("")}>
            <X /> Clear
          </Button>
        ) : null}

        <div className="ml-auto text-xs tabular-nums text-muted-foreground">
          {visibleCount.toLocaleString()} of {rows.length.toLocaleString()} people
        </div>
      </div>

      <div className="rounded-lg border border-border bg-card">
        <Table>
          <TableHeader className="sticky top-0 z-10 bg-card">
            {table.getHeaderGroups().map((hg) => (
              <TableRow key={hg.id}>
                {hg.headers.map((h) => (
                  <TableHead key={h.id} className="px-3">
                    {h.isPlaceholder
                      ? null
                      : flexRender(h.column.columnDef.header, h.getContext())}
                  </TableHead>
                ))}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {table.getRowModel().rows.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={columns.length}
                  className="h-32 text-center text-sm text-muted-foreground"
                >
                  {rows.length === 0
                    ? "No activity recorded for the selected date range."
                    : "No people match the current search."}
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
