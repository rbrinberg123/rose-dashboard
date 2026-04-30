"use client"

import * as React from "react"
import { ChevronDown, ChevronRight, Pencil, Plus, Trash2, TrendingUp, X } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Label } from "@/components/ui/label"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { UserCombobox } from "@/components/user-combobox"
import { cn } from "@/lib/utils"
import { formatCurrency, formatDate } from "@/lib/format"
import type {
  CostAssumptionsRow,
  SalaryScheduleRow,
  UserOption,
} from "@/lib/types"
import { SalaryDialog } from "./salary-dialog"
import { RecordRaiseDialog } from "./record-raise-dialog"
import { deleteSalary } from "./actions"

const ALL_USERS = "__all__"

type Filters = {
  user: string
  activeOnly: boolean
}

const EMPTY_FILTERS: Filters = { user: ALL_USERS, activeOnly: false }

function loadedAnnualCost(row: SalaryScheduleRow): number {
  return (Number(row.annual_salary) + Number(row.annual_bonus)) * Number(row.benefits_multiplier)
}

function isCurrentlyActive(row: SalaryScheduleRow, today: string): boolean {
  return row.effective_from <= today && (row.effective_to == null || row.effective_to >= today)
}

export function SalaryScheduleTable({
  rows,
  users,
  costDefaults,
}: {
  rows: SalaryScheduleRow[]
  users: UserOption[]
  costDefaults: CostAssumptionsRow | null
}) {
  const today = React.useMemo(() => new Date().toISOString().slice(0, 10), [])

  const userById = React.useMemo(() => {
    const m = new Map<string, UserOption>()
    for (const u of users) m.set(u.user_id, u)
    return m
  }, [users])

  const [filters, setFilters] = React.useState<Filters>(EMPTY_FILTERS)
  const [adding, setAdding] = React.useState(false)
  const [editing, setEditing] = React.useState<SalaryScheduleRow | null>(null)
  const [recordingRaise, setRecordingRaise] = React.useState(false)
  const [confirmDelete, setConfirmDelete] = React.useState<SalaryScheduleRow | null>(null)
  const [pending, startTransition] = React.useTransition()

  // Apply filters then group by user.
  const grouped = React.useMemo(() => {
    const filtered = rows.filter((r) => {
      if (filters.user !== ALL_USERS && r.user_id !== filters.user) return false
      if (filters.activeOnly && !isCurrentlyActive(r, today)) return false
      return true
    })
    const byUser = new Map<string, SalaryScheduleRow[]>()
    for (const r of filtered) {
      if (!byUser.has(r.user_id)) byUser.set(r.user_id, [])
      byUser.get(r.user_id)!.push(r)
    }
    // Sort users by display name; sort each user's periods desc by effective_from.
    return [...byUser.entries()]
      .map(([uid, list]) => ({
        userId: uid,
        userName: userById.get(uid)?.display_name ?? "(unnamed)",
        rows: [...list].sort((a, b) => (a.effective_from < b.effective_from ? 1 : -1)),
      }))
      .sort((a, b) => a.userName.localeCompare(b.userName))
  }, [rows, filters, today, userById])

  // Default to all groups expanded; lets user collapse with the chevron.
  const [collapsed, setCollapsed] = React.useState<Set<string>>(new Set())
  function toggleCollapse(uid: string) {
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(uid)) next.delete(uid)
      else next.add(uid)
      return next
    })
  }

  function handleDelete(row: SalaryScheduleRow) {
    startTransition(async () => {
      const result = await deleteSalary(row.id)
      if (result.ok) {
        toast.success("Salary record deleted")
        setConfirmDelete(null)
      } else {
        toast.error("Could not delete salary record", { description: result.error })
      }
    })
  }

  const hasFilters = filters.user !== ALL_USERS || filters.activeOnly

  return (
    <>
      <div className="mb-3 flex flex-wrap items-end gap-2">
        <div className="grid gap-1.5 min-w-64">
          <label className="text-xs font-medium text-muted-foreground">User</label>
          <UserCombobox
            options={[{ user_id: ALL_USERS, display_name: "All users" }, ...users]}
            value={filters.user}
            onChange={(v) => setFilters((f) => ({ ...f, user: v ?? ALL_USERS }))}
            placeholder="All users"
          />
        </div>
        <div className="flex items-center gap-2 pb-2">
          <Checkbox
            id="active-only"
            checked={filters.activeOnly}
            onCheckedChange={(v) => setFilters((f) => ({ ...f, activeOnly: v === true }))}
          />
          <Label htmlFor="active-only" className="text-sm font-normal">
            Active periods only
          </Label>
        </div>
        {hasFilters ? (
          <Button variant="ghost" size="sm" onClick={() => setFilters(EMPTY_FILTERS)}>
            <X className="size-3.5" /> Clear
          </Button>
        ) : null}
        <div className="ml-auto flex gap-2">
          <Button variant="secondary" onClick={() => setRecordingRaise(true)}>
            <TrendingUp className="size-4" /> Record raise
          </Button>
          <Button onClick={() => setAdding(true)}>
            <Plus className="size-4" /> Add record
          </Button>
        </div>
      </div>

      <div className="space-y-3">
        {grouped.length === 0 ? (
          <div className="rounded-lg border border-border bg-card p-6 text-center text-sm text-muted-foreground">
            {rows.length === 0
              ? "No salary records yet. Click Add record to start."
              : "No salary records match the current filters."}
          </div>
        ) : (
          grouped.map((group) => {
            const isCollapsed = collapsed.has(group.userId)
            return (
              <div key={group.userId} className="rounded-lg border border-border bg-card">
                <button
                  type="button"
                  onClick={() => toggleCollapse(group.userId)}
                  className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left"
                >
                  <div className="flex items-center gap-2">
                    {isCollapsed ? (
                      <ChevronRight className="size-4 text-muted-foreground" />
                    ) : (
                      <ChevronDown className="size-4 text-muted-foreground" />
                    )}
                    <span className="font-medium">{group.userName}</span>
                  </div>
                  <span className="text-xs text-muted-foreground tabular-nums">
                    {group.rows.length} {group.rows.length === 1 ? "period" : "periods"}
                  </span>
                </button>
                {isCollapsed ? null : (
                  <div className="border-t border-border">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="px-3">From</TableHead>
                          <TableHead className="px-3">To</TableHead>
                          <TableHead className="px-3 text-right">Salary</TableHead>
                          <TableHead className="px-3 text-right">Bonus</TableHead>
                          <TableHead className="px-3 text-right">Benefits ×</TableHead>
                          <TableHead className="px-3 text-right">Loaded annual</TableHead>
                          <TableHead className="px-3">Notes</TableHead>
                          <TableHead className="px-3 text-right">Actions</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {group.rows.map((row) => {
                          const active = isCurrentlyActive(row, today)
                          return (
                            <TableRow
                              key={row.id}
                              className={cn(active && "bg-emerald-50/60 dark:bg-emerald-900/10")}
                            >
                              <TableCell className="px-3 tabular-nums">
                                {formatDate(row.effective_from)}
                              </TableCell>
                              <TableCell className="px-3 tabular-nums">
                                {row.effective_to ? (
                                  formatDate(row.effective_to)
                                ) : (
                                  <span className="text-emerald-700 dark:text-emerald-300">Active</span>
                                )}
                              </TableCell>
                              <TableCell className="px-3 text-right tabular-nums">
                                {formatCurrency(Number(row.annual_salary))}
                              </TableCell>
                              <TableCell className="px-3 text-right tabular-nums">
                                {formatCurrency(Number(row.annual_bonus))}
                              </TableCell>
                              <TableCell className="px-3 text-right tabular-nums text-muted-foreground">
                                {Number(row.benefits_multiplier).toFixed(2)}×
                              </TableCell>
                              <TableCell className="px-3 text-right tabular-nums font-medium">
                                {formatCurrency(loadedAnnualCost(row))}
                              </TableCell>
                              <TableCell className="px-3 max-w-xs truncate text-sm text-muted-foreground">
                                {row.notes ?? "—"}
                              </TableCell>
                              <TableCell className="px-3">
                                <div className="flex items-center justify-end gap-1">
                                  <Button variant="ghost" size="sm" onClick={() => setEditing(row)}>
                                    <Pencil className="size-3.5" /> Edit
                                  </Button>
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => setConfirmDelete(row)}
                                    className="text-destructive hover:text-destructive"
                                  >
                                    <Trash2 className="size-3.5" /> Delete
                                  </Button>
                                </div>
                              </TableCell>
                            </TableRow>
                          )
                        })}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </div>
            )
          })
        )}
      </div>

      <SalaryDialog
        open={adding}
        onOpenChange={setAdding}
        initial={null}
        users={users}
        costDefaults={costDefaults}
      />
      <SalaryDialog
        open={editing !== null}
        onOpenChange={(o) => { if (!o) setEditing(null) }}
        initial={editing}
        users={users}
        costDefaults={costDefaults}
      />
      <RecordRaiseDialog
        open={recordingRaise}
        onOpenChange={setRecordingRaise}
        users={users}
        rows={rows}
        costDefaults={costDefaults}
      />

      <AlertDialog open={confirmDelete !== null} onOpenChange={(o) => { if (!o) setConfirmDelete(null) }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this salary record?</AlertDialogTitle>
            <AlertDialogDescription>
              {confirmDelete ? (
                <>
                  Removes {userById.get(confirmDelete.user_id)?.display_name ?? "this user"}&apos;s record for{" "}
                  {formatDate(confirmDelete.effective_from)} →{" "}
                  {confirmDelete.effective_to ? formatDate(confirmDelete.effective_to) : "active"}.
                  Meeting costs covering this period will fall back to "missing salary" until replaced.
                </>
              ) : null}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={pending}
              onClick={() => confirmDelete && handleDelete(confirmDelete)}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
