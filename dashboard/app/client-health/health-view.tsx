"use client"

/**
 * Clients → Client Health table: Client | Note | Rating, A→Z, with a rating
 * filter, Excel export, the Refresh-all driver, a per-row Regenerate, and the
 * super-user override dialog. Writes go through ./actions.ts (overrides) and
 * /api/client-health/refresh (AI ratings); the server gates both.
 */

import * as React from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { format } from "date-fns"
import { AlertTriangle, Download, Loader2, Pencil, RefreshCw, Search } from "lucide-react"
import { toast } from "sonner"

import { ListTitleCard } from "@/components/page-masthead"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
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
import { CARD_CLASS, STATUS_PILL_LIGHT } from "@/lib/design"
import {
  HEALTH_RATINGS,
  HEALTH_RATING_LABEL,
  isHealthRating,
  type HealthRating,
} from "@/lib/client-health-prompt"
import { exportClientHealth } from "@/lib/client-health-excel"
import { revertHealthOverride, saveHealthOverride } from "./actions"

export type HealthRow = {
  account_id: string
  client_name: string
  ai_rating: string | null
  ai_note: string | null
  ai_generated_at: string | null
  ai_error: string | null
  ai_error_at: string | null
  override_rating: string | null
  override_note: string | null
  overridden_at: string | null
  overridden_by_name: string | null
}

const RATING_STYLE: Record<HealthRating, { bg: string; text: string }> = {
  "1": STATUS_PILL_LIGHT.positive,
  "2": STATUS_PILL_LIGHT.watch,
  "3": STATUS_PILL_LIGHT.atRisk,
  "Management / IR Change": STATUS_PILL_LIGHT.new,
}

const effRating = (r: HealthRow) => r.override_rating ?? r.ai_rating
const effNote = (r: HealthRow) => r.override_note ?? r.ai_note
const isOverridden = (r: HealthRow) => r.override_rating !== null || r.override_note !== null

const fmt = (iso: string | null) => (iso ? format(new Date(iso), "MMM d, yyyy h:mm a") : null)

function RatingBadge({ rating }: { rating: string | null }) {
  if (!rating || !isHealthRating(rating)) {
    return <span className="text-[12px] text-muted-foreground">Not rated</span>
  }
  const s = RATING_STYLE[rating]
  return (
    <span
      className="inline-flex items-center whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium"
      style={{ backgroundColor: s.bg, color: s.text }}
    >
      {HEALTH_RATING_LABEL[rating]}
    </span>
  )
}

const POLL_MS = 3000
type Phase = "idle" | "running" | "done" | "error"

/** Shape of GET /api/client-health/refresh?action=status. */
type RunStatus = {
  run: { run_id: string; status: "running" | "finished"; total: number; alive: boolean } | null
  done: number
  failed: number
}

export function HealthView({
  rows,
  lastUpdated,
  frameworkReady,
  tableError,
  patchPath,
}: {
  rows: HealthRow[]
  lastUpdated: string | null
  frameworkReady: boolean
  tableError: string | null
  patchPath: string
}) {
  const router = useRouter()
  const [query, setQuery] = React.useState("")
  const [ratingFilter, setRatingFilter] = React.useState<string>("all")
  const [editing, setEditing] = React.useState<HealthRow | null>(null)
  const [regenBusy, setRegenBusy] = React.useState<string | null>(null)

  // ---- Refresh-all: the SERVER runs the batches; this only starts + polls ----
  const [confirmOpen, setConfirmOpen] = React.useState(false)
  const [phase, setPhase] = React.useState<Phase>("idle")
  const [progress, setProgress] = React.useState({ done: 0, failed: 0, total: 0 })
  const [runError, setRunError] = React.useState<string | null>(null)
  const [stale, setStale] = React.useState(false)
  const pollRef = React.useRef<ReturnType<typeof setInterval> | null>(null)

  const stopPolling = React.useCallback(() => {
    if (pollRef.current) clearInterval(pollRef.current)
    pollRef.current = null
  }, [])

  // The interval calls whatever tickRef points at (the latest `poll`), so `poll`
  // can start polling without referring to itself.
  const tickRef = React.useRef<() => void>(() => {})
  const startPolling = React.useCallback(() => {
    if (pollRef.current) clearInterval(pollRef.current)
    pollRef.current = setInterval(() => tickRef.current(), POLL_MS)
  }, [])

  const poll = React.useCallback(async () => {
    try {
      const res = await fetch("/api/client-health/refresh?action=status", { cache: "no-store" })
      if (!res.ok) return
      const s = (await res.json()) as RunStatus
      if (!s.run) return
      setProgress({ done: s.done, failed: s.failed, total: s.run.total })
      if (s.run.status === "running") {
        setStale(!s.run.alive)
        setPhase(s.run.alive ? "running" : "error")
        if (!s.run.alive) {
          setRunError("The last run stopped part-way. Press Refresh to resume it — completed clients are kept.")
          stopPolling()
        } else if (!pollRef.current) {
          startPolling()
        }
      } else if (pollRef.current) {
        // It was running while we watched and has now finished.
        stopPolling()
        setPhase("done")
        router.refresh()
      }
    } catch {
      // Transient network blip — the next tick retries.
    }
  }, [router, stopPolling, startPolling])

  React.useEffect(() => {
    tickRef.current = () => void poll()
  }, [poll])

  // Pick up a run already in progress (e.g. the Monday cron, or another tab).
  React.useEffect(() => {
    const first = setTimeout(() => void poll(), 0)
    return () => {
      clearTimeout(first)
      stopPolling()
    }
  }, [poll, stopPolling])

  const shown = rows.filter((r) => {
    const q = query.trim().toLowerCase()
    if (q && !r.client_name.toLowerCase().includes(q)) return false
    if (ratingFilter === "all") return true
    const er = effRating(r)
    if (ratingFilter === "none") return !er
    if (ratingFilter === "overridden") return isOverridden(r)
    return er === ratingFilter
  })

  async function refreshAll() {
    setRunError(null)
    setStale(false)
    try {
      const res = await fetch("/api/client-health/refresh?action=start", { method: "POST", cache: "no-store" })
      const body = (await res.json().catch(() => ({}))) as { error?: string; status?: string }
      if (!res.ok) throw new Error(body.error ?? `The refresh route returned ${res.status}.`)
      if (body.status === "already_running") toast.info("A refresh is already running — showing its progress.")
      setPhase("running")
      startPolling()
      void poll()
    } catch (err) {
      setRunError(err instanceof Error ? err.message : String(err))
      setPhase("error")
    }
  }

  async function regenerateOne(r: HealthRow) {
    setRegenBusy(r.account_id)
    try {
      const res = await fetch(`/api/client-health/refresh?account_id=${r.account_id}`, {
        method: "POST",
        cache: "no-store",
      })
      const body = (await res.json().catch(() => ({}))) as { error?: string }
      if (res.status === 200) toast.success(`${r.client_name} regenerated`)
      else toast.error("Could not regenerate", { description: body.error })
    } finally {
      setRegenBusy(null)
      router.refresh()
    }
  }

  const running = phase === "running"
  const disabled = !frameworkReady || !!tableError

  return (
    <>
      <div className="mb-4">
        <ListTitleCard
          eyebrow="Clients"
          title="Client Health"
          subtitle={
            <>
              Retention-risk rating for every active client, generated by AI from structured data and client notes.
              Refreshed weekly (Monday morning) or on demand. Super-user only.
              <span className="ml-2 font-medium">Last updated: {fmt(lastUpdated) ?? "never"}</span>
            </>
          }
          rightSlot={
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() =>
                  void exportClientHealth(
                    shown.map((r) => ({
                      client_name: r.client_name,
                      note: effNote(r),
                      rating: effRating(r),
                      overridden: isOverridden(r),
                      ai_generated_at: r.ai_generated_at,
                    })),
                  )
                }
                className="flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm font-medium hover:bg-muted"
              >
                <Download className="size-3.5" /> Excel
              </button>
              <button
                type="button"
                onClick={() => setConfirmOpen(true)}
                disabled={running || disabled}
                className="flex items-center gap-1.5 rounded-md bg-[#1E2858] px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-[#0355A7] disabled:cursor-not-allowed disabled:opacity-60"
              >
                {running ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />}
                {running ? "Refreshing…" : stale ? "Resume" : "Refresh"}
              </button>
            </div>
          }
        />
      </div>

      {tableError && (
        <div className="mb-3 rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-[13px]">
          <div className="font-medium text-destructive">The client_health_assessments table can&apos;t be read</div>
          <div className="mt-1 text-muted-foreground">
            {tableError} — if it doesn&apos;t exist yet, run <code>{patchPath}</code> in Supabase.
          </div>
        </div>
      )}
      {!frameworkReady && (
        <div className="mb-3 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-[13px] text-amber-900">
          The classification framework hasn&apos;t been added yet (<code>lib/client-health-prompt.ts</code>), so
          ratings can&apos;t be generated. Overrides still work.
        </div>
      )}

      {phase !== "idle" && (
        <div className="mb-3 flex items-center gap-2 text-[13px]" aria-live="polite">
          {running ? (
            <>
              <Loader2 className="size-3.5 animate-spin text-[#0355A7]" />
              <span className="text-[#0355A7]">
                Updating {progress.done + progress.failed}/{progress.total || "?"}…
                {progress.failed ? ` (${progress.failed} failed)` : ""} Runs on the server — you can leave this page.
              </span>
            </>
          ) : phase === "done" ? (
            <span className="text-[#0E7C56]">
              Done — {progress.done} rated{progress.failed ? `, ${progress.failed} failed (run again to retry)` : ""}.
            </span>
          ) : (
            <span className="flex items-center gap-1.5 text-[#C53030]">
              <AlertTriangle className="size-3.5" /> {runError}
            </span>
          )}
        </div>
      )}

      <div className="mb-3 flex flex-wrap items-center gap-3">
        <div className="relative min-w-[220px] max-w-xs flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search clients" className="h-9 pl-8" />
        </div>
        <select
          aria-label="Filter by rating"
          value={ratingFilter}
          onChange={(e) => setRatingFilter(e.target.value)}
          className="h-9 rounded-md border border-input bg-background px-2 text-sm"
        >
          <option value="all">All ratings</option>
          {HEALTH_RATINGS.map((r) => (
            <option key={r} value={r}>
              {HEALTH_RATING_LABEL[r]}
            </option>
          ))}
          <option value="none">Not rated</option>
          <option value="overridden">Overridden</option>
        </select>
        <span className="text-sm text-muted-foreground">
          {shown.length} of {rows.length} active clients
        </span>
      </div>

      <div className={`${CARD_CLASS} overflow-hidden`}>
        <table className="w-full text-[13px]">
          <thead className="border-b bg-muted/40 text-left text-[12px] text-muted-foreground">
            <tr>
              <th className="w-[220px] px-4 py-2 font-medium">Client</th>
              <th className="px-4 py-2 font-medium">Note</th>
              <th className="w-[200px] px-4 py-2 font-medium">Rating</th>
              <th className="w-[80px] px-2 py-2" />
            </tr>
          </thead>
          <tbody className="divide-y">
            {shown.map((r) => {
              const note = effNote(r)
              return (
                <tr key={r.account_id} className="align-top hover:bg-muted/30">
                  <td className="px-4 py-2.5 font-medium">
                    <Link href={`/client-detail?account_id=${r.account_id}`} className="hover:underline">
                      {r.client_name}
                    </Link>
                  </td>
                  <td className="px-4 py-2.5">
                    {note ? <span>{note}</span> : <span className="text-muted-foreground">—</span>}
                    {r.ai_error && (
                      <div className="mt-1 flex items-center gap-1 text-[11px] text-[#C53030]" title={r.ai_error}>
                        <AlertTriangle className="size-3" /> Last generation failed {fmt(r.ai_error_at)}
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-2.5">
                    <div className="flex flex-col items-start gap-1">
                      <RatingBadge rating={effRating(r)} />
                      {isOverridden(r) && (
                        <span
                          className="rounded border border-[#2D4A8A]/30 px-1.5 text-[10.5px] font-medium text-[#2D4A8A]"
                          title={`Overridden${r.overridden_by_name ? ` by ${r.overridden_by_name}` : ""}${r.overridden_at ? ` on ${fmt(r.overridden_at)}` : ""}`}
                        >
                          Overridden
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-2 py-2.5">
                    <div className="flex items-center justify-end gap-1">
                      <button
                        type="button"
                        aria-label={`Edit ${r.client_name}`}
                        title="Edit / override"
                        disabled={!!tableError}
                        onClick={() => setEditing(r)}
                        className="rounded p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-40"
                      >
                        <Pencil className="size-3.5" />
                      </button>
                      <button
                        type="button"
                        aria-label={`Regenerate ${r.client_name}`}
                        title="Regenerate this client"
                        disabled={disabled || running || regenBusy !== null}
                        onClick={() => void regenerateOne(r)}
                        className="rounded p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-40"
                      >
                        {regenBusy === r.account_id ? (
                          <Loader2 className="size-3.5 animate-spin" />
                        ) : (
                          <RefreshCw className="size-3.5" />
                        )}
                      </button>
                    </div>
                  </td>
                </tr>
              )
            })}
            {shown.length === 0 && (
              <tr>
                <td colSpan={4} className="px-4 py-8 text-center text-sm text-muted-foreground">
                  No clients match.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {stale ? "Resume the stopped run?" : `Re-rate all ${rows.length} active clients?`}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {stale
                ? "Picks up where the last run stopped — clients it already rated are not redone."
                : "This calls the AI once per client, in throttled batches on the server, and takes several minutes. It costs API money and replaces every AI rating and note. Overrides are kept. You can leave the page while it runs."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => void refreshAll()}>Re-rate all</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {editing && (
        <OverrideDialog
          row={editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null)
            router.refresh()
          }}
        />
      )}
    </>
  )
}

function OverrideDialog({
  row,
  onClose,
  onSaved,
}: {
  row: HealthRow
  onClose: () => void
  onSaved: () => void
}) {
  const [rating, setRating] = React.useState<string>(row.override_rating ?? "")
  const [note, setNote] = React.useState<string>(row.override_note ?? row.ai_note ?? "")
  const [pending, startTransition] = React.useTransition()
  const overridden = isOverridden(row)

  function save() {
    // A note identical to the AI note is not an override of the note.
    const noteOverride = note.trim() && note.trim() !== (row.ai_note ?? "").trim() ? note : null
    startTransition(async () => {
      const r = await saveHealthOverride(row.account_id, rating || null, noteOverride)
      if (!r.ok) {
        toast.error("Could not save", { description: r.error })
        return
      }
      toast.success("Override saved")
      onSaved()
    })
  }

  function revert() {
    startTransition(async () => {
      const r = await revertHealthOverride(row.account_id)
      if (!r.ok) {
        toast.error("Could not revert", { description: r.error })
        return
      }
      toast.success("Reverted to AI")
      onSaved()
    })
  }

  return (
    <Dialog open onOpenChange={(o) => !o && !pending && onClose()}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{row.client_name}</DialogTitle>
          <DialogDescription>
            Override the AI rating and/or note. Overrides are kept when ratings are regenerated.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 text-[13px]">
          <div className="rounded-md bg-muted/40 p-3">
            <div className="mb-1 flex items-center gap-2 text-[11px] font-medium uppercase text-muted-foreground">
              AI assessment <RatingBadge rating={row.ai_rating} />
            </div>
            <div>{row.ai_note ?? <span className="text-muted-foreground">No AI note yet.</span>}</div>
            {row.ai_generated_at && (
              <div className="mt-1 text-[11px] text-muted-foreground">Generated {fmt(row.ai_generated_at)}</div>
            )}
          </div>

          <label className="block">
            <span className="mb-1 block font-medium">Rating</span>
            <select
              value={rating}
              onChange={(e) => setRating(e.target.value)}
              className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
            >
              <option value="">Keep AI rating</option>
              {HEALTH_RATINGS.map((r) => (
                <option key={r} value={r}>
                  {HEALTH_RATING_LABEL[r]}
                </option>
              ))}
            </select>
          </label>

          <label className="block">
            <span className="mb-1 block font-medium">Note</span>
            <Textarea value={note} onChange={(e) => setNote(e.target.value)} rows={4} />
          </label>
        </div>

        <DialogFooter>
          {overridden && (
            <button
              type="button"
              disabled={pending}
              onClick={revert}
              className="mr-auto rounded-md border px-3 py-1.5 text-sm font-medium hover:bg-muted disabled:opacity-60"
            >
              Revert to AI
            </button>
          )}
          <button
            type="button"
            disabled={pending}
            onClick={onClose}
            className="rounded-md border px-3 py-1.5 text-sm font-medium hover:bg-muted disabled:opacity-60"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={pending}
            onClick={save}
            className="flex items-center gap-1.5 rounded-md bg-[#1E2858] px-3 py-1.5 text-sm font-medium text-white hover:bg-[#0355A7] disabled:opacity-60"
          >
            {pending && <Loader2 className="size-3.5 animate-spin" />} Save override
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
