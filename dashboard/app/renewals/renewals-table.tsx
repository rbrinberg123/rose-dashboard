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
import { UrgencyBadge } from "@/components/urgency-badge"
import { formatCurrency, formatDate } from "@/lib/format"
import type { ContractRenewalRow } from "@/lib/types"

const ALL = "__all__"

type GlobalFilter = {
  search: string
  urgency: string // ALL or one of the four levels
}

const globalFilterFn: FilterFn<ContractRenewalRow> = (row, _columnId, filter: GlobalFilter) => {
  const r = row.original
  if (filter.search) {
    const q = filter.search.toLowerCase()
    if (!(r.client_account_name ?? "").toLowerCase().includes(q)) return false
  }
  if (filter.urgency && filter.urgency !== ALL) {
    if (r.renewal_urgency !== filter.urgency) return false
  }
  return true
}

// For sorting urgency by severity rather than alphabetically.
const URGENCY_ORDER: Record<string, number> = {
  overdue: 0,
  urgent: 1,
  soon: 2,
  future: 3,
}

const columns: ColumnDef<ContractRenewalRow>[] = [
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
    id: "contract_renewal_date",
    accessorKey: "contract_renewal_date",
    sortingFn: "datetime",
    header: ({ column }) => (
      <SortHeader label="Renewal date" isSorted={column.getIsSorted()} onClick={() => column.toggleSorting()} />
    ),
    cell: ({ row }) => formatDate(row.original.contract_renewal_date),
  },
  {
    id: "days_to_renewal",
    accessorKey: "days_to_renewal",
    sortingFn: "basic",
    header: ({ column }) => (
      <SortHeader label="Days to renewal" isSorted={column.getIsSorted()} onClick={() => column.toggleSorting()} align="right" />
    ),
    cell: ({ row }) => (
      <div className="text-right tabular-nums">{row.original.days_to_renewal.toLocaleString()}</div>
    ),
  },
  {
    id: "quarterly_retainer",
    accessorKey: "quarterly_retainer",
    sortingFn: "basic",
    header: ({ column }) => (
      <SortHeader label="Q retainer" isSorted={column.getIsSorted()} onClick={() => column.toggleSorting()} align="right" />
    ),
    cell: ({ row }) => (
      <div className="text-right tabular-nums">{formatCurrency(row.original.quarterly_retainer)}</div>
    ),
  },
  {
    id: "auto_renew",
    accessorFn: (r) => (r.auto_renew ? 1 : 0),
    header: ({ column }) => (
      <SortHeader label="Auto-renew" isSorted={column.getIsSorted()} onClick={() => column.toggleSorting()} />
    ),
    cell: ({ row }) =>
      row.original.auto_renew == null ? "—" : row.original.auto_renew ? "Yes" : "No",
  },
  {
    id: "renew",
    accessorFn: (r) => (r.renew ? 1 : 0),
    header: ({ column }) => (
      <SortHeader label="Renew intent" isSorted={column.getIsSorted()} onClick={() => column.toggleSorting()} />
    ),
    cell: ({ row }) =>
      row.original.renew == null ? "—" : row.original.renew ? "Yes" : "No",
  },
  {
    id: "renewal_notice_date",
    accessorKey: "renewal_notice_date",
    sortingFn: "datetime",
    header: ({ column }) => (
      <SortHeader label="Notice date" isSorted={column.getIsSorted()} onClick={() => column.toggleSorting()} />
    ),
    cell: ({ row }) => formatDate(row.original.renewal_notice_date),
  },
  {
    id: "renewal_urgency",
    accessorFn: (r) => URGENCY_ORDER[r.renewal_urgency] ?? 99,
    header: ({ column }) => (
      <SortHeader label="Urgency" isSorted={column.getIsSorted()} onClick={() => column.toggleSorting()} />
    ),
    cell: ({ row }) => <UrgencyBadge value={row.original.renewal_urgency} />,
  },
]

export function RenewalsTable({ rows }: { rows: ContractRenewalRow[] }) {
  // Default sort: most urgent first via the urgency severity rank.
  const [sorting, setSorting] = React.useState<SortingState>([{ id: "renewal_urgency", desc: false }])
  const [filter, setFilter] = React.useState<GlobalFilter>({ search: "", urgency: ALL })

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
  const hasFilters = filter.search || filter.urgency !== ALL

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

        <Select value={filter.urgency} onValueChange={(v) => setFilter((f) => ({ ...f, urgency: v ?? ALL }))}>
          <SelectTrigger className="w-44">
            <SelectValue placeholder="Urgency" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All urgencies</SelectItem>
            <SelectItem value="overdue">Overdue</SelectItem>
            <SelectItem value="urgent">Urgent (&lt;30d)</SelectItem>
            <SelectItem value="soon">Soon (&lt;90d)</SelectItem>
            <SelectItem value="future">Future</SelectItem>
          </SelectContent>
        </Select>

        {hasFilters ? (
          <Button variant="ghost" size="sm" onClick={() => setFilter({ search: "", urgency: ALL })}>
            <X /> Clear
          </Button>
        ) : null}

        <div className="ml-auto text-xs text-muted-foreground tabular-nums">
          {visibleCount.toLocaleString()} of {rows.length.toLocaleString()} contracts
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
                  No contracts match the current filters.
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
