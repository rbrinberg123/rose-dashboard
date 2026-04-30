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
import type { MissingPersonRow } from "@/lib/types"

const MISSING_LABEL: Record<MissingPersonRow["missing"], string> = {
  booker: "Missing booker",
  host: "Missing host",
  both: "Missing both",
}

const columns: ColumnDef<MissingPersonRow>[] = [
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
    id: "institution_name",
    accessorKey: "institution_name",
    header: ({ column }) => (
      <SortHeader label="Institution" isSorted={column.getIsSorted()} onClick={() => column.toggleSorting()} />
    ),
    cell: ({ row }) => row.original.institution_name ?? "—",
  },
  {
    id: "missing",
    accessorKey: "missing",
    header: ({ column }) => (
      <SortHeader label="Missing role(s)" isSorted={column.getIsSorted()} onClick={() => column.toggleSorting()} />
    ),
    cell: ({ row }) => (
      <span className="inline-flex items-center rounded-md bg-rose-100 px-2 py-0.5 text-xs font-medium text-rose-900 dark:bg-rose-900/30 dark:text-rose-200">
        {MISSING_LABEL[row.original.missing]}
      </span>
    ),
  },
]

export function MissingPeopleSection({ rows }: { rows: MissingPersonRow[] }) {
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
      title="A. Meetings missing a booker or host"
      description="One or both of the people on the meeting are blank in Dynamics, so labor cost can't be attributed."
      count={rows.length}
      action={<>Fix in Dynamics, then run sync.</>}
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
