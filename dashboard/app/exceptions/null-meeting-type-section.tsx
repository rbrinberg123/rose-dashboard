"use client"

import * as React from "react"
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
import { formatDate } from "@/lib/format"
import type { NullMeetingTypeRow } from "@/lib/types"

const columns: ColumnDef<NullMeetingTypeRow>[] = [
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
    id: "host_name",
    accessorKey: "host_name",
    header: ({ column }) => (
      <SortHeader label="Host" isSorted={column.getIsSorted()} onClick={() => column.toggleSorting()} />
    ),
    cell: ({ row }) => row.original.host_name ?? "—",
  },
  {
    id: "booker_name",
    accessorKey: "booker_name",
    header: ({ column }) => (
      <SortHeader label="Booker" isSorted={column.getIsSorted()} onClick={() => column.toggleSorting()} />
    ),
    cell: ({ row }) => row.original.booker_name ?? "—",
  },
]

export function NullMeetingTypeSection({ rows }: { rows: NullMeetingTypeRow[] }) {
  const [sorting, setSorting] = React.useState<SortingState>([{ id: "meeting_date", desc: true }])

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
      title="E. Meetings with no meeting type"
      description="These default to virtual cost — set the meeting type in Dynamics for accurate attribution."
      count={rows.length}
      action={<>Set meeting type in Dynamics, then run sync.</>}
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
