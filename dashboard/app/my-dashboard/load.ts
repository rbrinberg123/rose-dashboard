import { getSupabaseServer } from "@/lib/supabase"
import { canAccessRoute } from "@/lib/access-control"
import { getEffectiveIdentity, getEffectiveRole } from "@/lib/effective-identity"
import { getAllowedRoutes } from "@/lib/page-access"
import {
  TEAM_ROLES,
  resolveAccountTeamScope,
  type TeamRole,
} from "@/lib/access/account-team-scope"
import { personIdsReviewedBy } from "@/lib/time-off-requests/reviewers"
import { viewerUserIds } from "@/app/clients/alerts/load"
import { easternToday, storedDay } from "@/app/clients/alerts/alerts-policy"
import {
  contractKeyDay,
  daysUntil,
  feedbackDueDay,
  feedbackUrgency,
  shiftDay,
  sortByDue,
  urgencyFor,
  type Urgency,
} from "./policy"

/**
 * Server loader for /my-dashboard — the personal home page.
 *
 * ── SECURITY ───────────────────────────────────────────────────────────────
 * The app reads with the service-role key, which bypasses RLS, so THIS FILE is
 * the only gate on what a viewer sees. Every feed is scoped to the EFFECTIVE
 * identity (so "View as {person}" previews it), through two resolvers the
 * Alerts page already uses:
 *
 *   ME          viewerUserIds(email) — the viewer's Dynamics user_id set
 *               (duplicate CRM records unioned). Unresolved → [] → every
 *               "me" feed is skipped, never run unfiltered.
 *   MY CLIENTS  resolveAccountTeamScope(identity) — accounts where the viewer
 *               holds ANY of the six team roles. Read from the live account
 *               lookups, which for dashboard-created clients are projected
 *               from account_team_members by trigger (see
 *               lib/account-teams/roles.ts), so the owned table IS the source
 *               there and Dynamics is the source for Dynamics clients.
 *
 * There is NO super-user bypass: this page answers "what is on MY plate", and a
 * Super User with no team memberships correctly sees an empty book.
 *
 * Field-level: no contract dollar column is read, and Client Health (whose
 * notes can discuss the retainer) is not read at all.
 *
 * ── SHAPE ──────────────────────────────────────────────────────────────────
 * Two round-trip stages: (1) identity + team scope + the account roster, in
 * parallel; (2) every feed query in ONE Promise.all. Each feed fails SOFT on
 * its own — an error shows in that card only.
 */

/** Per-feed row cap — a guard against a pathological result, not paging. */
export const FEED_CAP = 60

export type Feed<T> = { rows: T[]; truncated: number; error: string | null }

export type TodoKind = "collect" | "review" | "report" | "profiles" | "host" | "approve"

export type TodoItem = {
  /**
   * The CRM task behind this item, when there is one (feedback report /
   * review items). Opens in the task drawer on the dashboard. Null for items
   * backed by a meeting, profiles or a time-off request.
   */
  taskId: string | null
  key: string
  kind: TodoKind
  urgency: Urgency
  /** The item's own Eastern day (drives the bucket). */
  due: string | null
  /** What the right-hand date line says ("Oct 8 · 10:00", "Oct 20–24"). */
  dueLabel: string | null
  /** Plain lead-in ("Host meeting — ") then the bold subject. */
  lead: string
  subject: string
  sub: string | null
  href: string | null
}

export type TaskItem = {
  /** CRM task id (opens the task drawer). */
  taskId: string
  key: string
  mine: boolean
  subject: string
  client: string | null
  /** Team rows only: who it is assigned to, and their role on that client. */
  assignee: string | null
  role: string | null
  due: string | null
  href: string | null
}

export type MarketingItem = {
  key: string
  client: string
  ticker: string | null
  eventName: string | null
  booked: number
  required: number
  open: number
  dates: string | null
  urgency: string | null
  href: string | null
}

export type ContractItem = {
  key: string
  client: string
  ticker: string | null
  noticeDay: string | null
  termEndDay: string | null
  autoRenew: boolean | null
  /** Days until the date it is counted against (notice, else term end). */
  daysLeft: number
  href: string | null
}

export type OnboardingItem = {
  accountId: string
  name: string
  ticker: string | null
  steps: { label: string; done: boolean }[]
  days: number | null
  href: string | null
}

/** A pending time-off request awaiting the viewer's approval / review. */
export type ApprovalItem = {
  key: string
  requester: string
  start: string
  end: string
  totalDays: number | null
  requestType: string
  href: string | null
}

export type BookClient = { accountId: string; ticker: string | null; name: string; href: string | null }
export type BookGroup = { role: TeamRole; label: string; clients: BookClient[] }

export type MyDashboardData = {
  today: string
  firstName: string | null
  /** The sign-in email did not resolve to a CRM person — "me" feeds are denied. */
  viewerUnresolved: boolean
  book: { count: number; groups: BookGroup[]; portfolioHref: string | null }
  todo: Feed<TodoItem>
  tasks: Feed<TaskItem>
  marketing: Feed<MarketingItem>
  contracts: Feed<ContractItem>
  onboarding: Feed<OnboardingItem>
  /** Time Off card: requests awaiting MY approval (also rolled into My To-Do). */
  approvals: Feed<ApprovalItem>
  /** Meetings the viewer hosts today or tomorrow — for the "Needs you now" pill. */
  hostSoon: number
  /**
   * May the viewer open the CRM task drawer? Same gate as CRM → Tasks
   * (loadTaskRecord is super-user only) — never loosened here. Everyone else
   * keeps the item's normal link.
   */
  canOpenTasks: boolean
  /** Card-header "view all" links, null where the viewer cannot open the page. */
  links: {
    tasks: string | null
    liveOutreach: string | null
    contracts: string | null
    onboarding: string | null
    timeOff: string | null
  }
}

// ---------------------------------------------------------------------------
// Formatting — CRM timestamps are a "+00 wall clock read as-is" (see
// app/clients/alerts/load.ts), so formatters run in UTC.
// ---------------------------------------------------------------------------
const DAY_FMT = new Intl.DateTimeFormat("en-US", { timeZone: "UTC", month: "short", day: "numeric" })
const TIME_FMT = new Intl.DateTimeFormat("en-US", {
  timeZone: "UTC",
  hour: "numeric",
  minute: "2-digit",
})

export function fmtDay(day: string | null): string | null {
  return day ? DAY_FMT.format(new Date(day + "T00:00:00Z")) : null
}

function fmtRange(start: string, end: string): string {
  if (start === end) return fmtDay(start) ?? start
  const [, sm] = start.split("-")
  const [, em, ed] = end.split("-")
  return sm === em ? `${fmtDay(start)}–${Number(ed)}` : `${fmtDay(start)} – ${fmtDay(end)}`
}

function capped<T>(rows: T[], error: string | null = null): Feed<T> {
  return { rows: rows.slice(0, FEED_CAP), truncated: Math.max(0, rows.length - FEED_CAP), error }
}

type QueryResult = { data: unknown; error: { message: string } | null } | null

const ONBOARDING_STEPS = [
  ["f_onboarding_call", "Onb. call"],
  ["f_teach_in_date", "Teach-in"],
  ["f_calendar", "Calendar"],
  ["f_calendar_confirmed", "Cal. confirmed"],
  ["f_meeting_history", "Mtg history"],
  ["f_distro", "Distro"],
  ["f_bda_peers", "BDA peers"],
  ["f_recurring_call_scheduled", "Recurring call"],
  ["f_report", "Report"],
] as const

type AccountRow = {
  account_id: string
  name: string | null
  ticker_symbol: string | null
  state_label: string | null
} & Record<string, string | null>

export async function loadMyDashboard(): Promise<MyDashboardData> {
  const sb = getSupabaseServer()
  const identity = await getEffectiveIdentity()
  const today = easternToday()

  // ── Stage 1: who am I, which clients am I on, what may I open ────────────
  const nameCols = TEAM_ROLES.map((r) => r.idColumn.replace(/_id$/, "_name"))
  const [viewer, team, role, accountsRes] = await Promise.all([
    viewerUserIds(identity.email),
    resolveAccountTeamScope(identity),
    getEffectiveRole(),
    // The whole accounts table is ~230 rows: one bulk read beats per-row joins,
    // and it gives every team member's id + name for the Team tasks feed
    // without a second round-trip.
    sb
      .from("accounts")
      .select(
        ["account_id", "name", "ticker_symbol", "state_label", ...TEAM_ROLES.map((r) => r.idColumn), ...nameCols].join(","),
      ),
  ])
  const allowedRoutes = await getAllowedRoutes(role)
  const can = (route: string) => canAccessRoute(role, route, allowedRoutes)

  const ids = viewer.ids
  const myIds = new Set(ids)
  const teamAccountIds = team.mode === "filter" ? [...team.accountIds] : []
  const accounts = (accountsRes.data ?? []) as unknown as AccountRow[]
  const accountById = new Map(accounts.map((a) => [a.account_id, a]))

  // "My Book" = my team accounts that are ACTIVE clients. Card feeds use it;
  // the feedback to-dos use every team account, exactly like Alerts and the nav
  // badge, so the three surfaces never disagree about a report.
  const book = teamAccountIds
    .map((id) => accountById.get(id))
    .filter((a): a is AccountRow => !!a && a.state_label === "Active")
  const bookIds = book.map((a) => a.account_id)

  // Every OTHER person on my book's teams, with the role(s) they hold per client.
  const memberRoles = new Map<string, Map<string, string[]>>() // person → account → labels
  const memberName = new Map<string, string>()
  for (const a of book) {
    for (const r of TEAM_ROLES) {
      const pid = a[r.idColumn]
      if (!pid || myIds.has(pid)) continue
      const byAcct = memberRoles.get(pid) ?? new Map<string, string[]>()
      byAcct.set(a.account_id, [...(byAcct.get(a.account_id) ?? []), r.label])
      memberRoles.set(pid, byAcct)
      const nm = a[r.idColumn.replace(/_id$/, "_name")]
      if (nm) memberName.set(pid, nm)
    }
  }
  const memberIds = [...memberRoles.keys()]

  // Accounts where I am the ACCOUNT MANAGER (Primary) — the Profiles to-do.
  const managedIds = book
    .filter((a) => team.mode === "filter" && team.rolesByAccount.get(a.account_id)?.includes("account_manager"))
    .map((a) => a.account_id)

  // ── Links: only to pages the viewer can actually open ────────────────────
  const clientHref = (id: string | null) =>
    id && can("/client-detail") ? "/client-detail?account_id=" + id : null
  const or = (route: string, href: string, fallbackId: string | null) =>
    can(route) ? href : clientHref(fallbackId)

  // ── Stage 2: every feed, in ONE parallel batch ───────────────────────────
  const skip = Promise.resolve(null)
  const C = FEED_CAP + 1

  const collectQ = ids.length
    ? sb
        .from("v_feedback_outstanding")
        .select("meeting_id, meeting_date, client_account_id, client_account_name, client_ticker, institution_name, investor_text")
        // host_id here IS the feedback-responsible person (see Alerts load.ts).
        .in("host_id", ids)
        .order("meeting_date", { ascending: true })
        .limit(C)
    : skip

  const reviewQ = teamAccountIds.length
    ? sb
        .from("v_feedback_pipeline")
        .select("task_id, event_name, client_account_id, client_account_name, client_ticker, due_date, claimed_by_name")
        .eq("category", "pending_review")
        .in("client_account_id", teamAccountIds)
        .limit(C)
    : skip

  // "Open report I have claimed": the view's claimed_by_id (tasks.bcs_claimed_by_id).
  // Feedback Reports' Claim action keeps that field in step with the dashboard
  // claim (tasks.claimed_by_id) on dashboard-origin tasks, so a claim made there
  // shows here, and Close (state → Completed) drops it out of 'in_progress'.
  const claimedQ = ids.length
    ? sb
        .from("v_feedback_pipeline")
        .select("task_id, event_name, client_account_id, client_account_name, client_ticker, due_date, received_date")
        .eq("category", "in_progress")
        .in("claimed_by_id", ids)
        .limit(C)
    : skip

  const profilesQ = managedIds.length
    ? sb
        .from("v_profiles_upcoming")
        .select("meeting_id, meeting_date, client_account_id, client_account_name")
        .eq("profile_label", "Created/Under Review")
        .in("client_account_id", managedIds)
        .limit(500)
    : skip

  const hostQ = ids.length
    ? sb
        .from("meetings")
        .select("meeting_id, meeting_date, client_account_id, client_account_name, institution_name, is_in_person")
        .eq("meeting_status_label", "Confirmed")
        .eq("state_label", "Active")
        .in("host_id", ids)
        .gte("meeting_date", today + "T00:00:00+00:00")
        .lte("meeting_date", shiftDay(today, 7) + "T23:59:59+00:00")
        .order("meeting_date", { ascending: true })
        .limit(C)
    : skip

  const approvalsQ = (async (): Promise<QueryResult> => {
    if (!ids.length) return null
    const people = await personIdsReviewedBy(ids)
    // null = reviewer table not there yet; say nothing rather than error.
    const reviewed = (people ?? []).filter((p) => !myIds.has(p))
    if (!reviewed.length) return null
    return sb
      .from("time_off_requests")
      .select("id, requested_by_name, start_date, end_date, request_type, total_days")
      .eq("status", "Pending")
      .eq("origin", "dashboard")
      .in("requested_by_id", reviewed)
      .order("start_date", { ascending: true })
      .limit(C)
  })()

  const TASK_COLS = "task_id, subject, client_account_id, client_account_name, client_ticker, owner_id, owner_name, due_date"
  const myTasksQ = ids.length
    ? sb
        .from("v_admin_tasks_all")
        .select(TASK_COLS)
        .eq("state_label", "Open")
        .in("owner_id", ids)
        .order("due_date", { ascending: true, nullsFirst: false })
        .limit(C)
    : skip
  const teamTasksQ =
    bookIds.length && memberIds.length
      ? sb
          .from("v_admin_tasks_all")
          .select(TASK_COLS)
          .eq("state_label", "Open")
          .in("client_account_id", bookIds)
          .in("owner_id", memberIds)
          .order("due_date", { ascending: true, nullsFirst: false })
          .limit(C)
      : skip

  // Inclusion (Live Outreach state, Active, Mining excluded) lives in the view.
  const marketingQ = bookIds.length
    ? sb
        .from("v_live_outreach")
        .select("event_id, event_name, client_account_id, client_account_name, ticker, of_slots, slots_remaining, confirmed_meeting_count, event_dates, urgency")
        .in("client_account_id", bookIds)
    : skip

  // Both origins (Dynamics + dashboard). No money column is selected.
  const contractsQ = bookIds.length
    ? sb
        .from("v_admin_contracts_all")
        .select("contract_id, account_id, client_name, client_ticker, notice_date, term_end, auto_renew, termination_date, is_test")
        .in("account_id", bookIds)
        .is("termination_date", null)
    : skip

  const onboardingQ = bookIds.length
    ? sb
        .from("v_client_onboarding")
        .select(["account_id", "name", "ticker_symbol", "days_onboarding", ...ONBOARDING_STEPS.map((s) => s[0])].join(","))
        .in("account_id", bookIds)
        .order("days_onboarding", { ascending: false, nullsFirst: false })
    : skip

  const results = (await Promise.all([
    collectQ, reviewQ, claimedQ, profilesQ, hostQ, approvalsQ,
    myTasksQ, teamTasksQ, marketingQ, contractsQ, onboardingQ,
  ])) as QueryResult[]
  const [
    collectRes, reviewRes, claimedRes, profilesRes, hostRes, approvalsRes,
    myTasksRes, teamTasksRes, marketingRes, contractsRes, onboardingRes,
  ] = results
  const rowsOf = <T,>(r: QueryResult) => (r && !r.error ? ((r.data ?? []) as T[]) : [])
  const errOf = (...rs: QueryResult[]) => rs.find((r) => r?.error)?.error?.message ?? null

  // ── My To-Do ─────────────────────────────────────────────────────────────
  const todo: TodoItem[] = []

  for (const r of rowsOf<{
    meeting_id: string; meeting_date: string; client_account_id: string | null
    client_account_name: string | null; institution_name: string | null; investor_text: string | null
  }>(collectRes)) {
    const day = storedDay(r.meeting_date)
    todo.push({
      taskId: null,
      key: "collect:" + r.meeting_id,
      kind: "collect",
      urgency: feedbackUrgency(day, today),
      due: feedbackDueDay(day),
      dueLabel: fmtDay(feedbackDueDay(day)),
      lead: "Collect feedback — ",
      subject: [r.institution_name, r.client_account_name].filter(Boolean).join(" × ") || "Meeting",
      sub: "Met " + (fmtDay(day) ?? "—") + (r.investor_text ? " · " + r.investor_text : ""),
      href: or(
        "/feedback-collection",
        "/feedback-collection?client=" + (r.client_account_id ?? ""),
        r.client_account_id,
      ),
    })
  }

  const reviewRows = rowsOf<{
    task_id: string; event_name: string | null; client_account_id: string | null
    client_account_name: string | null; due_date: string | null; claimed_by_name: string | null
  }>(reviewRes)
  // The task to open for a review item: the automation-created "Feedback
  // Report Pending Review" task linked to the report (the one to close out),
  // else the report task itself. A missing column (patch not run) just falls back.
  const reviewTaskFor = new Map<string, string>()
  if (reviewRows.length > 0) {
    const { data: linked } = await sb
      .from("tasks")
      .select("task_id, review_of_task_id")
      .in("review_of_task_id", reviewRows.map((r) => r.task_id))
      .eq("state_label", "Open")
    for (const l of (linked ?? []) as { task_id: string; review_of_task_id: string }[]) {
      reviewTaskFor.set(l.review_of_task_id, l.task_id)
    }
  }
  for (const r of reviewRows) {
    const day = storedDay(r.due_date)
    todo.push({
      taskId: reviewTaskFor.get(r.task_id) ?? r.task_id,
      key: "review:" + r.task_id,
      kind: "review",
      urgency: urgencyFor(day, today),
      due: day,
      dueLabel: fmtDay(day),
      lead: "Review feedback report — ",
      subject: [r.client_account_name, r.event_name].filter(Boolean).join(" · ") || "Report",
      sub: r.claimed_by_name ? "Reviewer: " + r.claimed_by_name : "Pending review · your account team",
      href: or("/feedback-manager", "/feedback-manager", r.client_account_id),
    })
  }

  for (const r of rowsOf<{
    task_id: string; event_name: string | null; client_account_id: string | null
    client_account_name: string | null; due_date: string | null
  }>(claimedRes)) {
    const day = storedDay(r.due_date)
    todo.push({
      taskId: r.task_id,
      key: "report:" + r.task_id,
      kind: "report",
      urgency: urgencyFor(day, today),
      due: day,
      dueLabel: fmtDay(day),
      lead: "Finish claimed feedback report — ",
      subject: [r.client_account_name, r.event_name].filter(Boolean).join(" · ") || "Report",
      sub: "You claimed this report",
      href: or("/feedback-manager", "/feedback-manager", r.client_account_id),
    })
  }

  // Profiles: one line per client, dated by its EARLIEST upcoming meeting.
  const profilesByClient = new Map<string, { name: string; count: number; first: string | null }>()
  for (const r of rowsOf<{
    meeting_date: string; client_account_id: string; client_account_name: string | null
  }>(profilesRes)) {
    const day = storedDay(r.meeting_date)
    const cur = profilesByClient.get(r.client_account_id) ?? {
      name: r.client_account_name ?? "Client",
      count: 0,
      first: null,
    }
    cur.count += 1
    if (day && (!cur.first || day < cur.first)) cur.first = day
    profilesByClient.set(r.client_account_id, cur)
  }
  for (const [accountId, p] of profilesByClient) {
    todo.push({
      taskId: null,
      key: "profiles:" + accountId,
      kind: "profiles",
      urgency: urgencyFor(p.first, today),
      due: p.first,
      dueLabel: p.first ? "1st mtg " + fmtDay(p.first) : null,
      lead: `${p.count} investor profile${p.count === 1 ? "" : "s"} to review — `,
      subject: p.name,
      sub: "You are the account manager",
      href: or("/profiles", "/profiles", accountId),
    })
  }

  let hostSoon = 0
  const hostRows = rowsOf<{
    meeting_id: string; meeting_date: string; client_account_id: string | null
    client_account_name: string | null; institution_name: string | null; is_in_person: boolean | null
  }>(hostRes)
  for (const r of hostRows) {
    const day = storedDay(r.meeting_date)
    const d = daysUntil(day, today)
    if (d != null && d <= 1) hostSoon += 1
    todo.push({
      taskId: null,
      key: "host:" + r.meeting_id,
      kind: "host",
      urgency: urgencyFor(day, today),
      due: day,
      dueLabel: (fmtDay(day) ?? "") + " · " + TIME_FMT.format(new Date(r.meeting_date)),
      lead: "Host meeting — ",
      subject: [r.client_account_name, r.institution_name].filter(Boolean).join(" × ") || "Meeting",
      sub: r.is_in_person ? "In person" : "Virtual",
      href: or(
        "/meetings",
        "/meetings?client=" + (r.client_account_id ?? ""),
        r.client_account_id,
      ),
    })
  }

  // The same pending requests feed BOTH My To-Do and the Time Off card.
  // There is no per-request deep link: the request list is the target.
  const approvalHref = can("/time-off-requests") ? "/time-off-requests" : can("/time-off") ? "/time-off" : null
  const approvals: ApprovalItem[] = []
  for (const r of rowsOf<{
    id: string; requested_by_name: string | null; start_date: string; end_date: string
    request_type: string; total_days: number | null
  }>(approvalsRes)) {
    const start = storedDay(r.start_date)
    const end = storedDay(r.end_date) ?? start
    approvals.push({
      key: r.id,
      requester: r.requested_by_name ?? "Request",
      start: start ?? r.start_date,
      end: end ?? r.end_date,
      totalDays: r.total_days == null ? null : Number(r.total_days),
      requestType: r.request_type,
      href: approvalHref,
    })
    todo.push({
      taskId: null,
      key: "approve:" + r.id,
      kind: "approve",
      urgency: urgencyFor(start, today),
      due: start,
      dueLabel: start && end ? fmtRange(start, end) : null,
      lead: "Approve time off — ",
      subject: r.requested_by_name ?? "Request",
      sub: r.request_type,
      href: approvalHref,
    })
  }

  const todoSorted = sortByDue(todo)

  // ── Open Tasks ───────────────────────────────────────────────────────────
  type TaskRow = {
    task_id: string; subject: string | null; client_account_id: string | null
    client_account_name: string | null; client_ticker: string | null
    owner_id: string | null; owner_name: string | null; due_date: string | null
  }
  const taskHref = (accountId: string | null) =>
    or("/tasks", "/tasks?client=" + (accountId ?? ""), accountId)
  const tasks: TaskItem[] = rowsOf<TaskRow>(myTasksRes).map((t) => ({
    taskId: t.task_id,
    key: t.task_id,
    mine: true,
    subject: t.subject ?? "Task",
    client: t.client_ticker ?? t.client_account_name,
    assignee: null,
    role: null,
    due: storedDay(t.due_date),
    href: taskHref(t.client_account_id),
  }))
  const seen = new Set(tasks.map((t) => t.key))
  for (const t of rowsOf<TaskRow>(teamTasksRes)) {
    if (seen.has(t.task_id) || !t.owner_id || !t.client_account_id) continue
    // Only someone on THIS client's team — not a teammate from another client.
    const roles = memberRoles.get(t.owner_id)?.get(t.client_account_id)
    if (!roles) continue
    tasks.push({
      taskId: t.task_id,
      key: t.task_id,
      mine: false,
      subject: t.subject ?? "Task",
      client: t.client_ticker ?? t.client_account_name,
      assignee: t.owner_name ?? memberName.get(t.owner_id) ?? null,
      role: roles.join(", "),
      due: storedDay(t.due_date),
      href: taskHref(t.client_account_id),
    })
  }
  // Mine first, then Team; each by due date.
  const tasksSorted = [...sortByDue(tasks.filter((t) => t.mine)), ...sortByDue(tasks.filter((t) => !t.mine))]

  // ── Active Marketing ─────────────────────────────────────────────────────
  const marketing: MarketingItem[] = rowsOf<{
    event_id: string; event_name: string | null; client_account_id: string
    client_account_name: string | null; ticker: string | null; of_slots: number | null
    slots_remaining: number | null; confirmed_meeting_count: number | null
    event_dates: string | null; urgency: string | null
  }>(marketingRes)
    .map((e) => ({
      key: e.event_id,
      client: e.client_account_name ?? "Client",
      ticker: e.ticker,
      eventName: e.event_name,
      booked: Number(e.confirmed_meeting_count ?? 0),
      required: Number(e.of_slots ?? 0),
      open: Math.max(0, Number(e.slots_remaining ?? 0)),
      dates: e.event_dates,
      urgency: e.urgency,
      href: or("/live-outreach", "/live-outreach#event-" + e.event_id, e.client_account_id),
    }))
    .sort((a, b) => b.open - a.open || a.client.localeCompare(b.client))

  // ── Contracts Expiring Soon ──────────────────────────────────────────────
  const contracts: ContractItem[] = []
  for (const c of rowsOf<{
    contract_id: string; account_id: string; client_name: string | null; client_ticker: string | null
    notice_date: string | null; term_end: string | null; auto_renew: boolean | null; is_test: boolean | null
  }>(contractsRes)) {
    if (c.is_test) continue
    const notice = storedDay(c.notice_date)
    const termEnd = storedDay(c.term_end)
    const key = contractKeyDay(notice, termEnd, today)
    if (!key) continue
    contracts.push({
      key: c.contract_id,
      client: c.client_name ?? "Client",
      ticker: c.client_ticker,
      noticeDay: notice,
      termEndDay: termEnd,
      autoRenew: c.auto_renew,
      daysLeft: daysUntil(key, today) ?? 0,
      href: can("/admin/contracts")
        ? "/admin/contracts?client=" + c.account_id
        : or("/contract-management", "/contract-management", c.account_id),
    })
  }
  contracts.sort((a, b) => a.daysLeft - b.daysLeft)

  // ── Onboarding ───────────────────────────────────────────────────────────
  const onboarding: OnboardingItem[] = rowsOf<Record<string, unknown>>(onboardingRes).map((o) => ({
    accountId: String(o.account_id),
    name: String(o.name ?? "Client"),
    ticker: (o.ticker_symbol as string | null) ?? null,
    steps: ONBOARDING_STEPS.map(([k, label]) => ({ label, done: o[k] === true })),
    days: (o.days_onboarding as number | null) ?? null,
    href: or("/onboarding", "/onboarding", String(o.account_id)),
  }))

  // ── My Book strip ────────────────────────────────────────────────────────
  const groups: BookGroup[] = TEAM_ROLES.map((r) => ({
    role: r.key,
    label: r.key === "account_manager" ? "Primary" : r.label,
    clients: book
      .filter((a) => team.mode === "filter" && team.rolesByAccount.get(a.account_id)?.includes(r.key))
      .map((a) => ({
        accountId: a.account_id,
        ticker: a.ticker_symbol,
        name: a.name ?? "Client",
        href: clientHref(a.account_id),
      }))
      .sort((x, y) => (x.ticker ?? x.name).localeCompare(y.ticker ?? y.name)),
  })).filter((g) => g.clients.length > 0)

  return {
    today,
    firstName: (identity.name ?? "").trim().split(/\s+/)[0] || null,
    viewerUnresolved: !viewer.resolved,
    book: { count: book.length, groups, portfolioHref: can("/portfolio") ? "/portfolio" : null },
    todo: capped(todoSorted, errOf(collectRes, reviewRes, claimedRes, profilesRes, hostRes, approvalsRes)),
    tasks: capped(tasksSorted, errOf(myTasksRes, teamTasksRes)),
    marketing: capped(marketing, errOf(marketingRes)),
    contracts: capped(contracts, errOf(contractsRes)),
    onboarding: capped(onboarding, errOf(onboardingRes)),
    approvals: capped(approvals, errOf(approvalsRes)),
    hostSoon,
    canOpenTasks: can("/tasks"),
    links: {
      tasks: can("/tasks") ? "/tasks" : null,
      liveOutreach: can("/live-outreach") ? "/live-outreach" : null,
      contracts: can("/admin/contracts") ? "/admin/contracts" : can("/contract-management") ? "/contract-management" : null,
      onboarding: can("/onboarding") ? "/onboarding" : null,
      timeOff: approvalHref,
    },
  }
}
