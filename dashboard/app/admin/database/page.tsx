import type { Metadata } from "next"
import Link from "next/link"

import { PageShell } from "@/components/page-shell"
import { buttonVariants } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { getSupabaseServer } from "@/lib/supabase"
import { formatDateTime, formatRelative } from "@/lib/format"

export const dynamic = "force-dynamic"

export const metadata: Metadata = { title: "Database Health" }

// Mirror tables (Dynamics → Supabase). Names match sync_runs.entity_name, so we
// join the two on that key to attach each table's freshness watermark.
const MIRROR_TABLES = [
  "accounts",
  "users",
  "meetings",
  "touchpoints",
  "client_notes",
  "contracts",
  "tasks",
  "events",
  "ooo",
] as const

// A spread of important views — a 0 where you expect rows means a broken view.
const KEY_VIEWS = [
  "v_client_portfolio",
  "v_client_statistics",
  "v_scheduler_meetings",
  "v_feedback_pipeline",
  "v_live_outreach",
  "v_marketing_calendar",
  "v_contract_management",
  "v_productivity_detail_summary",
] as const

type SyncRun = { entity_name: string; last_synced_at: string | null; last_status: string | null }
type SyncError = {
  id: number
  entity_name: string
  error_message: string
  created_at: string
  dynamics_id: string | null
}

async function count(name: string): Promise<number | null> {
  try {
    const sb = getSupabaseServer()
    const { count, error } = await sb.from(name).select("*", { count: "exact", head: true })
    if (error) return null
    return count ?? 0
  } catch {
    return null
  }
}

async function loadTables() {
  try {
    const sb = getSupabaseServer()
    const { data, error } = await sb
      .from("sync_runs")
      .select("entity_name, last_synced_at, last_status")
    const runs = error ? [] : ((data ?? []) as SyncRun[])
    const byEntity = new Map(runs.map((r) => [r.entity_name, r]))
    const rows = await Promise.all(
      MIRROR_TABLES.map(async (name) => {
        const run = byEntity.get(name)
        return {
          name,
          rowCount: await count(name),
          lastSyncedAt: run?.last_synced_at ?? null,
          lastStatus: run?.last_status ?? null,
        }
      }),
    )
    return rows
  } catch {
    return null
  }
}

async function loadErrors(): Promise<SyncError[] | null> {
  try {
    const sb = getSupabaseServer()
    const { data, error } = await sb
      .from("sync_errors")
      .select("id, entity_name, error_message, created_at, dynamics_id")
      .order("created_at", { ascending: false })
      .limit(50)
    if (error) return null
    return (data ?? []) as SyncError[]
  } catch {
    return null
  }
}

async function loadViews() {
  const entries = await Promise.all(KEY_VIEWS.map(async (v) => ({ name: v, rowCount: await count(v) })))
  return entries
}

function StatusBadge({ status }: { status: string | null }) {
  if (!status) return <Badge variant="outline">never run</Badge>
  if (status === "success") return <Badge variant="secondary">success</Badge>
  if (status === "partial") return <Badge variant="outline">partial</Badge>
  if (status === "error") return <Badge variant="destructive">error</Badge>
  return <Badge variant="outline">{status}</Badge>
}

function SectionUnavailable({ what }: { what: string }) {
  return (
    <div className="rounded-lg border border-border bg-muted/20 p-4 text-sm text-muted-foreground">
      {what} is unavailable right now.
    </div>
  )
}

export default async function DatabaseHealthPage() {
  const [tables, errors, views] = await Promise.all([loadTables(), loadErrors(), loadViews()])

  return (
    <PageShell
      title="Database Health"
      description="Mirror-table row counts, sync watermarks, and recent errors"
      actions={
        <Link href="/admin" className={buttonVariants({ variant: "outline", size: "sm" })}>
          ← Admin
        </Link>
      }
    >
      <div className="space-y-6">
        {/* Mirror tables */}
        <div className="rounded-lg border border-border bg-card">
          <div className="border-b border-border px-4 py-2.5 text-sm font-medium">Mirror tables</div>
          {!tables ? (
            <div className="p-4">
              <SectionUnavailable what="Table health" />
            </div>
          ) : (
            <Table>
              <TableHeader className="bg-card">
                <TableRow>
                  <TableHead className="px-3">Table</TableHead>
                  <TableHead className="px-3 text-right">Rows</TableHead>
                  <TableHead className="px-3">Last synced</TableHead>
                  <TableHead className="px-3">Age</TableHead>
                  <TableHead className="px-3">Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {tables.map((t) => (
                  <TableRow key={t.name}>
                    <TableCell className="px-3 font-medium">{t.name}</TableCell>
                    <TableCell className="px-3 text-right tabular-nums">
                      {t.rowCount == null ? (
                        <span className="text-muted-foreground">unavailable</span>
                      ) : (
                        t.rowCount.toLocaleString()
                      )}
                    </TableCell>
                    <TableCell className="px-3 text-sm text-muted-foreground tabular-nums whitespace-nowrap">
                      {t.lastSyncedAt ? formatDateTime(t.lastSyncedAt) : "—"}
                    </TableCell>
                    <TableCell className="px-3 text-sm text-muted-foreground tabular-nums whitespace-nowrap">
                      {t.lastSyncedAt ? formatRelative(t.lastSyncedAt) : "—"}
                    </TableCell>
                    <TableCell className="px-3">
                      <StatusBadge status={t.lastStatus} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </div>

        {/* Key views */}
        <div className="rounded-lg border border-border bg-card">
          <div className="border-b border-border px-4 py-2.5 text-sm font-medium">
            Key views{" "}
            <span className="font-normal text-muted-foreground">(a 0 where rows are expected = a broken view)</span>
          </div>
          <Table>
            <TableHeader className="bg-card">
              <TableRow>
                <TableHead className="px-3">View</TableHead>
                <TableHead className="px-3 text-right">Rows</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {views.map((v) => (
                <TableRow key={v.name}>
                  <TableCell className="px-3 font-mono text-sm">{v.name}</TableCell>
                  <TableCell className="px-3 text-right tabular-nums">
                    {v.rowCount == null ? (
                      <span className="text-muted-foreground">unavailable</span>
                    ) : v.rowCount === 0 ? (
                      <span className="text-[#B7791F]">0</span>
                    ) : (
                      v.rowCount.toLocaleString()
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>

        {/* Recent errors */}
        <div className="rounded-lg border border-border bg-card">
          <div className="border-b border-border px-4 py-2.5 text-sm font-medium">
            Recent sync errors{" "}
            <span className="font-normal text-muted-foreground">(50 most recent)</span>
          </div>
          {!errors ? (
            <div className="p-4">
              <SectionUnavailable what="The error log" />
            </div>
          ) : (
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
                      <TableCell
                        className="px-3 text-sm text-destructive max-w-md truncate"
                        title={e.error_message}
                      >
                        {e.error_message}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          )}
        </div>
      </div>
    </PageShell>
  )
}
