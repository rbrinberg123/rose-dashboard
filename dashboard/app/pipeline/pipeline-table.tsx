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
import { formatDate } from "@/lib/format"
import { cn } from "@/lib/utils"
import type { Pipeline30dRow } from "@/lib/types"

const ALL = "__all__"
const TYPE_IN_PERSON = "in_person"
const TYPE_VIRTUAL = "virtual"

type GlobalFilter = {
  search: string
  type: string // ALL | TYPE_IN_PERSON | TYPE_VIRTUAL
  group: string // ALL | "yes" | "no"
}

const globalFilterFn: FilterFn<Pipeline30dRow> = (row, _columnId, filter: GlobalFilter) => {
  const r = row.original
  if (filter.search) {
    const q = filter.search.toLowerCase()
    const hay = `${r.client_account_name ?? ""} ${r.institution_name ?? ""} ${r.investor_text ?? ""} ${r.host_name ?? ""} ${r.booker_name ?? ""}`.toLowerCase()
    if (!hay.includes(q)) return false
  }
  if (filter.type === TYPE_IN_PERSON && r.is_in_person !== true) return false
  if (filter.type === TYPE_VIRTUAL && r.is_in_person !== false) return false
  if (filter.group === "yes" && r.group_meeting !== true) return false
  if (filter.group === "no" && r.group_meeting === true) return false
  return true
}

function TypeBadge({ inPerson }: { inPerson: boolean | null }) {
  if (inPerson === true) {
    return (
      <span className="inline-flex items-center rounded-md bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-900 dark:bg-blue-900/30 dark:text-blue-200">
        In-person
      </span>
    )
  }
  if (inPerson === false) {
    return (
      <span className="inline-flex items-center rounded-md bg-violet-100 px-2 py-0.5 text-xs font-medium text-violet-900 dark:bg-violet-900/30 dark:text-violet-200">
        Virtual
      </span>
    )
  }
  return <span className="text-xs text-muted-foreground">—</span>
}

function GroupBadge({ value }: { value: boolean | null }) {
  if (!value) return <span className="text-xs text-muted-foreground">—</span>
  return (
    <span className="inline-flex items-center rounded-md bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-900 dark:bg-amber-900/30 dark:text-amber-200">
      Group
    </span>
  )
}

const columns: ColumnDef<Pipeline30dRow>[] = [
  {
    id: "meeting_date",
    accessorKey: "meeting_date",
    sortingFn: "datetime",
    header: ({ column }) => (
      <SortHeader label="Date" isSorted={column.getIsSorted()} onClick={() => column.toggleSorting()} />
    ),
    cell: ({ row }) => formatDate(row.original.meeting_date),
  },
  {
    id: "days_until",
    accessorKey: "days_until",
    sortingFn: "basic",
    header: ({ column }) => (
      <SortHeader label="Days until" isSorted={column.getIsSorted()} onClick={() => column.toggleSorting()} align="right" />
    ),
    cell: ({ row }) => {
      const d = row.original.days_until
      const cls =
        d === 0
          ? "text-foreground font-medium"
          : d <= 3
            ? "text-amber-700 dark:text-amber-300"
            : "text-muted-foreground"
      return <div className={cn("text-right tabular-nums", cls)}>{d}</div>
    },
  },
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
    id: "institution_name",
    accessorKey: "institution_name",
    header: ({ column }) => (
      <SortHeader label="Institution" isSorted={column.getIsSorted()} onClick={() => column.toggleSorting()} />
    ),
    cell: ({ row }) => row.original.institution_name ?? "—",
  },
  {
    id: "investor_text",
    accessorKey: "investor_text",
    header: ({ column }) => (
      <SortHeader label="Investor" isSorted={column.getIsSorted()} onClick={() => column.toggleSorting()} />
    ),
    cell: ({ row }) => (
      <div className="max-w-xs truncate text-sm">{row.original.investor_text ?? "—"}</div>
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
  {
    id: "type",
    accessorFn: (r) => (r.is_in_person === true ? "In-person" : r.is_in_person === false ? "Virtual" : ""),
    header: ({ column }) => (
      <SortHeader label="Type" isSorted={column.getIsSorted()} onClick={() => column.toggleSorting()} />
    ),
    cell: ({ row }) => <TypeBadge inPerson={row.original.is_in_person} />,
  },
  {
    id: "group_meeting",
    accessorFn: (r) => (r.group_meeting ? 1 : 0),
    header: ({ column }) => (
      <SortHeader label="Group?" isSorted={column.getIsSorted()} onClick={() => column.toggleSorting()} />
    ),
    cell: ({ row }) => <GroupBadge value={row.original.group_meeting} />,
  },
]

export function PipelineTable({ rows }: { rows: Pipeline30dRow[] }) {
  // Default sort by date ascending — pipeline reads chronologically.
  const [sorting, setSorting] = React.useState<SortingState>([{ id: "meeting_date", desc: false }])
  const [filter, setFilter] = React.useState<GlobalFilter>({ search: "", type: ALL, group: ALL })

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
  const hasFilters = filter.search || filter.type !== ALL || filter.group !== ALL

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-56 max-w-sm">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={filter.search}
            onChange={(e) => setFilter((f) => ({ ...f, search: e.target.value }))}
            placeholder="Search client, investor, host, booker"
            className="pl-8"
          />
        </div>

        <Select value={filter.type} onValueChange={(v) => setFilter((f) => ({ ...f, type: v ?? ALL }))}>
          <SelectTrigger className="w-40">
            <SelectValue placeholder="Type" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All types</SelectItem>
            <SelectItem value={TYPE_IN_PERSON}>In-person</SelectItem>
            <SelectItem value={TYPE_VIRTUAL}>Virtual</SelectItem>
          </SelectContent>
        </Select>

        <Select value={filter.group} onValueChange={(v) => setFilter((f) => ({ ...f, group: v ?? ALL }))}>
          <SelectTrigger className="w-36">
            <SelectValue placeholder="Group?" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All</SelectItem>
            <SelectItem value="yes">Group only</SelectItem>
            <SelectItem value="no">Non-group</SelectItem>
          </SelectContent>
        </Select>

        {hasFilters ? (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setFilter({ search: "", type: ALL, group: ALL })}
          >
            <X /> Clear
          </Button>
        ) : null}

        <div className="ml-auto text-xs text-muted-foreground tabular-nums">
          {visibleCount.toLocaleString()} of {rows.length.toLocaleString()} meetings
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
                    ? "No meetings scheduled in the next 30 days."
                    : "No meetings match the current filters."}
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
