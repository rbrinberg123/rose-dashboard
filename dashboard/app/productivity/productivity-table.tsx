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
import { CARD_CLASS } from "@/lib/design"
import { formatPercent } from "@/lib/format"
import type { PersonRole, ProductivityRoleRow } from "@/lib/types"

// Role filter options for the segmented toggle. "All" = no filter;
// "Unclassified" = people with no role (null / under-25-activity).
const ROLE_FILTERS = ["All", "Host", "Booker", "Hybrid", "Unclassified"] as const
type RoleFilter = (typeof ROLE_FILTERS)[number]

function matchesRoleFilter(role: PersonRole, filter: RoleFilter): boolean {
  if (filter === "All") return true
  if (filter === "Unclassified") return role === null
  return role === filter
}

// Account-management filter, driven by the per-person manager counts already
// on each row (from v_productivity_person_manager_stats).
const AM_FILTERS = ["All", "Primary", "Secondary", "Either"] as const
type AccountMgmtFilter = (typeof AM_FILTERS)[number]

function matchesAmFilter(row: ProductivityRoleRow, filter: AccountMgmtFilter): boolean {
  if (filter === "All") return true
  const isPrimary = row.primary_manager_count > 0
  const isSecondary = row.secondary_manager_count > 0
  if (filter === "Primary") return isPrimary
  if (filter === "Secondary") return isSecondary
  return isPrimary || isSecondary // Either
}

function nullSafeNumberCmp(a: number | null, b: number | null): number {
  if (a == null && b == null) return 0
  if (a == null) return 1
  if (b == null) return -1
  return a - b
}

// Role pill palette + sort rank (Host > Hybrid > Booker > unclassified).
const ROLE_STYLES: Record<"Host" | "Booker" | "Hybrid", { bg: string; text: string }> = {
  Host: { bg: "#E2F2EE", text: "#0E7C72" },
  Booker: { bg: "#EAF0FB", text: "#2A3C77" },
  Hybrid: { bg: "#F0EAFB", text: "#5B4B9E" },
}
const ROLE_RANK: Record<"Host" | "Booker" | "Hybrid", number> = { Host: 3, Hybrid: 2, Booker: 1 }
function roleRank(role: PersonRole): number {
  return role ? ROLE_RANK[role] : 0
}

function RolePill({ role }: { role: PersonRole }) {
  if (!role) return <span className="text-muted-foreground">—</span>
  const s = ROLE_STYLES[role]
  return (
    <span
      className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium"
      style={{ backgroundColor: s.bg, color: s.text }}
    >
      {role}
    </span>
  )
}

const columns: ColumnDef<ProductivityRoleRow>[] = [
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
    id: "role",
    accessorFn: (r) => r.role ?? "",
    sortingFn: (a, b) => roleRank(a.original.role) - roleRank(b.original.role),
    header: ({ column }) => (
      <SortHeader
        label="Role"
        isSorted={column.getIsSorted()}
        onClick={() => column.toggleSorting()}
      />
    ),
    cell: ({ row }) => <RolePill role={row.original.role} />,
  },
  {
    id: "primary_manager_count",
    accessorKey: "primary_manager_count",
    header: ({ column }) => (
      <SortHeader
        label="Primary Manager"
        isSorted={column.getIsSorted()}
        onClick={() => column.toggleSorting()}
        align="right"
      />
    ),
    cell: ({ row }) => (
      <div className="text-right tabular-nums">
        {row.original.primary_manager_count.toLocaleString()}
      </div>
    ),
  },
  {
    id: "secondary_manager_count",
    accessorKey: "secondary_manager_count",
    header: ({ column }) => (
      <SortHeader
        label="Secondary Manager"
        isSorted={column.getIsSorted()}
        onClick={() => column.toggleSorting()}
        align="right"
      />
    ),
    cell: ({ row }) => (
      <div className="text-right tabular-nums">
        {row.original.secondary_manager_count.toLocaleString()}
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
  // Labor cost column is intentionally hidden for now. The labor_cost value is
  // still computed in the page logic so this column can be re-added later.
  // Hidden sort-only column: total activity = booked + hosted. Drives the
  // default sort (descending) without adding a visible column.
  {
    id: "total_activity",
    accessorFn: (r) => r.booked + r.hosted,
    enableHiding: true,
  },
]

// Labeled segmented toggle (Feedback-page style): rounded button group, active
// button filled navy, 0.5px border around the group.
function SegmentedFilter<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string
  options: readonly T[]
  value: T
  onChange: (v: T) => void
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-sm text-muted-foreground">{label}</span>
      <div
        className="flex h-9 items-center rounded-md bg-card p-0.5"
        style={{ border: "0.5px solid var(--border)" }}
      >
        {options.map((opt) => {
          const active = value === opt
          return (
            <button
              key={opt}
              type="button"
              onClick={() => onChange(opt)}
              className={
                "rounded px-2.5 py-1 text-xs font-medium transition-colors " +
                (active ? "bg-[#1E2858] text-white" : "text-foreground hover:bg-slate-50")
              }
            >
              {opt}
            </button>
          )
        })}
      </div>
    </div>
  )
}

export function ProductivityTable({ rows }: { rows: ProductivityRoleRow[] }) {
  const [sorting, setSorting] = React.useState<SortingState>([
    { id: "total_activity", desc: true },
  ])
  const [roleFilter, setRoleFilter] = React.useState<RoleFilter>("All")
  const [amFilter, setAmFilter] = React.useState<AccountMgmtFilter>("All")

  // Filter by role AND account-management before the table sees the data, so
  // sorting/render only operate on the in-filter rows.
  const filteredRows = React.useMemo(
    () =>
      rows.filter(
        (r) => matchesRoleFilter(r.role, roleFilter) && matchesAmFilter(r, amFilter),
      ),
    [rows, roleFilter, amFilter],
  )

  const table = useReactTable({
    data: filteredRows,
    columns,
    // total_activity is a hidden sort-only column (booked + hosted) that drives
    // the default sort; keep it out of the visible table. Controlled visibility
    // (not initialState) so it stays hidden across hot-reloads/remounts.
    state: { sorting, columnVisibility: { total_activity: false } },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  })

  const visibleCount = filteredRows.length

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <SegmentedFilter
          label="Role"
          options={ROLE_FILTERS}
          value={roleFilter}
          onChange={setRoleFilter}
        />
        <SegmentedFilter
          label="Account Management"
          options={AM_FILTERS}
          value={amFilter}
          onChange={setAmFilter}
        />

        <div className="ml-auto text-xs tabular-nums text-muted-foreground">
          {visibleCount.toLocaleString()} of {rows.length.toLocaleString()} people
        </div>
      </div>

      <p className="text-xs leading-relaxed text-muted-foreground">
        Role reflects each person&apos;s booking-vs-hosting split over the trailing 12
        months. A person is a Host or Booker when that activity is at least 70% of their
        total actions; otherwise Hybrid. People with fewer than 25 total actions in the
        trailing 12 months aren&apos;t classified (shown as &ldquo;—&rdquo;) — not enough
        activity to determine a role.
      </p>

      <div className={CARD_CLASS}>
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
                  colSpan={table.getVisibleLeafColumns().length}
                  className="h-32 text-center text-sm text-muted-foreground"
                >
                  {rows.length === 0
                    ? "No activity recorded for the selected date range."
                    : "No people match the current filter."}
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
