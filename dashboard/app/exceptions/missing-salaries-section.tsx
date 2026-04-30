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
import { formatCurrency, formatDate } from "@/lib/format"
import type { MissingSalaryRow } from "@/lib/types"

const columns: ColumnDef<MissingSalaryRow>[] = [
  {
    id: "meeting_date",
    accessorKey: "meeting_date",
    sortingFn: "datetime",
    header: ({ column }) => (
      <SortHeader label="Meeting date" isSorted={column.getIsSorted()} onClick={() => column.toggleSorting()} />
    ),
    cell: ({ row }) => formatDate(row.original.meeting_date),
  },
  {
    id: "user_name",
    accessorKey: "user_name",
    header: ({ column }) => (
      <SortHeader label="User" isSorted={column.getIsSorted()} onClick={() => column.toggleSorting()} />
    ),
    cell: ({ row }) => (
      <span className="font-medium">{row.original.user_name ?? "—"}</span>
    ),
  },
  {
    id: "role",
    accessorKey: "role",
    header: ({ column }) => (
      <SortHeader label="Role" isSorted={column.getIsSorted()} onClick={() => column.toggleSorting()} />
    ),
    cell: ({ row }) => (
      <span className="text-xs capitalize text-muted-foreground">{row.original.role}</span>
    ),
  },
  {
    id: "client_account_name",
    accessorKey: "client_account_name",
    header: ({ column }) => (
      <SortHeader label="Client" isSorted={column.getIsSorted()} onClick={() => column.toggleSorting()} />
    ),
    cell: ({ row }) => row.original.client_account_name ?? "—",
  },
  {
    id: "estimated_cost_loss",
    accessorKey: "estimated_cost_loss",
    sortingFn: "basic",
    header: ({ column }) => (
      <SortHeader label="Est. cost loss" isSorted={column.getIsSorted()} onClick={() => column.toggleSorting()} align="right" />
    ),
    cell: ({ row }) => (
      <div className="text-right tabular-nums">{formatCurrency(row.original.estimated_cost_loss)}</div>
    ),
  },
]

export function MissingSalariesSection({ rows }: { rows: MissingSalaryRow[] }) {
  const [sorting, setSorting] = React.useState<SortingState>([{ id: "meeting_date", desc: true }])

  const table = useReactTable({
    data: rows,
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  })

  // "Cost loss" here is the meeting_cost recorded in v_meeting_costs — when
  // a salary is missing, that cost falls back to 0 in the cost view, so the
  // value rendered is a rough impact estimate of fixing the gap.
  return (
    <ExceptionSection
      title="B. Meetings with users not in the salary schedule"
      description="No salary entry covers the meeting date, so this meeting's labor cost falls back to $0."
      count={rows.length}
      action={
        <>
          Add a salary schedule entry for this user covering the meeting date —{" "}
          <Link href="/salary-schedule" className="underline underline-offset-2">
            open Salary Schedule →
          </Link>
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
