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
import type { NoOverheadAllocRow } from "@/lib/types"

const columns: ColumnDef<NoOverheadAllocRow>[] = [
  {
    id: "client_account_name",
    accessorKey: "client_account_name",
    header: ({ column }) => (
      <SortHeader label="Client" isSorted={column.getIsSorted()} onClick={() => column.toggleSorting()} />
    ),
    cell: ({ row }) => (
      <span className="font-medium">{row.original.client_account_name ?? "—"}</span>
    ),
  },
  {
    id: "current_quarter_revenue",
    accessorKey: "current_quarter_revenue",
    sortingFn: "basic",
    header: ({ column }) => (
      <SortHeader label="Revenue" isSorted={column.getIsSorted()} onClick={() => column.toggleSorting()} align="right" />
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
      <SortHeader label="Margin" isSorted={column.getIsSorted()} onClick={() => column.toggleSorting()} align="right" />
    ),
    cell: ({ row }) => (
      <div className="text-right tabular-nums">{formatCurrency(row.original.current_quarter_margin)}</div>
    ),
  },
]

export function NoOverheadAllocSection({
  rows,
  year,
  quarter,
}: {
  rows: NoOverheadAllocRow[]
  year: number
  quarter: number
}) {
  const [sorting, setSorting] = React.useState<SortingState>([
    { id: "current_quarter_revenue", desc: true },
  ])

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
      title={`C. Clients with revenue but no overhead allocation (${formatQuarter(year, quarter)})`}
      description="Revenue but zero meetings and no override → got $0 overhead share. Margin is overstated."
      count={rows.length}
      action={
        <>
          Add an overhead override on{" "}
          <Link href="/overhead-overrides" className="underline underline-offset-2">
            Overhead Overrides
          </Link>
          , or confirm the client truly has no operational footprint and accept the current attribution.
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
