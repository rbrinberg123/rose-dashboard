"use client"

import * as React from "react"
import { Trash2 } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
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
import { formatCurrency, formatDateTime, formatQuarter } from "@/lib/format"
import type { RevenueOverrideRow, AccountOption } from "@/lib/types"
import { cn } from "@/lib/utils"
import { deleteRevenueOverride } from "./actions"

export function RevenueOverridesTable({
  rows,
  accounts,
}: {
  rows: RevenueOverrideRow[]
  accounts: AccountOption[]
}) {
  const accountById = React.useMemo(() => {
    const m = new Map<string, AccountOption>()
    for (const a of accounts) m.set(a.account_id, a)
    return m
  }, [accounts])

  const [confirmDelete, setConfirmDelete] = React.useState<RevenueOverrideRow | null>(null)
  const [pending, startTransition] = React.useTransition()

  function handleDelete(row: RevenueOverrideRow) {
    startTransition(async () => {
      const result = await deleteRevenueOverride(row.id)
      if (result.ok) {
        toast.success("Revenue override deleted")
        setConfirmDelete(null)
      } else {
        toast.error("Could not delete revenue override", { description: result.error })
      }
    })
  }

  return (
    <>
      <p className="mb-3 text-sm text-muted-foreground">
        {rows.length.toLocaleString()} {rows.length === 1 ? "override" : "overrides"} on file
      </p>

      <div className="rounded-lg border border-border bg-card">
        <Table>
          <TableHeader className="bg-card">
            <TableRow>
              <TableHead className="px-3">Period</TableHead>
              <TableHead className="px-3">Client</TableHead>
              <TableHead className="px-3 text-right">Adjustment</TableHead>
              <TableHead className="px-3">Reason</TableHead>
              <TableHead className="px-3">Created</TableHead>
              <TableHead className="px-3 text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="h-32 text-center text-sm text-muted-foreground">
                  No revenue overrides yet.
                </TableCell>
              </TableRow>
            ) : (
              rows.map((row) => {
                const account = accountById.get(row.client_account_id)
                const negative = row.adjustment_amount < 0
                return (
                  <TableRow key={row.id}>
                    <TableCell className="px-3 font-medium">
                      {formatQuarter(row.period_year, row.period_quarter)}
                    </TableCell>
                    <TableCell className="px-3">
                      {account ? (
                        <div className="min-w-0">
                          <div className="truncate font-medium">{account.name}</div>
                          {account.ticker_symbol ? (
                            <div className="truncate text-xs text-muted-foreground">{account.ticker_symbol}</div>
                          ) : null}
                        </div>
                      ) : (
                        <span className="text-muted-foreground">{row.client_account_id}</span>
                      )}
                    </TableCell>
                    <TableCell
                      className={cn(
                        "px-3 text-right tabular-nums",
                        negative ? "text-rose-700 dark:text-rose-300" : "text-emerald-700 dark:text-emerald-300",
                      )}
                    >
                      {negative ? "" : "+"}
                      {formatCurrency(row.adjustment_amount)}
                    </TableCell>
                    <TableCell className="px-3 max-w-md truncate text-sm">{row.reason}</TableCell>
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
        </Table>
      </div>

      <AlertDialog open={confirmDelete !== null} onOpenChange={(o) => { if (!o) setConfirmDelete(null) }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this override?</AlertDialogTitle>
            <AlertDialogDescription>
              {confirmDelete ? (
                <>
                  Removes a {formatCurrency(confirmDelete.adjustment_amount)} adjustment for{" "}
                  <strong>{formatQuarter(confirmDelete.period_year, confirmDelete.period_quarter)}</strong>.{" "}
                  This is the only way to "edit" an override — re-add with the corrected values after.
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
