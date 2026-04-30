"use client"

import * as React from "react"
import Link from "next/link"
import {
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
  type SortingState,
} from "@tanstack/react-table"

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { SortHeader } from "@/components/sort-header"
import { ExceptionSection } from "./exception-section"
import { formatCurrency, formatQuarter } from "@/lib/format"
import type { OverheadOverrunRow } from "@/lib/types"

const columns: ColumnDef<OverheadOverrunRow>[] = [
  {
    id: "period",
    accessorFn: (r) => r.period_year * 10 + r.period_quarter,
    header: ({ column }) => (
      <SortHeader label="Period" isSorted={column.getIsSorted()} onClick={() => column.toggleSorting()} />
    ),
    cell: ({ row }) => (
      <span className="font-medium">{formatQuarter(row.original.period_year, row.original.period_quarter)}</span>
    ),
  },
  {
    id: "total_pot",
    accessorKey: "total_pot",
    sortingFn: "basic",
    header: ({ column }) => (
      <SortHeader label="Total pot" isSorted={column.getIsSorted()} onClick={() => column.toggleSorting()} align="right" />
    ),
    cell: ({ row }) => (
      <div className="text-right tabular-nums">{formatCurrency(row.original.total_pot)}</div>
    ),
  },
  {
    id: "overrides_total",
    accessorKey: "overrides_total",
    sortingFn: "basic",
    header: ({ column }) => (
      <SortHeader label="Overrides total" isSorted={column.getIsSorted()} onClick={() => column.toggleSorting()} align="right" />
    ),
    cell: ({ row }) => (
      <div className="text-right tabular-nums">{formatCurrency(row.original.overrides_total)}</div>
    ),
  },
  {
    id: "overrun_amount",
    accessorKey: "overrun_amount",
    sortingFn: "basic",
    header: ({ column }) => (
      <SortHeader label="Overrun" isSorted={column.getIsSorted()} onClick={() => column.toggleSorting()} align="right" />
    ),
    cell: ({ row }) => (
      <div className="text-right tabular-nums font-medium text-rose-700 dark:text-rose-300">
        {formatCurrency(row.original.overrun_amount)}
      </div>
    ),
  },
]

export function OverheadOverrunSection({ rows }: { rows: OverheadOverrunRow[] }) {
  const [sorting, setSorting] = React.useState<SortingState>([{ id: "period", desc: true }])

  const table = useReactTable({
    data: rows,
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  })

  return (
    <ExceptionSection
      title="D. Quarters with overhead overrides exceeding the total pot"
      description="Sum of resolved overrides (fixed + percent × pot) is bigger than the quarter's overhead pot. Meeting-share clients absorb the difference."
      count={rows.length}
      action={
        <>
          Increase the pot on{" "}
          <Link href="/quarterly-overhead" className="underline underline-offset-2">
            Quarterly Overhead
          </Link>
          {" "}or reduce overrides on{" "}
          <Link href="/overhead-overrides" className="underline underline-offset-2">
            Overhead Overrides
          </Link>
          .
        </>
      }
    >
      <Table>
        <TableHeader className="bg-card">
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
          {table.getRowModel().rows.map((row) => (
            <TableRow key={row.id}>
              {row.getVisibleCells().map((cell) => (
                <TableCell key={cell.id} className="px-3 align-top">
                  {flexRender(cell.column.columnDef.cell, cell.getContext())}
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </ExceptionSection>
  )
}
