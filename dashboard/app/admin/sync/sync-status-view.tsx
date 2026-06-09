"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { RefreshCw, Play } from "lucide-react"
import { toast } from "sonner"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { formatDateTime } from "@/lib/format"
import { triggerSync } from "./actions"

export type SyncRunRow = {
  entity_name: string
  last_synced_at: string | null
  last_status: string | null
  error_count: number | null
  total_records: number | null
}

export type SyncErrorRow = {
  id: number
  run_started_at: string
  entity_name: string
  dynamics_id: string | null
  error_message: string
  created_at: string
}

function StatusBadge({ status }: { status: string | null }) {
  if (!status) return <Badge variant="outline">never run</Badge>
  if (status === "success") return <Badge variant="secondary">success</Badge>
  if (status === "partial") return <Badge variant="outline">partial</Badge>
  if (status === "error") return <Badge variant="destructive">error</Badge>
  return <Badge variant="outline">{status}</Badge>
}

export function SyncStatusView({
  runs,
  errors,
}: {
  runs: SyncRunRow[]
  errors: SyncErrorRow[]
}) {
  const router = useRouter()
  const [pending, startTransition] = React.useTransition()

  function handleRun() {
    startTransition(async () => {
      const result = await triggerSync()
      if (result.ok) {
        const entities = result.data?.entities ?? []
        const total = entities.reduce((s, e) => s + (e.totalRecords ?? 0), 0)
        const failed = entities.filter((e) => e.status === "error").length
        if (failed > 0) {
          toast.warning(`Sync finished with ${failed} entity error(s)`, {
            description: `${total} records written. See the errors table below.`,
          })
        } else {
          toast.success("Sync complete", { description: `${total} records written.` })
        }
        router.refresh()
      } else {
        toast.error("Could not run sync", { description: result.error })
      }
    })
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          Each entity syncs incrementally on records modified since its last run.
          A failed entity does not block the others.
        </p>
        <Button onClick={handleRun} disabled={pending}>
          {pending ? (
            <>
              <RefreshCw className="size-4 animate-spin" /> Running…
            </>
          ) : (
            <>
              <Play className="size-4" /> Run sync now
            </>
          )}
        </Button>
      </div>

      {/* Per-entity status */}
      <div className="rounded-lg border border-border bg-card">
        <div className="border-b border-border px-4 py-2.5 text-sm font-medium">
          Entities
        </div>
        <Table>
          <TableHeader className="bg-card">
            <TableRow>
              <TableHead className="px-3">Entity</TableHead>
              <TableHead className="px-3">Last synced</TableHead>
              <TableHead className="px-3">Status</TableHead>
              <TableHead className="px-3 text-right">Records</TableHead>
              <TableHead className="px-3 text-right">Errors</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {runs.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="h-24 text-center text-sm text-muted-foreground">
                  No syncs have run yet.
                </TableCell>
              </TableRow>
            ) : (
              runs.map((r) => (
                <TableRow key={r.entity_name}>
                  <TableCell className="px-3 font-medium">{r.entity_name}</TableCell>
                  <TableCell className="px-3 text-sm text-muted-foreground tabular-nums">
                    {r.last_synced_at ? formatDateTime(r.last_synced_at) : "—"}
                  </TableCell>
                  <TableCell className="px-3">
                    <StatusBadge status={r.last_status} />
                  </TableCell>
                  <TableCell className="px-3 text-right tabular-nums">
                    {r.total_records ?? 0}
                  </TableCell>
                  <TableCell className="px-3 text-right tabular-nums">
                    {r.error_count ? (
                      <span className="text-destructive">{r.error_count}</span>
                    ) : (
                      0
                    )}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {/* Recent errors */}
      <div className="rounded-lg border border-border bg-card">
        <div className="border-b border-border px-4 py-2.5 text-sm font-medium">
          Recent errors{" "}
          <span className="text-muted-foreground font-normal">(50 most recent)</span>
        </div>
        <Table>
          <TableHeader className="bg-card">
            <TableRow>
              <TableHead className="px-3">When</TableHead>
              <TableHead className="px-3">Entity</TableHead>
              <TableHead className="px-3">Dynamics ID</TableHead>
              <TableHead className="px-3">Error</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {errors.length === 0 ? (
              <TableRow>
                <TableCell colSpan={4} className="h-24 text-center text-sm text-muted-foreground">
                  No errors logged. 🎉
                </TableCell>
              </TableRow>
            ) : (
              errors.map((e) => (
                <TableRow key={e.id}>
                  <TableCell className="px-3 text-sm text-muted-foreground tabular-nums whitespace-nowrap">
                    {formatDateTime(e.created_at)}
                  </TableCell>
                  <TableCell className="px-3 text-sm">{e.entity_name}</TableCell>
                  <TableCell className="px-3 text-xs font-mono text-muted-foreground">
                    {e.dynamics_id ?? "—"}
                  </TableCell>
                  <TableCell className="px-3 text-sm text-destructive max-w-md truncate" title={e.error_message}>
                    {e.error_message}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}
