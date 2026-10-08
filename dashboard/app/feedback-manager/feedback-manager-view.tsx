"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { AlertTriangle, CalendarDays, ChevronRight, ClipboardList } from "lucide-react"
import { loadEventRecord } from "@/app/events/actions"
import { EventRecordPane } from "@/app/events/event-record-pane"
import { TaskDrawerHost, useOpenTask } from "@/app/my-dashboard/task-drawer"
import type { EventRecord } from "@/lib/events/record"
import { ListTitleCard } from "@/components/page-masthead"
import { CARD_CLASS, TEXT_MUTED, TEXT_PRIMARY } from "@/lib/design"
import type { FeedbackPipelineRow } from "@/lib/types"
import type { ActionResult } from "@/lib/actions"
import type { ClaimsContext, ClosedClaimRow } from "@/lib/feedback-claims/types"
import {
  claimFeedbackTask,
  closeFeedbackReview,
  closeFeedbackTask,
  reassignFeedbackTask,
  releaseFeedbackTask,
} from "./actions"

// ---------------------------------------------------------------------------
// Palette + tokens. Row chips reuse the site's STATUS_PILL_LIGHT light tints;
// the KPI mini-bars reuse the site's saturated distribution-bar colors so the
// page reads as part of the system. Green <4 days, amber 4–6, red 7+.
// ---------------------------------------------------------------------------
const NAVY = "#1E2858"
// App amber (= DAYS_LEFT_PILL.amber.fg) — used for the unclaimed row accent and
// the unclaimed KPI-bar segment so both track the rest of the app.
const AMBER_ACCENT = "#B7791F"

// Light pill tints, reused across the page (chips, aging, and the pipeline-flow
// stage tiles) — the same tints as STATUS_PILL_LIGHT.
const TONE = {
  green: { bg: "#E7F5EE", text: "#0E7C56" },
  amber: { bg: "#FCF4E6", text: "#92600B" },
  red: { bg: "#FDECEC", text: "#B42318" },
  neutral: { bg: "#F1F3F7", text: "#5B6472" },
  navy: { bg: "#EEF2FB", text: "#2D4A8A" },
} as const

const FILTER_LABEL =
  "text-[11px] font-medium uppercase tracking-wide text-[#9AA1AD]"
const ALL = "__all__"

// All view dates are timestamptz; format the calendar day in UTC so it agrees
// with the server-computed days_in_stage (CURRENT_DATE) and never drifts a day.
const DATE_FMT = new Intl.DateTimeFormat("en-US", {
  timeZone: "UTC",
  month: "numeric",
  day: "numeric",
  year: "2-digit",
})
function fmtDate(iso: string | null): string {
  return iso ? DATE_FMT.format(new Date(iso)) : "—"
}
// Day-only ISO (YYYY-MM-DD) in UTC, for date math.
function dayISO(iso: string | null): string | null {
  return iso ? iso.slice(0, 10) : null
}
// Whole days from `a` to `b` (both YYYY-MM-DD); positive = b is later.
function daysBetween(a: string, b: string): number {
  const [ay, am, ad] = a.split("-").map(Number)
  const [by, bm, bd] = b.split("-").map(Number)
  return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86400000)
}

// Aging tone from days-in-stage.
function agingTone(days: number | null) {
  if (days == null) return TONE.neutral
  if (days < 4) return TONE.green
  if (days < 7) return TONE.amber
  return TONE.red
}

// ---------------------------------------------------------------------------
// Open-section filter. "closed" swaps the Open table for the Closed list (tasks
// closed through the Claim workflow here).
type ClaimFilter = "all" | "unclaimed" | "mine" | "others" | "closed"

/** Optimistic per-task state while an action is in flight (see runClaimAction). */
type ClaimOverride = { ownerId: string | null; ownerName: string | null; closed?: boolean }
const NO_OVERRIDES: Record<string, ClaimOverride> = {}
type SortKey = "client" | "am" | "event" | "mtg" | "age" | "due" | "taskdate" | "claimed"
type SortState = { key: SortKey; dir: "asc" | "desc" }

// Text columns default to ascending on first click; everything else descending.
const ASC_DEFAULT_KEYS: SortKey[] = ["client", "am", "event", "claimed"]
function nextSort(s: SortState, key: SortKey): SortState {
  if (s.key === key) return { key, dir: s.dir === "asc" ? "desc" : "asc" }
  return { key, dir: ASC_DEFAULT_KEYS.includes(key) ? "asc" : "desc" }
}

// Sort a row list by the given key/direction. Nulls always sort last, regardless
// of direction. Stable tiebreak on client name.
function sortRows(list: FeedbackPipelineRow[], sort: SortState): FeedbackPipelineRow[] {
  const dir = sort.dir === "asc" ? 1 : -1
  const numeric = sort.key === "age"
  const val = (r: FeedbackPipelineRow): string | number | null => {
    switch (sort.key) {
      case "client": return r.client_account_name || ""
      case "am": return r.account_manager_name || ""
      case "event": return r.event_name
      case "mtg": return r.meeting_start
      case "age": return r.days_in_stage
      case "due": return r.due_date
      // The shared date column: Feedback Received (in_progress) or Fb Closed
      // (pending_review). Each table is homogeneous, so this coalesce yields the
      // right per-row value for whichever section is being sorted.
      case "taskdate": return r.fb_closed_date ?? r.received_date
      case "claimed": return r.claimed_by_name || ""
    }
  }
  return [...list].sort((a, b) => {
    const va = val(a)
    const vb = val(b)
    if (va == null && vb == null) {
      // fall through to tiebreak
    } else if (va == null) {
      return 1
    } else if (vb == null) {
      return -1
    } else {
      const c =
        (numeric
          ? (va as number) - (vb as number)
          : String(va).localeCompare(String(vb))) * dir
      if (c !== 0) return c
    }
    return (a.client_account_name || "").localeCompare(b.client_account_name || "")
  })
}

// "Blair Mutschler" → "B. Mutschler" for the compact workload strip.
function shortName(name: string): string {
  const parts = name.trim().split(/\s+/)
  if (parts.length === 1) return parts[0]
  return `${parts[0][0]}. ${parts[parts.length - 1]}`
}

export function FeedbackPipelineView({
  rows: serverRows,
  today,
  embedded = false,
  claims,
  canOpen,
}: {
  rows: FeedbackPipelineRow[]
  today: string
  // When embedded in the merged Feedback page, the combined header owns the
  // masthead, so this view drops its own ListTitleCard.
  embedded?: boolean
  /** Claim / release / reassign / close overlay (lib/feedback-claims). */
  claims?: ClaimsContext
  /**
   * Which row shortcuts the viewer gets: open the event (Events drawer) / the
   * feedback task (Tasks drawer). Decided server-side from the viewer's page
   * access; the drawers' loaders re-check (super user) on the server.
   */
  canOpen?: { events: boolean; tasks: boolean }
}) {
  const router = useRouter()
  const [, startTransition] = React.useTransition()

  // OPTIMISTIC overrides, keyed to the rows they were made against: once the
  // server re-renders with fresh rows (router.refresh), they fall away on their
  // own — no effect needed.
  const [ov, setOv] = React.useState<{ base: FeedbackPipelineRow[]; map: Record<string, ClaimOverride> }>({
    base: serverRows,
    map: {},
  })
  const overrides = React.useMemo(
    () => (ov.base === serverRows ? ov.map : NO_OVERRIDES),
    [ov, serverRows],
  )
  const setOverride = (taskId: string, value: ClaimOverride | null) =>
    setOv((cur) => {
      const map = { ...(cur.base === serverRows ? cur.map : {}) }
      if (value) map[taskId] = value
      else delete map[taskId]
      return { base: serverRows, map }
    })

  const rows = React.useMemo(
    () =>
      serverRows
        .filter((r) => !overrides[r.task_id]?.closed)
        .map((r) => {
          const o = overrides[r.task_id]
          if (!o) return r
          return { ...r, claimed: !!o.ownerId, claimed_by_id: o.ownerId, claimed_by_name: o.ownerName }
        }),
    [serverRows, overrides],
  )

  const myIds = React.useMemo(() => new Set(claims?.viewer.myIds ?? []), [claims])

  /** Optimistic update → server action → toast; roll back on failure. */
  function runClaimAction(
    row: FeedbackPipelineRow,
    optimistic: ClaimOverride,
    call: () => Promise<ActionResult>,
    success: string,
  ) {
    const prev = overrides[row.task_id] ?? null
    setOverride(row.task_id, optimistic)
    startTransition(async () => {
      const res = await call()
      if (res.ok) {
        toast.success(success)
        router.refresh()
      } else {
        setOverride(row.task_id, prev)
        toast.error("Couldn't update the task", { description: res.error })
      }
    })
  }

  const renderActions =
    claims && !claims.setupMissing
      ? (r: FeedbackPipelineRow) => (
          <ClaimActions
            row={r}
            claims={claims}
            myIds={myIds}
            onClaim={() =>
              runClaimAction(
                r,
                { ownerId: claims.viewer.myIds[0] ?? "me", ownerName: "You" },
                () => claimFeedbackTask(r.task_id),
                "Claimed — it's yours.",
              )
            }
            onRelease={() =>
              runClaimAction(r, { ownerId: null, ownerName: null }, () => releaseFeedbackTask(r.task_id), "Released — back to unclaimed.")
            }
            onReassign={(userId, name) =>
              runClaimAction(
                r,
                { ownerId: userId, ownerName: name },
                () => reassignFeedbackTask(r.task_id, userId),
                `Assigned to ${name}.`,
              )
            }
            onClose={() =>
              runClaimAction(
                r,
                { ownerId: r.claimed_by_id, ownerName: r.claimed_by_name, closed: true },
                () => closeFeedbackTask(r.task_id),
                "Closed — moved on to Pending Review.",
              )
            }
          />
        )
      : undefined

  const [claimedBy, setClaimedBy] = React.useState<string>(ALL)
  const [accountManager, setAccountManager] = React.useState<string>(ALL)
  const [inProgClaim, setInProgClaim] = React.useState<ClaimFilter>("all")
  // Per-section sort with problem-first defaults: Open → longest-waiting first
  // (oldest drafts rise, matching the caption); Pending Review → longest-waiting first.
  const [ipSort, setIpSort] = React.useState<SortState>({ key: "age", dir: "desc" })
  const [prSort, setPrSort] = React.useState<SortState>({ key: "age", dir: "desc" })

  const inProgressAll = React.useMemo(
    () => rows.filter((r) => r.category === "in_progress"),
    [rows],
  )
  const pendingAll = React.useMemo(
    () => rows.filter((r) => r.category === "pending_review"),
    [rows],
  )

  // Stage counts for the pipeline flow (over the FULL sets, unaffected by filters).
  const kpis = React.useMemo(() => {
    const ipClaimed = inProgressAll.filter((r) => r.claimed).length
    return {
      inProgress: inProgressAll.length,
      ipClaimed,
      ipUnclaimed: inProgressAll.length - ipClaimed,
      pending: pendingAll.length,
    }
  }, [inProgressAll, pendingAll])

  // Filter dropdown option lists (across BOTH categories).
  const claimedByOptions = React.useMemo(
    () =>
      Array.from(
        new Set(rows.map((r) => r.claimed_by_name).filter(Boolean) as string[]),
      ).sort((a, b) => a.localeCompare(b)),
    [rows],
  )
  const amOptions = React.useMemo(
    () =>
      Array.from(
        new Set(
          rows.map((r) => r.account_manager_name).filter(Boolean) as string[],
        ),
      ).sort((a, b) => a.localeCompare(b)),
    [rows],
  )

  const atDefault =
    claimedBy === ALL && accountManager === ALL && inProgClaim === "all"
  function clearAll() {
    setClaimedBy(ALL)
    setAccountManager(ALL)
    setInProgClaim("all")
  }

  // Shared filter (Claimed By + Account Manager) applied to any row list.
  const passesShared = React.useCallback(
    (r: FeedbackPipelineRow) => {
      if (claimedBy !== ALL && r.claimed_by_name !== claimedBy) return false
      if (accountManager !== ALL && r.account_manager_name !== accountManager)
        return false
      return true
    },
    [claimedBy, accountManager],
  )

  // In Progress workload (per Claimed By + unclaimed), over the FULL In Progress
  // set so it reads as a stable "who's loaded" overview, unaffected by filters.
  const workload = React.useMemo(() => {
    const counts = new Map<string, number>()
    let unassigned = 0
    for (const r of inProgressAll) {
      if (r.claimed && r.claimed_by_name) {
        counts.set(r.claimed_by_name, (counts.get(r.claimed_by_name) ?? 0) + 1)
      } else {
        unassigned++
      }
    }
    const people = [...counts.entries()]
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
    return { people, unassigned }
  }, [inProgressAll])

  // Pending Review workload by ACCOUNT MANAGER (whose desk the review sits on),
  // over the full Pending Review set. `noAm` = pending items with no AM on file.
  const pendingWorkload = React.useMemo(() => {
    const counts = new Map<string, number>()
    let noAm = 0
    for (const r of pendingAll) {
      if (r.account_manager_name) {
        counts.set(r.account_manager_name, (counts.get(r.account_manager_name) ?? 0) + 1)
      } else {
        noAm++
      }
    }
    const people = [...counts.entries()]
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
    return { people, noAm }
  }, [pendingAll])

  const inProgressRows = React.useMemo(() => {
    let list = inProgressAll.filter(passesShared)
    const mine = (r: FeedbackPipelineRow) => !!r.claimed_by_id && myIds.has(r.claimed_by_id)
    if (inProgClaim === "unclaimed") list = list.filter((r) => !r.claimed)
    if (inProgClaim === "mine") list = list.filter(mine)
    if (inProgClaim === "others") list = list.filter((r) => r.claimed && !mine(r))
    return sortRows(list, ipSort)
  }, [inProgressAll, passesShared, inProgClaim, ipSort, myIds])

  const pendingRows = React.useMemo(
    () => sortRows(pendingAll.filter(passesShared), prSort),
    [pendingAll, passesShared, prSort],
  )

  // ROW SHORTCUTS — open the row's event / feedback task in the EXISTING
  // drawers, as overlays: the Events record pane (wired as FB Coming Soon wires
  // it) and My Dashboard's TaskDrawerHost (TaskRecordPane + its Edit dialog).
  // The list underneath is untouched, so closing returns to the same place.
  const [openEventId, setOpenEventId] = React.useState<string | null>(null)
  const [eventRecord, setEventRecord] = React.useState<EventRecord | null>(null)
  const [eventError, setEventError] = React.useState<string | null>(null)
  const openEvent = React.useCallback((id: string) => {
    setEventRecord(null)
    setEventError(null)
    setOpenEventId(id)
  }, [])
  const closeEvent = React.useCallback(() => {
    setOpenEventId(null)
    setEventRecord(null)
    setEventError(null)
  }, [])
  React.useEffect(() => {
    if (!openEventId) return
    let cancelled = false
    loadEventRecord(openEventId).then((res) => {
      if (cancelled) return
      if (res.ok) setEventRecord(res.data ?? null)
      else setEventError(res.error)
    })
    return () => {
      cancelled = true
    }
  }, [openEventId])
  const renderOpen =
    canOpen && (canOpen.events || canOpen.tasks)
      ? (r: FeedbackPipelineRow) => (
          <RowShortcuts
            eventId={canOpen.events ? r.event_id : null}
            // Pending Review opens the paired Report Sent task (the one to act on);
            // Open rows (and a pre-patch view) open the Feedback task.
            taskId={canOpen.tasks ? (r.review_task_id ?? r.task_id) : null}
            onOpenEvent={openEvent}
          />
        )
      : undefined

  const toggleIpSort = React.useCallback((k: SortKey) => setIpSort((s) => nextSort(s, k)), [])
  const togglePrSort = React.useCallback((k: SortKey) => setPrSort((s) => nextSort(s, k)), [])

  return (
    <TaskDrawerHost>
      {!embedded && (
        <div className="mb-4">
          <ListTitleCard
            title="Feedback Reports"
            subtitle="Active feedback reports across two stages — Open (being written) and Pending Review (written, awaiting account-manager review)."
          />
        </div>
      )}

      {/* KPI box — three-stage flow (left) | divider | Claimed By + Account
          Manager filters (right), all inside one card. */}
      <PipelineFlow
        unclaimed={kpis.ipUnclaimed}
        claimed={kpis.ipClaimed}
        inProgress={kpis.inProgress}
        pending={kpis.pending}
        filters={
          <>
            <FilterSelect
              id="fbp-claimed-by"
              label="Claimed By"
              value={claimedBy}
              onChange={setClaimedBy}
              options={claimedByOptions}
            />
            <FilterSelect
              id="fbp-am"
              label="Account Manager"
              value={accountManager}
              onChange={setAccountManager}
              options={amOptions}
            />
            {!atDefault && (
              <button
                type="button"
                onClick={clearAll}
                className="h-9 cursor-pointer rounded-md px-2 text-xs font-medium text-muted-foreground hover:text-foreground"
              >
                Clear
              </button>
            )}
          </>
        }
      />

      {/* PENDING REVIEW section */}
      {/* Workload strip — whose desk each pending review sits on (Account Mgr). */}
      {(pendingWorkload.people.length > 0 || pendingWorkload.noAm > 0) && (
        <WorkloadStrip
          label="Pending Review Workload — by account manager"
          people={pendingWorkload.people}
          trailing={{ label: "No AM", count: pendingWorkload.noAm }}
        />
      )}
      <Section
        title="Pending Review"
        caption="Reports written and awaiting account-manager review. Waiting = days since the matched Feedback task closed. Sorted by longest waiting first."
        count={pendingRows.length}
      >
        <PipelineTable
          rows={pendingRows}
          today={today}
          sort={prSort}
          onSort={togglePrSort}
          dateHeader="Fb Closed"
          renderOpen={renderOpen}
          // Same column count as Open so the two tables stay aligned; Pending
          // Review rows carry no claim actions.
          renderActions={
            renderActions && claims
              ? (r) => {
                  const review = claims.reviews[r.task_id]
                  // Only dashboard-origin review tasks (explicit link), and only
                  // for the client's account team — the action re-checks both.
                  if (!review || !review.canClose) return null
                  return (
                    <button
                      type="button"
                      className={ACTION_BTN}
                      disabled={claims.viewer.impersonated}
                      title={
                        claims.viewer.impersonated
                          ? "Exit “View as” to close reviews"
                          : "Complete the Feedback Report Pending Review task"
                      }
                      onClick={() => {
                        if (window.confirm("Mark this feedback report review complete?")) {
                          runClaimAction(
                            r,
                            { ownerId: r.claimed_by_id, ownerName: r.claimed_by_name, closed: true },
                            () => closeFeedbackReview(review.reviewTaskId),
                            "Review complete — the report is done.",
                          )
                        }
                      }}
                    >
                      Close
                    </button>
                  )
                }
              : undefined
          }
        />
      </Section>

      {/* IN PROGRESS section */}
      <div className="mt-6">
        {/* Workload strip — who's writing how many In Progress reports (Claimed By). */}
        {(workload.people.length > 0 || workload.unassigned > 0) && (
          <WorkloadStrip
            label="Open Workload — by report writer"
            people={workload.people}
            trailing={{
              label: "Unassigned",
              count: workload.unassigned,
              onClick: () => setInProgClaim("unclaimed"),
            }}
          />
        )}
        <Section
          title={inProgClaim === "closed" ? "Closed" : "Open"}
          caption={
            inProgClaim === "closed"
              ? "Feedback tasks closed here with Close — each one moved on to Pending Review. Most recent first."
              : "Waiting = days since all meeting level feedback has been received and report draft has started. Sorted by longest waiting first."
          }
          count={inProgClaim === "closed" ? (claims?.closed.length ?? 0) : inProgressRows.length}
          headerRight={
            <SubToggle value={inProgClaim} onChange={setInProgClaim} withClaims={!!claims} />
          }
        >
          {claims?.setupMissing && claims.viewer.isAdmin && (
            <div className={`mb-2.5 px-4 py-2.5 text-xs ${CARD_CLASS}`} style={{ color: TONE.amber.text, background: TONE.amber.bg }}>
              Claiming is built but switched off until <code>sql/patches/2026-10-07_feedback_claims.sql</code> is run in Supabase.
            </div>
          )}
          {inProgClaim === "closed" ? (
            <ClosedTable rows={claims?.closed ?? []} />
          ) : (
            <PipelineTable
              rows={inProgressRows}
              today={today}
              sort={ipSort}
              onSort={toggleIpSort}
              dateHeader="FB Received"
              emphasizeUnclaimed
              renderOpen={renderOpen}
              renderActions={renderActions}
              claimedAt={claims?.meta}
              emptyText={
                inProgClaim === "mine"
                  ? "You haven't claimed any open feedback tasks."
                  : inProgClaim === "unclaimed"
                    ? "Nothing is waiting to be claimed."
                    : inProgClaim === "others"
                      ? "Nobody else has an open claimed task."
                      : undefined
              }
            />
          )}
        </Section>
      </div>

      {/* The Events drawer, as an overlay (view-only here, like FB Coming Soon;
          a dashboard event carries its Feedback reports panel). */}
      <EventRecordPane
        record={eventRecord}
        loading={openEventId !== null && eventRecord === null && eventError === null}
        error={eventError}
        onClose={closeEvent}
      />
    </TaskDrawerHost>
  )
}

// ---------------------------------------------------------------------------
// Pipeline flow — Unclaimed → Claimed → Pending Review, with Unclaimed + Claimed
// bracketed as the two sub-states of "In progress". Monochrome: standard text
// colors, no per-stage tints (structure carries the meaning).
// ---------------------------------------------------------------------------
function PipelineFlow({
  unclaimed,
  claimed,
  inProgress,
  pending,
  filters,
}: {
  unclaimed: number
  claimed: number
  inProgress: number
  pending: number
  // Filter controls rendered inside the card, right of a vertical divider.
  filters?: React.ReactNode
}) {
  return (
    <div className={`mb-4 px-4 py-2.5 ${CARD_CLASS}`}>
      <div className="flex items-center gap-4">
        {/* Flow (left) */}
        <div className="min-w-0 flex-1 overflow-x-auto">
          <div
            className="grid min-w-[440px] items-center gap-x-2"
            style={{ gridTemplateColumns: "1fr auto 1fr auto 1fr" }}
          >
            {/* Row 1 — the three stages with chevrons between. Only Unclaimed
                carries the amber alert (it's the actionable one). */}
            <Stage label="Unclaimed" value={unclaimed} alert />
            <FlowArrow />
            <Stage label="Claimed" value={claimed} />
            <FlowArrow />
            <Stage label="Pending Review" value={pending} />

            {/* Row 2 — bracket grouping Unclaimed + Claimed as "In progress". */}
            <div
              className="mt-1 flex flex-col items-center"
              style={{ gridColumn: "1 / 4", gridRow: 2 }}
            >
              <div
                className="h-1.5 w-full rounded-b-md border-b border-l border-r"
                style={{ borderColor: "var(--border)" }}
                aria-hidden="true"
              />
              <div className="mt-0.5 text-[11px] font-medium" style={{ color: TEXT_MUTED }}>
                Open ({inProgress})
              </div>
            </div>
          </div>
        </div>

        {/* Vertical divider + filters (right), inside the same card. */}
        {filters && (
          <>
            <div
              className="w-px shrink-0 self-stretch"
              style={{ background: "var(--border)" }}
              aria-hidden="true"
            />
            <div className="flex shrink-0 flex-wrap items-center gap-3">{filters}</div>
          </>
        )}
      </div>
    </div>
  )
}

function Stage({
  label,
  value,
  alert = false,
}: {
  label: string
  value: number
  alert?: boolean
}) {
  // Alert (Unclaimed): no boxed background — just an amber number and an amber
  // "needs owner" warning icon in the label. Same size as the neutral stages.
  const numberColor = alert ? AMBER_ACCENT : TEXT_PRIMARY
  const labelColor = alert ? AMBER_ACCENT : TEXT_MUTED
  return (
    <div
      className="px-3 py-1 text-center"
      title={alert ? "Unclaimed — needs an owner" : undefined}
    >
      <div
        className="font-semibold leading-none tabular-nums"
        style={{ fontSize: 25, color: numberColor }}
      >
        {value}
      </div>
      <div
        className="mt-1 inline-flex items-center gap-1 whitespace-nowrap text-xs font-medium"
        style={{ color: labelColor }}
      >
        {alert && <AlertTriangle className="size-3 shrink-0" aria-hidden="true" />}
        {label}
      </div>
    </div>
  )
}

function FlowArrow() {
  return (
    <ChevronRight
      className="size-6 shrink-0 justify-self-center text-[#C0C6D0]"
      aria-hidden="true"
    />
  )
}

// ---------------------------------------------------------------------------
// Workload strip — per-person load (avatar + short name + count), plus an
// optional trailing chip (e.g. "Unassigned" / "No AM"). Used for both the In
// Progress strip (by Claimed By) and the Pending Review strip (by Account Mgr).
// ---------------------------------------------------------------------------
function WorkloadStrip({
  label,
  people,
  trailing,
}: {
  label: string
  people: { name: string; count: number }[]
  trailing?: { label: string; count: number; onClick?: () => void }
}) {
  return (
    <div className={`mb-4 p-2.5 ${CARD_CLASS}`}>
      <div className={`mb-1.5 ${FILTER_LABEL}`}>{label}</div>
      <div className="flex flex-wrap items-center gap-1.5">
        {people.map((p) => (
          <span
            key={p.name}
            title={`${p.name}: ${p.count}`}
            className="inline-flex items-center gap-1.5 rounded-full bg-slate-50 py-0.5 pl-0.5 pr-2 text-xs"
          >
            <Avatar name={p.name} />
            <span className="font-medium" style={{ color: NAVY }}>
              {shortName(p.name)}
            </span>
            <span className="tabular-nums text-muted-foreground">{p.count}</span>
          </span>
        ))}
        {trailing &&
          trailing.count > 0 &&
          (trailing.onClick ? (
            <button
              type="button"
              onClick={trailing.onClick}
              title={`${trailing.label} — click to view`}
              className="inline-flex items-center gap-1.5 rounded-full px-2 py-1 text-xs font-medium transition-opacity hover:opacity-90"
              style={{ background: TONE.amber.bg, color: TONE.amber.text }}
            >
              <span className="inline-block size-2 rounded-full" style={{ background: AMBER_ACCENT }} />
              {trailing.label} <span className="tabular-nums">{trailing.count}</span>
            </button>
          ) : (
            <span
              className="inline-flex items-center gap-1.5 rounded-full px-2 py-1 text-xs font-medium"
              style={{ background: TONE.amber.bg, color: TONE.amber.text }}
            >
              <span className="inline-block size-2 rounded-full" style={{ background: AMBER_ACCENT }} />
              {trailing.label} <span className="tabular-nums">{trailing.count}</span>
            </span>
          ))}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Section wrapper — title bar + a table card, with matching column widths.
// ---------------------------------------------------------------------------
function Section({
  title,
  caption,
  count,
  headerRight,
  children,
}: {
  title: string
  caption: string
  count: number
  headerRight?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <div>
      {/* App divider style (see Client Statistics section headers). */}
      <div className="mb-2 flex items-center gap-3">
        <span className="shrink-0 text-base font-medium" style={{ color: NAVY }}>
          {title}
        </span>
        <span
          className="shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium tabular-nums"
          style={{ background: TONE.neutral.bg, color: TONE.neutral.text }}
        >
          {count}
        </span>
        <span className="h-px flex-1 bg-border" aria-hidden="true" />
        {headerRight && <span className="shrink-0">{headerRight}</span>}
      </div>
      <p className="mb-2.5 text-xs" style={{ color: TEXT_MUTED }}>
        {caption}
      </p>
      {children}
    </div>
  )
}

// Shared column widths so the two stacked tables align pixel-for-pixel.
function ColGroup({ withActions = false, withOpen = false }: { withActions?: boolean; withOpen?: boolean }) {
  // With the claim Actions column, the other columns give up a little width so
  // both stacked tables still align (both get the same flags).
  const w = withActions
    ? ["13%", "15%", "11%", "8%", "8%", "8%", "12%", "12%", "13%"]
    : ["15%", "19%", "13%", "10%", "10%", "9%", "14%", "10%"]
  // The row-shortcut column is a fixed sliver just BEFORE Actions (or last,
  // with no Actions column); the percentages share what is left.
  if (withOpen) w.splice(withActions ? w.length - 1 : w.length, 0, "64px")
  return (
    <colgroup>
      {w.map((width, i) => (
        <col key={i} style={{ width }} />
      ))}
    </colgroup>
  )
}

const SHORTCUT_BTN =
  "inline-flex size-7 items-center justify-center rounded-md text-[#5B6472] transition-colors hover:bg-[#EEF2FB] hover:text-[#2D4A8A] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2D4A8A]/30 disabled:pointer-events-none disabled:opacity-30"

/**
 * The row's two shortcuts — open its event / its feedback task in the existing
 * drawers, over the page. A missing id renders the icon disabled (never an
 * error). The task opener comes from the surrounding TaskDrawerHost.
 */
function RowShortcuts({
  eventId,
  taskId,
  onOpenEvent,
}: {
  eventId: string | null
  taskId: string | null
  onOpenEvent: (id: string) => void
}) {
  const openTask = useOpenTask()
  return (
    <div className="flex items-center gap-0.5">
      <button
        type="button"
        className={SHORTCUT_BTN}
        disabled={!eventId}
        title={eventId ? "Open event" : "No event linked"}
        aria-label="Open event"
        onClick={() => eventId && onOpenEvent(eventId)}
      >
        <CalendarDays className="size-4" />
      </button>
      <button
        type="button"
        className={SHORTCUT_BTN}
        disabled={!taskId || !openTask}
        title={taskId ? "Open task" : "No task linked"}
        aria-label="Open task"
        onClick={() => taskId && openTask?.(taskId)}
      >
        <ClipboardList className="size-4" />
      </button>
    </div>
  )
}

// ---------------------------------------------------------------------------
// The table (identical shape for both categories). Columns not applicable to a
// row's category render "—".
// ---------------------------------------------------------------------------
function PipelineTable({
  rows,
  today,
  sort,
  onSort,
  dateHeader,
  emphasizeUnclaimed = false,
  renderOpen,
  renderActions,
  claimedAt,
  emptyText,
}: {
  rows: FeedbackPipelineRow[]
  today: string
  sort: SortState
  onSort: (key: SortKey) => void
  // Header for the shared date column — "FB Received" (In Progress) or
  // "Fb Closed" (Pending Review).
  dateHeader: string
  emphasizeUnclaimed?: boolean
  /** Open-event / open-task shortcuts; when set, a column is drawn before Actions. */
  renderOpen?: (r: FeedbackPipelineRow) => React.ReactNode
  /** Claim workflow buttons for a row; when set, an Actions column is drawn. */
  renderActions?: (r: FeedbackPipelineRow) => React.ReactNode
  /** task_id → claim facts, for the "since" date under the owner. */
  claimedAt?: ClaimsContext["meta"]
  emptyText?: string
}) {
  if (rows.length === 0) {
    return (
      <div className={`px-4 py-8 text-center text-sm text-muted-foreground ${CARD_CLASS}`}>
        {emptyText ?? "No reports match the current filters."}
      </div>
    )
  }
  return (
    <div className={`overflow-x-auto ${CARD_CLASS}`}>
      <table className="w-full table-fixed text-sm">
        <ColGroup withActions={!!renderActions} withOpen={!!renderOpen} />
        <thead className="bg-slate-50 text-xs uppercase tracking-wide text-muted-foreground">
          <tr>
            <SortTh k="client" sort={sort} onSort={onSort}>Client</SortTh>
            <SortTh k="event" sort={sort} onSort={onSort}>Event</SortTh>
            <SortTh k="mtg" sort={sort} onSort={onSort}>Mtg Dates</SortTh>
            <SortTh k="age" sort={sort} onSort={onSort} center>Age / Waiting</SortTh>
            <SortTh k="due" sort={sort} onSort={onSort} center>Due</SortTh>
            <SortTh k="taskdate" sort={sort} onSort={onSort} center>{dateHeader}</SortTh>
            <SortTh k="am" sort={sort} onSort={onSort}>Client Mgr</SortTh>
            <SortTh k="claimed" sort={sort} onSort={onSort}>Claimed By</SortTh>
            {renderOpen && (
              <th className="px-1 py-2">
                <span className="sr-only">Open event or task</span>
              </th>
            )}
            {renderActions && <th className="px-3 py-2 text-left font-medium">Actions</th>}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const isUnclaimed = emphasizeUnclaimed && !r.claimed
            return (
              <tr
                key={r.task_id}
                className="border-b last:border-0 hover:bg-slate-50/60"
                style={
                  isUnclaimed
                    ? {
                        background: "#FFFBF2",
                        boxShadow: `inset 3px 0 0 ${AMBER_ACCENT}`,
                      }
                    : undefined
                }
              >
                {/* Client */}
                <td className="truncate px-3 py-2.5 font-medium" title={r.client_account_name || undefined}>
                  {r.client_account_name || "—"}
                </td>
                {/* Event */}
                <td className="truncate px-3 py-2.5" title={r.event_name}>
                  {r.event_name}
                </td>
                {/* Mtg dates */}
                <td className="whitespace-nowrap px-3 py-2.5 tabular-nums">
                  {r.meeting_start || r.meeting_end
                    ? `${fmtDate(r.meeting_start)}–${fmtDate(r.meeting_end)}`
                    : "—"}
                </td>
                {/* Age / Waiting chip */}
                <td className="px-3 py-2.5 text-center">
                  <AgeChip
                    days={r.days_in_stage}
                    kind={r.category === "in_progress" ? "age" : "waiting"}
                  />
                </td>
                {/* Due with overdue flag */}
                <td className="whitespace-nowrap px-3 py-2.5 text-center">
                  <DueCell due={r.due_date} today={today} />
                </td>
                {/* Shared date column: In Progress → Feedback Received date;
                    Pending Review → Feedback-task Closed date. */}
                <td className="whitespace-nowrap px-3 py-2.5 text-center tabular-nums text-muted-foreground">
                  {r.category === "in_progress"
                    ? fmtDate(r.received_date)
                    : fmtDate(r.fb_closed_date)}
                </td>
                {/* Account Manager — avatar + name, consistent with Claimed By */}
                <td className="px-3 py-2.5">
                  {r.account_manager_name ? (
                    <PersonChip name={r.account_manager_name} />
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </td>
                {/* Claimed By / Was Claimed By */}
                <td className="px-3 py-2.5">
                  <ClaimedCell row={r} emphasizeUnclaimed={emphasizeUnclaimed} />
                  {r.claimed && claimedAt?.[r.task_id]?.claimedAt && (
                    <div className="mt-0.5 pl-8 text-[11px] tabular-nums text-muted-foreground">
                      since {fmtDate(claimedAt[r.task_id].claimedAt)}
                    </div>
                  )}
                </td>
                {renderOpen && <td className="px-1 py-2">{renderOpen(r)}</td>}
                {renderActions && <td className="px-3 py-2">{renderActions(r)}</td>}
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

function AgeChip({ days, kind }: { days: number | null; kind: "age" | "waiting" }) {
  if (days == null) return <span className="text-muted-foreground">—</span>
  const t = agingTone(days)
  const label = `${days}d`
  return (
    <span
      title={kind === "age" ? "Days since feedback received" : "Days since Feedback task closed"}
      className="inline-block whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-medium tabular-nums"
      style={{ background: t.bg, color: t.text }}
    >
      {label}
    </span>
  )
}

function DueCell({ due, today }: { due: string | null; today: string }) {
  const d = dayISO(due)
  if (!d) return <span className="text-muted-foreground">—</span>
  const diff = daysBetween(today, d) // >0 future, <0 past
  let tone: { bg: string; text: string } = TONE.neutral
  let flag: string | null = null
  if (diff < 0) {
    tone = TONE.red
    flag = "Overdue"
  } else if (diff <= 3) {
    tone = TONE.amber
    flag = "Due soon"
  }
  if (!flag) {
    return <span className="tabular-nums text-muted-foreground">{fmtDate(due)}</span>
  }
  return (
    <span
      title={flag}
      className="inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-medium tabular-nums"
      style={{ background: tone.bg, color: tone.text }}
    >
      {fmtDate(due)}
    </span>
  )
}

// A person cell: initials-avatar + name. Shared by Claimed By and Account Manager
// so the two people-columns render identically.
function PersonChip({ name }: { name: string }) {
  return (
    <span className="flex min-w-0 items-center gap-2">
      <Avatar name={name} />
      <span className="truncate" title={name}>
        {name}
      </span>
    </span>
  )
}

function ClaimedCell({
  row,
  emphasizeUnclaimed,
}: {
  row: FeedbackPipelineRow
  emphasizeUnclaimed: boolean
}) {
  if (row.claimed_by_name) {
    return <PersonChip name={row.claimed_by_name} />
  }
  // Unclaimed. In Progress = "up for grabs" (amber pill); Pending Review = "—".
  if (emphasizeUnclaimed) {
    return (
      <span
        className="inline-block whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-medium"
        style={{ background: TONE.amber.bg, color: TONE.amber.text }}
      >
        Unclaimed
      </span>
    )
  }
  return <span className="text-muted-foreground">—</span>
}

// ---------------------------------------------------------------------------
// Claim workflow — row buttons + the Closed list. The buttons are cosmetic:
// every action re-checks permission, pool and owner on the server
// (app/feedback-manager/actions.ts).
// ---------------------------------------------------------------------------
const ACTION_BTN =
  "inline-flex h-7 items-center rounded-md border border-input bg-background px-2 text-xs font-medium " +
  "text-foreground transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"

function ClaimActions({
  row,
  claims,
  myIds,
  onClaim,
  onRelease,
  onReassign,
  onClose,
}: {
  row: FeedbackPipelineRow
  claims: ClaimsContext
  myIds: Set<string>
  onClaim: () => void
  onRelease: () => void
  onReassign: (userId: string, name: string) => void
  onClose: () => void
}) {
  const [picking, setPicking] = React.useState(false)
  // Only tasks inside the claimable pool get buttons — today that is
  // dashboard-origin Feedback tasks; Dynamics-origin rows stay read-only until
  // the cutover switch opens them.
  if (row.category !== "in_progress" || !claims.meta[row.task_id]) return null

  const { viewer } = claims
  const owner = row.claimed ? row.claimed_by_id : null
  const isMine = !!owner && myIds.has(owner)
  const disabled = viewer.impersonated
  const title = disabled ? "Exit “View as” to change claims" : undefined

  const buttons: React.ReactNode[] = []
  if (!owner && viewer.canClaim) {
    buttons.push(
      <button key="claim" type="button" className={ACTION_BTN} disabled={disabled} title={title} onClick={onClaim}>
        Claim
      </button>,
    )
  }
  if (owner && (isMine || viewer.isAdmin)) {
    buttons.push(
      <button key="release" type="button" className={ACTION_BTN} disabled={disabled} title={title} onClick={onRelease}>
        Release
      </button>,
    )
  }
  if (viewer.isAdmin) {
    buttons.push(
      <button
        key="reassign"
        type="button"
        className={ACTION_BTN}
        disabled={disabled}
        title={title}
        onClick={() => setPicking((p) => !p)}
      >
        {owner ? "Reassign" : "Assign"}
      </button>,
    )
  }
  if (isMine || viewer.isAdmin) {
    buttons.push(
      <button
        key="close"
        type="button"
        className={ACTION_BTN}
        disabled={disabled}
        title={title ?? "Complete this Feedback task — it moves on to Pending Review"}
        onClick={() => {
          if (window.confirm("Close this feedback task? It will be marked complete and move on to Pending Review.")) onClose()
        }}
      >
        Close
      </button>,
    )
  }
  if (buttons.length === 0) return null

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex flex-wrap gap-1">{buttons}</div>
      {picking && viewer.isAdmin && (
        <select
          autoFocus
          defaultValue=""
          aria-label="Assign to"
          className="h-8 w-full rounded-md border border-input bg-background px-2 text-xs"
          onChange={(e) => {
            const person = claims.roster.find((p) => p.userId === e.target.value)
            if (!person) return
            setPicking(false)
            onReassign(person.userId, person.name)
          }}
        >
          <option value="" disabled>
            Assign to…
          </option>
          {claims.roster
            .filter((p) => p.userId !== owner)
            .map((p) => (
              <option key={p.userId} value={p.userId}>
                {p.name}
              </option>
            ))}
        </select>
      )}
    </div>
  )
}

function ClosedTable({ rows }: { rows: ClosedClaimRow[] }) {
  if (rows.length === 0) {
    return (
      <div className={`px-4 py-8 text-center text-sm text-muted-foreground ${CARD_CLASS}`}>
        No feedback tasks have been closed here yet.
      </div>
    )
  }
  return (
    <div className={`overflow-x-auto ${CARD_CLASS}`}>
      <table className="w-full table-fixed text-sm">
        <thead className="bg-slate-50 text-xs uppercase tracking-wide text-muted-foreground">
          <tr>
            <th className="px-3 py-2 text-left font-medium">Client</th>
            <th className="px-3 py-2 text-left font-medium">Event</th>
            <th className="px-3 py-2 text-left font-medium">Owner</th>
            <th className="px-3 py-2 text-left font-medium">Closed By</th>
            <th className="px-3 py-2 text-center font-medium">Closed</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.taskId} className="border-b last:border-0">
              <td className="truncate px-3 py-2.5 font-medium">{r.client ?? "—"}</td>
              <td className="truncate px-3 py-2.5">{r.event ?? "—"}</td>
              <td className="px-3 py-2.5">
                {r.ownerName ? <PersonChip name={r.ownerName} /> : <span className="text-muted-foreground">Unclaimed</span>}
              </td>
              <td className="px-3 py-2.5">
                {r.closedByName ? <PersonChip name={r.closedByName} /> : <span className="text-muted-foreground">—</span>}
              </td>
              <td className="whitespace-nowrap px-3 py-2.5 text-center tabular-nums text-muted-foreground">
                {fmtDate(r.closedAt)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// Deterministic avatar circle from a person's name.
const AVATAR_COLORS = ["#1E2858", "#0355A7", "#1C8C9C", "#0E7C56", "#92600B", "#7A3E9D"]
function initials(name: string): string {
  const parts = name.trim().split(/\s+/)
  const a = parts[0]?.[0] ?? ""
  const b = parts.length > 1 ? parts[parts.length - 1][0] : ""
  return (a + b).toUpperCase()
}
function Avatar({ name }: { name: string }) {
  let hash = 0
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) >>> 0
  const bg = AVATAR_COLORS[hash % AVATAR_COLORS.length]
  return (
    <span
      className="flex size-6 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold text-white"
      style={{ background: bg }}
      aria-hidden="true"
    >
      {initials(name)}
    </span>
  )
}

// ---------------------------------------------------------------------------
// Controls
// ---------------------------------------------------------------------------
function FilterSelect({
  id,
  label,
  value,
  onChange,
  options,
}: {
  id: string
  label: string
  value: string
  onChange: (v: string) => void
  options: string[]
}) {
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className={FILTER_LABEL}>
        {label}
      </label>
      <select
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-9 max-w-[240px] rounded-md border border-input bg-background px-3 text-sm"
      >
        <option value={ALL}>All</option>
        {options.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    </div>
  )
}

function SubToggle({
  value,
  onChange,
  withClaims = false,
}: {
  value: ClaimFilter
  onChange: (v: ClaimFilter) => void
  withClaims?: boolean
}) {
  const opts: { v: ClaimFilter; label: string }[] = [
    { v: "all", label: "All" },
    { v: "unclaimed", label: "Unclaimed" },
    { v: "mine", label: "Mine" },
    { v: "others", label: "Claimed by others" },
    ...(withClaims ? [{ v: "closed" as const, label: "Closed" }] : []),
  ]
  return (
    <div
      className="flex h-8 items-center rounded-md bg-card p-0.5"
      style={{ border: "0.5px solid var(--border)" }}
    >
      {opts.map((o) => {
        const active = value === o.v
        return (
          <button
            key={o.v}
            type="button"
            onClick={() => onChange(o.v)}
            aria-pressed={active}
            className={
              "rounded px-2.5 py-1 text-xs font-medium transition-colors " +
              (active ? "text-white" : "text-foreground hover:bg-slate-50")
            }
            style={active ? { backgroundColor: NAVY } : undefined}
          >
            {o.label}
          </button>
        )
      })}
    </div>
  )
}

function SortTh({
  k,
  sort,
  onSort,
  right,
  center,
  children,
}: {
  k: SortKey
  sort: SortState
  onSort: (key: SortKey) => void
  right?: boolean
  center?: boolean
  children: React.ReactNode
}) {
  const active = sort.key === k
  return (
    <th
      className={
        "select-none whitespace-nowrap px-3 py-2 font-medium " +
        (center ? "text-center" : right ? "text-right" : "text-left")
      }
    >
      <button
        type="button"
        onClick={() => onSort(k)}
        className={
          "inline-flex items-center gap-1 hover:text-foreground " +
          (right ? "flex-row-reverse" : "")
        }
      >
        {children}
        <span className="text-[9px] leading-none" style={{ opacity: active ? 1 : 0.25 }}>
          {active ? (sort.dir === "asc" ? "▲" : "▼") : "▼"}
        </span>
      </button>
    </th>
  )
}
