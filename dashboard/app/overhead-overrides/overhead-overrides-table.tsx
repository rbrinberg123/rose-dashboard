"use client"

import * as React from "react"
import { Pencil, Plus, Trash2, X } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
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
import { ClientCombobox } from "@/components/client-combobox"
import { formatCurrency, formatPercent, formatQuarter } from "@/lib/format"
import type {
  AccountOption,
  OverheadOverrideRow,
  OverheadPeriodRow,
} from "@/lib/types"
import { OverheadOverrideDialog } from "./overhead-override-dialog"
import { deleteOverheadOverride } from "./actions"

const ALL = "__all__"

type Filters = { year: string; quarter: string; client: string }
const EMPTY: Filters = { year: ALL, quarter: ALL, client: ALL }

export function OverheadOverridesTable({
  rows,
  accounts,
  periods,
}: {
  rows: OverheadOverrideRow[]
  accounts: AccountOption[]
  periods: OverheadPeriodRow[]
}) {
  const accountById = React.useMemo(() => {
    const m = new Map<string, AccountOption>()
    for (const a of accounts) m.set(a.account_id, a)
    return m
  }, [accounts])

  const periodByYQ = React.useMemo(() => {
    const m = new Map<string, OverheadPeriodRow>()
    for (const p of periods) m.set(`${p.period_year}-${p.period_quarter}`, p)
    return m
  }, [periods])

  const yearOptions = React.useMemo(() => {
    const ys = new Set<number>()
    for (const r of rows) ys.add(r.period_year)
    for (const p of periods) ys.add(p.period_year)
    return [...ys].sort((a, b) => b - a)
  }, [rows, periods])

  const [filters, setFilters] = React.useState<Filters>(EMPTY)
  const [editing, setEditing] = React.useState<OverheadOverrideRow | null>(null)
  const [adding, setAdding] = React.useState(false)
  const [confirmDelete, setConfirmDelete] = React.useState<OverheadOverrideRow | null>(null)
  const [pending, startTransition] = React.useTransition()

  const filtered = React.useMemo(() => {
    return rows.filter((r) => {
      if (filters.year !== ALL && r.period_year !== Number(filters.year)) return false
      if (filters.quarter !== ALL && r.period_quarter !== Number(filters.quarter)) return false
      if (filters.client !== ALL && r.client_account_id !== filters.client) return false
      return true
    })
  }, [rows, filters])

  function resolvedAmount(row: OverheadOverrideRow): number | null {
    if (row.fixed_amount != null) return Number(row.fixed_amount)
    if (row.percent_of_total != null) {
      const p = periodByYQ.get(`${row.period_year}-${row.period_quarter}`)
      if (!p) return null
      return Number(row.percent_of_total) * Number(p.total_overhead_amount)
    }
    return null
  }

  function handleDelete(row: OverheadOverrideRow) {
    startTransition(async () => {
      const result = await deleteOverheadOverride(row.id)
      if (result.ok) {
        toast.success("Override deleted")
        setConfirmDelete(null)
      } else {
        toast.error("Could not delete override", { description: result.error })
      }
    })
  }

  const hasFilters = filters.year !== ALL || filters.quarter !== ALL || filters.client !== ALL

  return (
    <>
      <div className="mb-3 flex flex-wrap items-end gap-2">
        <div className="grid gap-1.5">
          <label className="text-xs font-medium text-muted-foreground">Year</label>
          <Select value={filters.year} onValueChange={(v) => setFilters((f) => ({ ...f, year: v ?? ALL }))}>
            <SelectTrigger className="w-28">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>All years</SelectItem>
              {yearOptions.map((y) => (
                <SelectItem key={y} value={String(y)}>{y}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="grid gap-1.5">
          <label className="text-xs font-medium text-muted-foreground">Quarter</label>
          <Select value={filters.quarter} onValueChange={(v) => setFilters((f) => ({ ...f, quarter: v ?? ALL }))}>
            <SelectTrigger className="w-28">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>All</SelectItem>
              {[1, 2, 3, 4].map((q) => (
                <SelectItem key={q} value={String(q)}>Q{q}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="grid gap-1.5 min-w-72">
          <label className="text-xs font-medium text-muted-foreground">Client</label>
          <ClientCombobox
            options={[{ account_id: ALL, name: "All clients", ticker_symbol: null }, ...accounts]}
            value={filters.client}
            onChange={(v) => setFilters((f) => ({ ...f, client: v ?? ALL }))}
            placeholder="All clients"
          />
        </div>
        {hasFilters ? (
          <Button variant="ghost" size="sm" onClick={() => setFilters(EMPTY)}>
            <X className="size-3.5" /> Clear
          </Button>
        ) : null}
        <div className="ml-auto">
          <Button onClick={() => setAdding(true)}>
            <Plus className="size-4" /> Add override
          </Button>
        </div>
      </div>

      <div className="rounded-lg border border-border bg-card">
        <Table>
          <TableHeader className="bg-card">
            <TableRow>
              <TableHead className="px-3">Period</TableHead>
              <TableHead className="px-3">Client</TableHead>
              <TableHead className="px-3">Type</TableHead>
              <TableHead className="px-3 text-right">Amount / Percent</TableHead>
              <TableHead className="px-3 text-right">Resolved</TableHead>
              <TableHead className="px-3">Notes</TableHead>
              <TableHead className="px-3 text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="h-32 text-center text-sm text-muted-foreground">
                  {rows.length === 0 ? "No overhead overrides yet." : "No overrides match the current filters."}
                </TableCell>
              </TableRow>
            ) : (
              filtered.map((row) => {
                const account = accountById.get(row.client_account_id)
                const isFixed = row.fixed_amount != null
                const resolved = resolvedAmount(row)
                return (
                  <TableRow key={row.id}>
                    <TableCell className="px-3 font-medium">
                      {formatQuarter(row.period_year, row.period_quarter)}
                    </TableCell>
                    <TableCell className="px-3">
                      <div className="min-w-0">
                        <div className="truncate font-medium">{account?.name ?? row.client_account_id}</div>
                        {account?.ticker_symbol ? (
                          <div className="truncate text-xs text-muted-foreground">{account.ticker_symbol}</div>
                        ) : null}
                      </div>
                    </TableCell>
                    <TableCell className="px-3 text-sm">{isFixed ? "Fixed $" : "Percent"}</TableCell>
                    <TableCell className="px-3 text-right tabular-nums">
                      {isFixed
                        ? formatCurrency(Number(row.fixed_amount))
                        : formatPercent(Number(row.percent_of_total))}
                    </TableCell>
                    <TableCell className="px-3 text-right tabular-nums text-muted-foreground">
                      {resolved == null ? "—" : formatCurrency(resolved)}
                    </TableCell>
                    <TableCell className="px-3 max-w-md truncate text-sm text-muted-foreground">
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
              })
            )}
          </TableBody>
        </Table>
      </div>

      <OverheadOverrideDialog
        open={adding}
        onOpenChange={setAdding}
        initial={null}
        accounts={accounts}
        periods={periods}
        existingOverrides={rows}
      />
      <OverheadOverrideDialog
        open={editing !== null}
        onOpenChange={(o) => { if (!o) setEditing(null) }}
        initial={editing}
        accounts={accounts}
        periods={periods}
        existingOverrides={rows}
      />

      <AlertDialog open={confirmDelete !== null} onOpenChange={(o) => { if (!o) setConfirmDelete(null) }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this override?</AlertDialogTitle>
            <AlertDialogDescription>
              {confirmDelete ? (
                <>
                  Removes the override for{" "}
                  <strong>{accountById.get(confirmDelete.client_account_id)?.name ?? "this client"}</strong>{" "}
                  in {formatQuarter(confirmDelete.period_year, confirmDelete.period_quarter)}. Allocation
                  will fall back to meeting-share until re-added.
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
