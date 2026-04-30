"use client"

import * as React from "react"
import { Trash2, X } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
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
import { formatCurrency, formatDate, formatDateTime } from "@/lib/format"
import { DIRECT_COST_CATEGORIES, type ClientDirectCostRow, type AccountOption, type UserOption } from "@/lib/types"
import { deleteDirectCost } from "./actions"

const ALL = "__all__"

type Filters = {
  client: string
  category: string
  from: string
  to: string
}

const EMPTY: Filters = { client: ALL, category: ALL, from: "", to: "" }

export function DirectCostsTable({
  rows,
  accounts,
  users,
}: {
  rows: ClientDirectCostRow[]
  accounts: AccountOption[]
  users: UserOption[]
}) {
  const accountById = React.useMemo(() => {
    const m = new Map<string, AccountOption>()
    for (const a of accounts) m.set(a.account_id, a)
    return m
  }, [accounts])
  const userById = React.useMemo(() => {
    const m = new Map<string, UserOption>()
    for (const u of users) m.set(u.user_id, u)
    return m
  }, [users])

  const [filters, setFilters] = React.useState<Filters>(EMPTY)
  const [confirmDelete, setConfirmDelete] = React.useState<ClientDirectCostRow | null>(null)
  const [pending, startTransition] = React.useTransition()

  const filtered = React.useMemo(() => {
    return rows.filter((r) => {
      if (filters.client !== ALL && r.client_account_id !== filters.client) return false
      if (filters.category !== ALL && r.category !== filters.category) return false
      if (filters.from && r.cost_date < filters.from) return false
      if (filters.to && r.cost_date > filters.to) return false
      return true
    })
  }, [rows, filters])

  const totalAmount = filtered.reduce((s, r) => s + Number(r.amount), 0)

  const hasFilters = filters.client !== ALL || filters.category !== ALL || filters.from || filters.to

  function handleDelete(row: ClientDirectCostRow) {
    startTransition(async () => {
      const result = await deleteDirectCost(row.id)
      if (result.ok) {
        toast.success("Direct cost deleted")
        setConfirmDelete(null)
      } else {
        toast.error("Could not delete direct cost", { description: result.error })
      }
    })
  }

  return (
    <>
      <div className="mb-3 grid gap-2 sm:grid-cols-[1fr_auto_auto_auto_auto] sm:items-end">
        <div className="grid gap-1.5">
          <label className="text-xs font-medium text-muted-foreground">Client</label>
          <ClientCombobox
            options={[{ account_id: ALL, name: "All clients", ticker_symbol: null }, ...accounts]}
            value={filters.client}
            onChange={(v) => setFilters((f) => ({ ...f, client: v ?? ALL }))}
            placeholder="All clients"
          />
        </div>
        <div className="grid gap-1.5">
          <label className="text-xs font-medium text-muted-foreground">Category</label>
          <Select value={filters.category} onValueChange={(v) => setFilters((f) => ({ ...f, category: v ?? ALL }))}>
            <SelectTrigger className="w-44">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>All categories</SelectItem>
              {DIRECT_COST_CATEGORIES.map((c) => (
                <SelectItem key={c} value={c}>{c}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="grid gap-1.5">
          <label className="text-xs font-medium text-muted-foreground">From</label>
          <Input
            type="date"
            value={filters.from}
            onChange={(e) => setFilters((f) => ({ ...f, from: e.target.value }))}
            className="w-40"
          />
        </div>
        <div className="grid gap-1.5">
          <label className="text-xs font-medium text-muted-foreground">To</label>
          <Input
            type="date"
            value={filters.to}
            onChange={(e) => setFilters((f) => ({ ...f, to: e.target.value }))}
            className="w-40"
          />
        </div>
        {hasFilters ? (
          <Button variant="ghost" size="sm" onClick={() => setFilters(EMPTY)}>
            <X className="size-3.5" /> Clear
          </Button>
        ) : <div />}
      </div>

      <div className="rounded-lg border border-border bg-card">
        <Table>
          <TableHeader className="bg-card">
            <TableRow>
              <TableHead className="px-3">Date</TableHead>
              <TableHead className="px-3">Client</TableHead>
              <TableHead className="px-3">Category</TableHead>
              <TableHead className="px-3 text-right">Amount</TableHead>
              <TableHead className="px-3">Description</TableHead>
              <TableHead className="px-3">Created by</TableHead>
              <TableHead className="px-3">Created</TableHead>
              <TableHead className="px-3 text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.length === 0 ? (
              <TableRow>
                <TableCell colSpan={8} className="h-32 text-center text-sm text-muted-foreground">
                  {rows.length === 0 ? "No direct costs yet." : "No costs match the current filters."}
                </TableCell>
              </TableRow>
            ) : (
              filtered.map((row) => {
                const account = accountById.get(row.client_account_id)
                const creator = row.created_by_user_id ? userById.get(row.created_by_user_id) : null
                return (
                  <TableRow key={row.id}>
                    <TableCell className="px-3 tabular-nums">{formatDate(row.cost_date)}</TableCell>
                    <TableCell className="px-3">
                      <div className="min-w-0">
                        <div className="truncate font-medium">{account?.name ?? row.client_account_id}</div>
                        {account?.ticker_symbol ? (
                          <div className="truncate text-xs text-muted-foreground">{account.ticker_symbol}</div>
                        ) : null}
                      </div>
                    </TableCell>
                    <TableCell className="px-3 text-sm">{row.category}</TableCell>
                    <TableCell className="px-3 text-right tabular-nums">{formatCurrency(row.amount)}</TableCell>
                    <TableCell className="px-3 max-w-md truncate text-sm text-muted-foreground">
                      {row.description ?? "—"}
                    </TableCell>
                    <TableCell className="px-3 text-sm text-muted-foreground">
                      {creator?.display_name ?? "—"}
                    </TableCell>
                    <TableCell className="px-3 text-sm text-muted-foreground">
                      {formatDateTime(row.created_at)}
                    </TableCell>
                    <TableCell className="px-3">
                      <div className="flex items-center justify-end">
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
          {filtered.length > 0 ? (
            <tfoot>
              <TableRow className="bg-muted/40">
                <TableCell colSpan={3} className="px-3 text-sm font-medium">
                  Total ({filtered.length} {filtered.length === 1 ? "row" : "rows"})
                </TableCell>
                <TableCell className="px-3 text-right tabular-nums font-semibold">
                  {formatCurrency(totalAmount)}
                </TableCell>
                <TableCell colSpan={4} />
              </TableRow>
            </tfoot>
          ) : null}
        </Table>
      </div>

      <AlertDialog open={confirmDelete !== null} onOpenChange={(o) => { if (!o) setConfirmDelete(null) }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this cost?</AlertDialogTitle>
            <AlertDialogDescription>
              {confirmDelete ? (
                <>
                  Removes the {formatCurrency(confirmDelete.amount)} {confirmDelete.category} entry on{" "}
                  {formatDate(confirmDelete.cost_date)}. Direct costs are append-only otherwise — re-add if needed.
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
