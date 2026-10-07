"use client"

/**
 * Clients → Client Health table: Client | Note | Rating, A→Z, with a rating
 * filter, Excel export, the Refresh-all driver, a per-row Regenerate, and the
 * super-user override dialog, plus the "Needs review" count / filter and the
 * per-row Keep / Update / Revert resolution of a review flag, and the default
 * "Firm order" (fixed category sections + a shared drag-to-reorder rank). Writes go through ./actions.ts (overrides) and
 * /api/client-health/refresh (AI ratings); the server gates both.
 */

import * as React from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { format } from "date-fns"
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  ChevronDown,
  ChevronUp,
  Download,
  GripVertical,
  ListOrdered,
  Loader2,
  Lock,
  Pencil,
  RefreshCw,
  Search,
} from "lucide-react"
import { toast } from "sonner"

import { ListTitleCard } from "@/components/page-masthead"
import { SortHeader } from "@/components/sort-header"
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
  ratingSeverity,
  type HealthRating,
} from "@/lib/client-health-prompt"
import { exportClientHealth } from "@/lib/client-health-excel"
import type { OverrideMode, ReviewReason } from "@/lib/client-health-review"
import {
  categoryOf,
  compareFirmOrder,
  FIRM_CATEGORY_LABEL,
  FIRM_CATEGORY_ORDER,
  isFirmCategory,
  moveWithin,
  type FirmCategory,
} from "@/lib/client-health-order"
import { keepHealthOverride, reorderHealthCategory, revertHealthOverride, saveHealthOverride } from "./actions"

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
  override_mode: OverrideMode
  review_suggested: boolean
  review_reason: ReviewReason | null
  review_flagged_at: string | null
  override_reviewed_at: string | null
  /** New notes / contract changes since the review baseline (flagged rows only). */
  evidence: { notes: number; contracts: number } | null
  /** Shared firm-wide position within the category; null = not yet placed. */
  manual_rank: number | null
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
/** An open review flag that should be shown (pinned overrides are never flagged). */
const needsReview = (r: HealthRow) => r.review_suggested && isOverridden(r) && r.override_mode !== "pin"
const isPinned = (r: HealthRow) => isOverridden(r) && r.override_mode === "pin"

/** "up" = the AI now reads MORE risk than the override (most urgent). */
function divergenceDirection(r: HealthRow): "up" | "down" | null {
  const a = ratingSeverity(r.ai_rating)
  const o = ratingSeverity(r.override_rating)
  if (a === null || o === null || a === o) return null
  return a > o ? "up" : "down"
}

/** Review priority (lower first): AI disagrees toward more risk → AI disagrees → new activity. */
function reviewPriority(r: HealthRow): number {
  if (r.review_reason === "divergence") return divergenceDirection(r) === "up" ? 0 : 1
  return 2
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

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
type SortKey = "rating" | "client" | "note"
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
  canReorder,
}: {
  rows: HealthRow[]
  lastUpdated: string | null
  frameworkReady: boolean
  tableError: string | null
  patchPath: string
  /** Super-user AND not in "View as" — may drag the firm order (server re-checks). */
  canReorder: boolean
}) {
  const router = useRouter()
  const [query, setQuery] = React.useState("")
  const [ratingFilter, setRatingFilter] = React.useState<string>("all")
  // null = "Firm order" (the default): fixed category order, then the shared
  // manual rank. A column sort is a temporary view on top of it.
  const [sort, setSort] = React.useState<{ key: SortKey; dir: "asc" | "desc" } | null>(null)

  // ---- Firm order: optimistic ranks + drag state ----
  // Optimistic ranks apply only while `basis` is still the rows they were made
  // against; the router.refresh() after a save brings new rows and drops them.
  const [localRanks, setLocalRanks] = React.useState<{ basis: HealthRow[]; ranks: Map<string, number> } | null>(null)
  const [armed, setArmed] = React.useState<string | null>(null)
  const [dragId, setDragId] = React.useState<string | null>(null)
  const [overId, setOverId] = React.useState<string | null>(null)
  const [reorderBusy, setReorderBusy] = React.useState(false)
  const rankOf = (r: HealthRow) =>
    localRanks && localRanks.basis === rows ? (localRanks.ranks.get(r.account_id) ?? r.manual_rank) : r.manual_rank
  const firmCmp = (a: HealthRow, b: HealthRow) =>
    compareFirmOrder(
      { effectiveRating: effRating(a), manualRank: rankOf(a), clientName: a.client_name },
      { effectiveRating: effRating(b), manualRank: rankOf(b), clientName: b.client_name },
    )
  const [editing, setEditing] = React.useState<HealthRow | null>(null)
  const [regenBusy, setRegenBusy] = React.useState<string | null>(null)
  const [resolveBusy, setResolveBusy] = React.useState<string | null>(null)

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

  const reviewCount = rows.filter(needsReview).length

  const shown = rows.filter((r) => {
    const q = query.trim().toLowerCase()
    if (q && !r.client_name.toLowerCase().includes(q)) return false
    if (ratingFilter === "all") return true
    if (ratingFilter === "review") return needsReview(r)
    const er = effRating(r)
    if (ratingFilter === "none") return !er
    if (ratingFilter === "overridden") return isOverridden(r)
    return er === ratingFilter
  })

  // Firm order (sort === null): category High risk → Monitor → Mgmt / IR
  // Change → Healthy, then manual rank (unplaced last), then name
  // (lib/client-health-order.ts). A column sort uses the EFFECTIVE values;
  // Rating sorts by the same risk order, "desc" = most risk first. Empty values
  // (unrated, no note) always sort last, in either direction. Ties fall back to
  // client name.
  const byName = (a: HealthRow, b: HealthRow) => a.client_name.localeCompare(b.client_name)
  shown.sort((a, b) => {
    // In the Needs-review view, the louder "AI now disagrees" flags come first.
    if (ratingFilter === "review") {
      const pa = reviewPriority(a)
      const pb = reviewPriority(b)
      if (pa !== pb) return pa - pb
    }
    if (sort === null) return firmCmp(a, b)
    const sign = sort.dir === "asc" ? 1 : -1
    if (sort.key === "client") return sign * byName(a, b)
    if (sort.key === "note") {
      const na = effNote(a)
      const nb = effNote(b)
      if (!na || !nb) return na ? -1 : nb ? 1 : byName(a, b)
      return sign * na.localeCompare(nb) || byName(a, b)
    }
    const sa = ratingSeverity(effRating(a))
    const sb = ratingSeverity(effRating(b))
    if (sa === null || sb === null) return sa !== null ? -1 : sb !== null ? 1 : byName(a, b)
    return sign * (sa - sb) || byName(a, b)
  })

  function toggleSort(key: SortKey) {
    setSort((s) =>
      s?.key === key
        ? { key, dir: s.dir === "asc" ? "desc" : "asc" }
        : // Rating starts most-risk-first; text columns start A→Z.
          { key, dir: key === "rating" ? "desc" : "asc" },
    )
  }
  const sortedAs = (key: SortKey) => (sort?.key === key ? sort.dir : false)

  // Sections (one per category, fixed order) only in Firm order; the
  // Needs-review view keeps its own priority order as a flat list.
  const grouped = sort === null && ratingFilter !== "review"
  // Dragging needs every member of a category on screen: Firm order, no search,
  // and no filter other than a single rating (which shows a whole category).
  const dragEnabled =
    canReorder &&
    sort === null &&
    !query.trim() &&
    (ratingFilter === "all" || isFirmCategory(ratingFilter)) &&
    !tableError
  const categoryIds = (cat: FirmCategory) =>
    shown.filter((r) => categoryOf(effRating(r)) === cat).map((r) => r.account_id)

  /** Move a row to `toIndex` within its category and save the whole category's order. */
  async function moveTo(r: HealthRow, toIndex: number) {
    const cat = categoryOf(effRating(r))
    if (!cat || !dragEnabled || reorderBusy) return
    const ids = categoryIds(cat)
    const next = moveWithin(ids, r.account_id, toIndex)
    if (next.join() === ids.join()) return
    const prevLocal = localRanks
    const ranks = new Map(prevLocal && prevLocal.basis === rows ? prevLocal.ranks : [])
    next.forEach((id, i) => ranks.set(id, i + 1))
    setLocalRanks({ basis: rows, ranks })
    setReorderBusy(true)
    try {
      const res = await reorderHealthCategory(cat, next, r.account_id)
      if (!res.ok) {
        setLocalRanks(prevLocal)
        toast.error("Could not save the order", { description: res.error })
        return
      }
      toast.success(`${r.client_name} moved to #${next.indexOf(r.account_id) + 1} in ${FIRM_CATEGORY_LABEL[cat]}`)
      router.refresh()
    } finally {
      setReorderBusy(false)
    }
  }

  const sections: { key: string; cat: FirmCategory | null; label: string | null; rows: HealthRow[] }[] = grouped
    ? [...FIRM_CATEGORY_ORDER, null]
        .map((cat) => ({
          key: cat ?? "none",
          cat,
          label: cat ? FIRM_CATEGORY_LABEL[cat] : "Not rated",
          rows: shown.filter((r) => categoryOf(effRating(r)) === cat),
        }))
        .filter((s) => s.rows.length > 0)
    : [{ key: "all", cat: null, label: null, rows: shown }]

  function endDrag() {
    setArmed(null)
    setDragId(null)
    setOverId(null)
  }

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

  /** Needs-review resolutions: Keep (reaffirm) and Revert to AI. Update opens the editor. */
  async function resolve(r: HealthRow, how: "keep" | "revert") {
    setResolveBusy(r.account_id)
    try {
      const res = how === "keep" ? await keepHealthOverride(r.account_id) : await revertHealthOverride(r.account_id)
      if (!res.ok) {
        toast.error(how === "keep" ? "Could not keep the override" : "Could not revert", { description: res.error })
        return
      }
      toast.success(how === "keep" ? `Override kept for ${r.client_name}` : `${r.client_name} reverted to AI`)
      router.refresh()
    } finally {
      setResolveBusy(null)
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
          <option value="review">Needs review</option>
        </select>
        <button
          type="button"
          onClick={() => setRatingFilter(ratingFilter === "review" ? "all" : "review")}
          disabled={reviewCount === 0 && ratingFilter !== "review"}
          aria-pressed={ratingFilter === "review"}
          className={`flex h-9 items-center gap-1.5 rounded-md border px-3 text-sm font-medium transition-colors disabled:opacity-50 ${
            ratingFilter === "review"
              ? "border-[#B42318] bg-[#FDECEC] text-[#B42318]"
              : reviewCount > 0
                ? "border-[#B42318]/40 text-[#B42318] hover:bg-[#FDECEC]"
                : "text-muted-foreground"
          }`}
          title="Overrides the AI now disagrees with, or with new activity since they were last reviewed"
        >
          <AlertTriangle className="size-3.5" /> Needs review ({reviewCount})
        </button>
        <button
          type="button"
          onClick={() => setSort(null)}
          aria-pressed={sort === null}
          className={`flex h-9 items-center gap-1.5 rounded-md border px-3 text-sm font-medium transition-colors ${
            sort === null ? "border-[#1E2858] bg-[#1E2858] text-white" : "hover:bg-muted"
          }`}
          title="The firm-standard order: High risk → Monitor → Management / IR Change → Healthy, then the shared manual rank"
        >
          <ListOrdered className="size-3.5" /> Firm order
        </button>
        <span className="text-sm text-muted-foreground">
          {shown.length} of {rows.length} active clients
        </span>
        {canReorder && !dragEnabled && !tableError && (
          <span className="text-[12px] text-muted-foreground">
            Drag to reorder is available in Firm order with no search or filter.
          </span>
        )}
      </div>

      <div className={`${CARD_CLASS} overflow-hidden`}>
        <table className="w-full text-[13px]">
          <thead className="border-b bg-muted/40 text-left text-[12px] text-muted-foreground">
            <tr>
              <th className="w-[36px] px-0 py-2" aria-label="Reorder" />
              <th className="w-[200px] px-4 py-2 font-medium">
                <SortHeader
                  label="Rating"
                  isSorted={sortedAs("rating")}
                  onClick={() => toggleSort("rating")}
                  title="Sort by risk: High risk → Monitor → Management / IR Change → Healthy"
                />
              </th>
              <th className="w-[220px] px-4 py-2 font-medium">
                <SortHeader label="Client" isSorted={sortedAs("client")} onClick={() => toggleSort("client")} />
              </th>
              <th className="px-4 py-2 font-medium">
                <SortHeader label="Note" isSorted={sortedAs("note")} onClick={() => toggleSort("note")} />
              </th>
              <th className="w-[80px] px-2 py-2" />
            </tr>
          </thead>
          <tbody className="divide-y">
            {sections.map((sec) => (
              <React.Fragment key={sec.key}>
                {sec.label !== null && (
                  <tr className="bg-muted/40">
                    <td colSpan={5} className="px-4 py-1.5">
                      <span className="flex items-center gap-2 text-[11.5px] font-semibold uppercase tracking-wide text-[#1E2858]">
                        {sec.cat ? (
                          <span
                            className="size-2 rounded-full"
                            style={{ backgroundColor: RATING_STYLE[sec.cat].text }}
                            aria-hidden
                          />
                        ) : null}
                        {sec.label}
                        <span className="font-normal normal-case tracking-normal text-muted-foreground">
                          {sec.rows.length}
                        </span>
                      </span>
                    </td>
                  </tr>
                )}
                {sec.rows.map((r, i) => {
                  const note = effNote(r)
                  const cat = categoryOf(effRating(r))
                  const rowDraggable = dragEnabled && cat !== null
                  const unplaced =
                    grouped && cat !== null && rankOf(r) === null && sec.rows.some((x) => rankOf(x) !== null)
                  const sameCatDrag =
                    dragId !== null && cat !== null && categoryOf(effRating(rows.find((x) => x.account_id === dragId) ?? r)) === cat
                  return (
                    <tr
                      key={r.account_id}
                      className={`group align-top hover:bg-muted/30 ${dragId === r.account_id ? "opacity-50" : ""} ${
                        overId === r.account_id && dragId !== r.account_id ? "outline outline-2 -outline-offset-2 outline-[#0355A7]" : ""
                      }`}
                      draggable={rowDraggable && armed === r.account_id}
                      onDragStart={(e) => {
                        if (!rowDraggable) return
                        e.dataTransfer.effectAllowed = "move"
                        e.dataTransfer.setData("text/plain", r.account_id)
                        setDragId(r.account_id)
                      }}
                      onDragOver={(e) => {
                        // Only rows of the SAME category accept a drop — a client's
                        // category is set by its rating, never by dragging.
                        if (!rowDraggable || !sameCatDrag) return
                        e.preventDefault()
                        e.dataTransfer.dropEffect = "move"
                        if (overId !== r.account_id) setOverId(r.account_id)
                      }}
                      onDrop={(e) => {
                        if (!rowDraggable || !sameCatDrag || !dragId) return
                        e.preventDefault()
                        const dragged = rows.find((x) => x.account_id === dragId)
                        endDrag()
                        if (dragged) void moveTo(dragged, i)
                      }}
                      onDragEnd={endDrag}
                    >
                      <td className="px-0 py-2.5">
                        {rowDraggable && (
                          <div className="flex flex-col items-center">
                            <button
                              type="button"
                              aria-label={`Move ${r.client_name} up`}
                              title="Move up"
                              disabled={i === 0 || reorderBusy}
                              onClick={() => void moveTo(r, i - 1)}
                              className="rounded text-muted-foreground opacity-0 hover:text-foreground focus:opacity-100 disabled:invisible group-hover:opacity-100"
                            >
                              <ChevronUp className="size-3.5" />
                            </button>
                            <span
                              onPointerDown={() => setArmed(r.account_id)}
                              onPointerUp={() => setArmed(null)}
                              title="Drag to reorder within this category"
                              className={`text-muted-foreground ${reorderBusy ? "cursor-wait" : "cursor-grab active:cursor-grabbing"} hover:text-foreground`}
                            >
                              <GripVertical className="size-4" />
                            </span>
                            <button
                              type="button"
                              aria-label={`Move ${r.client_name} down`}
                              title="Move down"
                              disabled={i === sec.rows.length - 1 || reorderBusy}
                              onClick={() => void moveTo(r, i + 1)}
                              className="rounded text-muted-foreground opacity-0 hover:text-foreground focus:opacity-100 disabled:invisible group-hover:opacity-100"
                            >
                              <ChevronDown className="size-3.5" />
                            </button>
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-2.5">
                        <div className="flex flex-col items-start gap-1">
                          <RatingBadge rating={effRating(r)} />
                          {unplaced && (
                            <span
                              className="rounded border border-dashed border-muted-foreground/40 px-1.5 text-[10.5px] font-medium text-muted-foreground"
                              title="Not yet placed in the firm order (new client, or its category just changed) — drag it into position"
                            >
                              Not placed
                            </span>
                          )}
                          {isOverridden(r) && (
                            <span
                              className="rounded border border-[#2D4A8A]/30 px-1.5 text-[10.5px] font-medium text-[#2D4A8A]"
                              title={`Overridden${r.overridden_by_name ? ` by ${r.overridden_by_name}` : ""}${r.overridden_at ? ` on ${fmt(r.overridden_at)}` : ""}`}
                            >
                              Overridden
                            </span>
                          )}
                          {isPinned(r) && (
                            <span
                              className="inline-flex items-center gap-0.5 rounded border border-[#2D4A8A]/30 px-1.5 text-[10.5px] font-medium text-[#2D4A8A]"
                              title="Pinned: a hard lock — never flagged for review"
                            >
                              <Lock className="size-2.5" /> Pinned
                            </span>
                          )}
                        </div>
                      </td>
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
                        {needsReview(r) && (
                          <ReviewPanel
                            row={r}
                            busy={resolveBusy === r.account_id}
                            disabled={!!tableError || resolveBusy !== null}
                            onKeep={() => void resolve(r, "keep")}
                            onUpdate={() => setEditing(r)}
                            onRevert={() => void resolve(r, "revert")}
                          />
                        )}
                        {isPinned(r) && r.ai_rating && (
                          <div
                            className="mt-1 flex items-center gap-1.5 text-[11px] text-muted-foreground"
                            title={r.ai_note ?? undefined}
                          >
                            AI currently: <RatingBadge rating={r.ai_rating} />
                          </div>
                        )}
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
              </React.Fragment>
            ))}
            {shown.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-sm text-muted-foreground">
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

/**
 * The per-row "Needs review" block: the active override (shown above) vs the
 * AI's current view, why it was flagged, and the three resolutions. Divergence
 * is the loud signal (red when the AI reads MORE risk); new activity is quiet.
 */
function ReviewPanel({
  row,
  busy,
  disabled,
  onKeep,
  onUpdate,
  onRevert,
}: {
  row: HealthRow
  busy: boolean
  disabled: boolean
  onKeep: () => void
  onUpdate: () => void
  onRevert: () => void
}) {
  const divergence = row.review_reason === "divergence"
  const dir = divergence ? divergenceDirection(row) : null
  const tone = divergence
    ? dir === "up"
      ? "border-[#B42318]/40 bg-[#FDECEC]/60"
      : "border-[#92600B]/40 bg-[#FCF4E6]/60"
    : "border-border bg-muted/30"
  const headColor = divergence ? (dir === "up" ? "text-[#B42318]" : "text-[#92600B]") : "text-muted-foreground"
  const label = (v: string | null) => (v && isHealthRating(v) ? HEALTH_RATING_LABEL[v] : "—")

  const what: string[] = []
  if (row.evidence?.notes) what.push(plural(row.evidence.notes, "new client note", "new client notes"))
  if (row.evidence?.contracts) what.push(plural(row.evidence.contracts, "contract change", "contract changes"))
  const since = row.override_reviewed_at ?? row.overridden_at
  const sinceText = since ? " (" + fmt(since) + ")" : ""

  let reason: string
  if (divergence) {
    reason = "AI now reads this as " + label(row.ai_rating) + ", not " + label(row.override_rating) + "."
    if (what.length > 0) reason += " Also " + what.join(" and ") + " since the last review."
  } else {
    reason =
      what.length > 0
        ? what.join(" and ") + " since the override was last reviewed" + sinceText + "."
        : "New client notes or contract changes since the override was last reviewed" + sinceText + "."
  }

  return (
    <div className={`mt-2 rounded-md border px-3 py-2 text-[12px] ${tone}`}>
      <div className={`flex flex-wrap items-center gap-1.5 font-medium ${headColor}`}>
        {divergence ? (
          <>
            {dir === "up" ? (
              <ArrowUp className="size-3.5" />
            ) : dir === "down" ? (
              <ArrowDown className="size-3.5" />
            ) : (
              <AlertTriangle className="size-3.5" />
            )}
            Needs review · AI now disagrees
            {dir === "up" ? " (reads more risk)" : dir === "down" ? " (reads less risk)" : ""}
          </>
        ) : (
          <>Needs review · New activity since your override</>
        )}
      </div>
      <div className="mt-1.5 grid gap-1 sm:grid-cols-[auto_1fr] sm:gap-x-3">
        <span className="text-muted-foreground">Override</span>
        <span className="flex flex-wrap items-center gap-1.5">
          <RatingBadge rating={row.override_rating ?? row.ai_rating} />
          {!row.override_rating && <span className="text-muted-foreground">(note-only override)</span>}
          {row.overridden_by_name && <span className="text-muted-foreground">by {row.overridden_by_name}</span>}
        </span>
        <span className="text-muted-foreground">AI now</span>
        <span className="flex flex-wrap items-center gap-1.5">
          <RatingBadge rating={row.ai_rating} />
          {row.ai_generated_at && <span className="text-muted-foreground">{fmt(row.ai_generated_at)}</span>}
        </span>
      </div>
      {row.ai_note && <div className="mt-1.5 text-foreground/80">“{row.ai_note}”</div>}
      <div className="mt-1.5 text-muted-foreground">{reason}</div>
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <button
          type="button"
          disabled={disabled}
          onClick={onKeep}
          title="Reaffirm the override as-is. Clears the flag; the same unchanged situation won't flag again."
          className="flex items-center gap-1 rounded-md bg-[#1E2858] px-2.5 py-1 text-[12px] font-medium text-white hover:bg-[#0355A7] disabled:opacity-60"
        >
          {busy && <Loader2 className="size-3 animate-spin" />} Keep
        </button>
        <button
          type="button"
          disabled={disabled}
          onClick={onUpdate}
          className="rounded-md border bg-background px-2.5 py-1 text-[12px] font-medium hover:bg-muted disabled:opacity-60"
        >
          Update override
        </button>
        <button
          type="button"
          disabled={disabled}
          onClick={onRevert}
          className="rounded-md border bg-background px-2.5 py-1 text-[12px] font-medium hover:bg-muted disabled:opacity-60"
        >
          Revert to AI
        </button>
        {row.review_flagged_at && (
          <span className="ml-auto text-[11px] text-muted-foreground">Flagged {fmt(row.review_flagged_at)}</span>
        )}
      </div>
    </div>
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
  const [mode, setMode] = React.useState<OverrideMode>(row.override_mode)
  const [pending, startTransition] = React.useTransition()
  const overridden = isOverridden(row)

  function save() {
    // A note identical to the AI note is not an override of the note.
    const noteOverride = note.trim() && note.trim() !== (row.ai_note ?? "").trim() ? note : null
    startTransition(async () => {
      const r = await saveHealthOverride(row.account_id, rating || null, noteOverride, mode)
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
          <DialogTitle>{needsReview(row) ? `Update override — ${row.client_name}` : row.client_name}</DialogTitle>
          <DialogDescription>
            Override the AI rating and/or note. Overrides are kept when ratings are regenerated; the AI still
            re-reads the client each week with your override as strong context.
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

          <div>
            <span className="mb-1 block font-medium">Stickiness</span>
            <div role="radiogroup" aria-label="Override mode" className="inline-flex rounded-md border p-0.5">
              {(["prefer", "pin"] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  role="radio"
                  aria-checked={mode === m}
                  onClick={() => setMode(m)}
                  className={`flex items-center gap-1 rounded px-3 py-1 text-sm font-medium transition-colors ${
                    mode === m ? "bg-[#1E2858] text-white" : "text-muted-foreground hover:bg-muted"
                  }`}
                >
                  {m === "pin" && <Lock className="size-3" />}
                  {m === "prefer" ? "Prefer" : "Pin"}
                </button>
              ))}
            </div>
            <p className="mt-1 text-[11.5px] text-muted-foreground">
              {mode === "prefer"
                ? "Default. If the AI later disagrees, or new notes or contract changes arrive, the client is flagged “Needs review”. Nothing changes until you decide."
                : "Hard lock. Never flagged for review; the AI’s current read is still shown under the note for awareness."}
            </p>
          </div>
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
