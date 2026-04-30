"use client"

import * as React from "react"
import { Pencil, Plus, Trash2 } from "lucide-react"
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
import type { OverheadPeriodRow } from "@/lib/types"
import { OverheadPeriodDialog } from "./overhead-period-dialog"
import { deleteOverheadPeriod } from "./actions"

export function OverheadPeriodsTable({
  rows,
  overrideCountsByPeriodId,
}: {
  rows: OverheadPeriodRow[]
  /** Map period_id → number of overhead_overrides referencing that quarter. */
  overrideCountsByPeriodId: Record<number, number>
}) {
  const [editing, setEditing] = React.useState<OverheadPeriodRow | null>(null)
  const [adding, setAdding] = React.useState(false)
  const [confirmDelete, setConfirmDelete] = React.useState<OverheadPeriodRow | null>(null)
  const [pending, startTransition] = React.useTransition()

  function handleDelete(row: OverheadPeriodRow) {
    startTransition(async () => {
      const result = await deleteOverheadPeriod(row.id)
      if (result.ok) {
        toast.success("Period deleted")
        setConfirmDelete(null)
      } else {
        toast.error("Could not delete period", { description: result.error })
      }
    })
  }

  return (
    <>
      <div className="mb-3 flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          {rows.length.toLocaleString()} {rows.length === 1 ? "quarter" : "quarters"} configured
        </p>
        <Button onClick={() => setAdding(true)}>
          <Plus className="size-4" /> Add period
        </Button>
      </div>

      <div className="rounded-lg border border-border bg-card">
        <Table>
          <TableHeader className="bg-card">
            <TableRow>
              <TableHead className="px-3">Period</TableHead>
              <TableHead className="px-3 text-right">Total overhead</TableHead>
              <TableHead className="px-3 text-right">Overrides</TableHead>
              <TableHead className="px-3">Notes</TableHead>
              <TableHead className="px-3">Updated</TableHead>
              <TableHead className="px-3 text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="h-32 text-center text-sm text-muted-foreground">
                  No quarterly overhead periods yet. Click <strong>Add period</strong> to start.
                </TableCell>
              </TableRow>
            ) : (
              rows.map((row) => (
                <TableRow key={row.id}>
                  <TableCell className="px-3 font-medium">{formatQuarter(row.period_year, row.period_quarter)}</TableCell>
                  <TableCell className="px-3 text-right tabular-nums">{formatCurrency(row.total_overhead_amount)}</TableCell>
                  <TableCell className="px-3 text-right tabular-nums text-muted-foreground">
                    {overrideCountsByPeriodId[row.id] ?? 0}
                  </TableCell>
                  <TableCell className="px-3 max-w-md truncate text-sm text-muted-foreground">
                    {row.notes ?? "—"}
                  </TableCell>
                  <TableCell className="px-3 text-sm text-muted-foreground">
                    {formatDateTime(row.updated_at)}
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
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <OverheadPeriodDialog
        open={adding}
        onOpenChange={setAdding}
        initial={null}
        hasOverridesForRow={false}
      />
      <OverheadPeriodDialog
        open={editing !== null}
        onOpenChange={(o) => { if (!o) setEditing(null) }}
        initial={editing}
        hasOverridesForRow={editing ? (overrideCountsByPeriodId[editing.id] ?? 0) > 0 : false}
      />

      <AlertDialog open={confirmDelete !== null} onOpenChange={(o) => { if (!o) setConfirmDelete(null) }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this period?</AlertDialogTitle>
            <AlertDialogDescription>
              {confirmDelete ? (
                <>
                  Removes the overhead pot for{" "}
                  <strong>{formatQuarter(confirmDelete.period_year, confirmDelete.period_quarter)}</strong>.{" "}
                  Overhead allocation for that quarter will fall back to $0 until you re-add it.
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
