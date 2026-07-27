"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { RefreshCw, Play, Trash2, Check, ChevronRight } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
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
import { formatDate, formatDateTime } from "@/lib/format"
import {
  triggerReconcile,
  deleteCandidate,
  dismissCandidate,
  deleteCandidates,
  dismissCandidates,
} from "./actions"

export type PendingCandidate = {
  id: number
  entity_name: string
  label: string | null
  pk_value: string
  first_detected_at: string
  last_seen_missing_at: string
}

export type DismissedCandidate = {
  id: number
  entity_name: string
  label: string | null
  pk_value: string
  resolved_at: string | null
  resolved_by: string | null
}

export type LastSweep = {
  started_at: string
  finished_at: string | null
  entities_checked: number | null
  newly_flagged: number | null
  reappeared: number | null
  skipped: number | null
} | null

type ConfirmState = {
  title: string
  body: string
  run: () => Promise<void>
} | null

function groupByEntity<T extends { entity_name: string }>(rows: T[]): [string, T[]][] {
  const map = new Map<string, T[]>()
  for (const r of rows) {
    const list = map.get(r.entity_name) ?? []
    list.push(r)
    map.set(r.entity_name, list)
  }
  return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]))
}

export function ReconciliationView({
  pending,
  dismissed,
  lastSweep,
}: {
  pending: PendingCandidate[]
  dismissed: DismissedCandidate[]
  lastSweep: LastSweep
}) {
  const router = useRouter()
  const [pendingRun, startRun] = React.useTransition()
  const [busy, startBusy] = React.useTransition()
  const [confirm, setConfirm] = React.useState<ConfirmState>(null)
  const [showDismissed, setShowDismissed] = React.useState(false)

  const groups = groupByEntity(pending)

  function handleSweep() {
    startRun(async () => {
      const result = await triggerReconcile()
      if (result.ok) {
        const entities = result.data?.entities ?? []
        const flagged = entities.reduce((n, e) => n + e.newlyFlagged, 0)
        const skips = entities.filter((e) => e.skipped).length
        if (skips > 0) {
          toast.warning(`Sweep finished — ${skips} entity(ies) skipped`, {
            description: `${flagged} newly flagged. Skipped entities were left untouched (see server logs).`,
          })
        } else {
          toast.success("Sweep complete", {
            description: flagged > 0 ? `${flagged} new candidate(s) flagged.` : "No new deletions found.",
          })
        }
        router.refresh()
      } else {
        toast.error("Could not run sweep", { description: result.error })
      }
    })
  }

  function runDelete(id: number, label: string) {
    setConfirm({
      title: "Delete this row from the database?",
      body: `“${label}” will be permanently removed from the Supabase mirror. This can be restored later by re-syncing the entity from Dynamics.`,
      run: async () => {
        const r = await deleteCandidate(id)
        if (r.ok) {
          toast.success("Row deleted")
          router.refresh()
        } else {
          toast.error("Could not delete", { description: r.error })
        }
      },
    })
  }

  function runDismiss(id: number) {
    startBusy(async () => {
      const r = await dismissCandidate(id)
      if (r.ok) {
        toast.success("Kept — moved to the reviewed list")
        router.refresh()
      } else {
        toast.error("Could not keep", { description: r.error })
      }
    })
  }

  function runDeleteAll(entity: string, ids: number[]) {
    setConfirm({
      title: `Delete all ${ids.length} ${entity} rows?`,
      body: `All ${ids.length} flagged ${entity} rows will be permanently removed from the Supabase mirror. Each can be restored later by re-syncing from Dynamics.`,
      run: async () => {
        const r = await deleteCandidates(ids)
        if (r.ok) {
          toast.success(`Deleted ${r.data?.deleted ?? 0} row(s)`)
          router.refresh()
        } else {
          toast.error("Could not delete", { description: r.error })
        }
      },
    })
  }

  function runDismissAll(ids: number[]) {
    startBusy(async () => {
      const r = await dismissCandidates(ids)
      if (r.ok) {
        toast.success(`Kept ${r.data?.dismissed ?? 0} row(s)`)
        router.refresh()
      } else {
        toast.error("Could not keep", { description: r.error })
      }
    })
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="text-sm text-muted-foreground">
          <p>
            Rows that exist locally but were not found in the latest full pull from Dynamics.
            Nothing is deleted automatically — review each one below.
          </p>
          <p className="mt-1 tabular-nums">
            {lastSweep ? (
              <>
                Last swept {formatDateTime(lastSweep.finished_at ?? lastSweep.started_at)}
                {lastSweep.skipped ? (
                  <span className="ml-2 text-amber-600">· {lastSweep.skipped} entity(ies) skipped</span>
                ) : null}
              </>
            ) : (
              "No sweep has run yet."
            )}
            <span className="ml-2">· {pending.length} pending</span>
          </p>
        </div>
        <Button onClick={handleSweep} disabled={pendingRun}>
          {pendingRun ? (
            <>
              <RefreshCw className="size-4 animate-spin" /> Sweeping…
            </>
          ) : (
            <>
              <Play className="size-4" /> Run sweep now
            </>
          )}
        </Button>
      </div>

      {/* Pending candidates, grouped by entity */}
      {groups.length === 0 ? (
        <div className="rounded-lg border border-border bg-card p-8 text-center text-sm text-muted-foreground">
          No pending deletions. 🎉
        </div>
      ) : (
        groups.map(([entity, rows]) => {
          const ids = rows.map((r) => r.id)
          return (
            <div key={entity} className="rounded-lg border border-border bg-card">
              <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
                <div className="text-sm font-medium">
                  {entity}{" "}
                  <span className="font-normal text-muted-foreground">({rows.length})</span>
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    size="sm"
                    variant="destructive"
                    disabled={busy}
                    onClick={() => runDeleteAll(entity, ids)}
                  >
                    <Trash2 className="size-3.5" /> Delete all
                  </Button>
                  <Button size="sm" variant="outline" disabled={busy} onClick={() => runDismissAll(ids)}>
                    <Check className="size-3.5" /> Keep all
                  </Button>
                </div>
              </div>
              <ul className="divide-y divide-border">
                {rows.map((r) => (
                  <li key={r.id} className="flex items-center justify-between gap-3 px-4 py-2.5">
                    <div className="min-w-0">
                      <div className="truncate text-sm">{r.label ?? "(no label)"}</div>
                      <div className="mt-0.5 flex items-center gap-2 text-xs text-muted-foreground">
                        <span className="font-mono">{r.pk_value}</span>
                        <span>· first detected {formatDate(r.first_detected_at)}</span>
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <Button
                        size="sm"
                        variant="destructive"
                        disabled={busy}
                        onClick={() => runDelete(r.id, r.label ?? r.pk_value)}
                      >
                        <Trash2 className="size-3.5" /> Delete from database
                      </Button>
                      <Button size="sm" variant="outline" disabled={busy} onClick={() => runDismiss(r.id)}>
                        <Check className="size-3.5" /> Keep
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )
        })
      )}

      {/* Previously kept (dismissed) — collapsed, auditable */}
      {dismissed.length > 0 ? (
        <div className="rounded-lg border border-border bg-card">
          <button
            type="button"
            onClick={() => setShowDismissed((v) => !v)}
            className="flex w-full items-center gap-2 px-4 py-2.5 text-left text-sm font-medium"
          >
            <ChevronRight className={`size-4 transition-transform ${showDismissed ? "rotate-90" : ""}`} />
            Previously kept
            <span className="font-normal text-muted-foreground">({dismissed.length})</span>
          </button>
          {showDismissed ? (
            <ul className="divide-y divide-border border-t border-border">
              {dismissed.map((r) => (
                <li key={r.id} className="flex items-center justify-between gap-3 px-4 py-2 text-sm">
                  <div className="min-w-0">
                    <div className="truncate">
                      <span className="text-muted-foreground">{r.entity_name}:</span> {r.label ?? "(no label)"}
                    </div>
                    <div className="mt-0.5 font-mono text-xs text-muted-foreground">{r.pk_value}</div>
                  </div>
                  <div className="shrink-0 text-right text-xs text-muted-foreground">
                    <div>{r.resolved_at ? formatDate(r.resolved_at) : "—"}</div>
                    {r.resolved_by ? <div className="truncate">{r.resolved_by}</div> : null}
                  </div>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}

      <AlertDialog open={confirm !== null} onOpenChange={(open) => (!open ? setConfirm(null) : null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{confirm?.title}</AlertDialogTitle>
            <AlertDialogDescription>{confirm?.body}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={busy}
              onClick={() => {
                const run = confirm?.run
                setConfirm(null)
                if (run) startBusy(run)
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
