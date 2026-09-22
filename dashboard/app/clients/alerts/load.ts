import { getSupabaseServer } from "@/lib/supabase"
import { getEffectiveIdentity } from "@/lib/effective-identity"
import { loadIdentity } from "@/lib/access/identity"
import {
  resolveAccountTeamScope,
  teamRoleLabel,
  type AccountTeamScope,
} from "@/lib/access/account-team-scope"
import type {
  FeedbackOutstandingRow,
  FeedbackPipelineRow,
} from "@/lib/types"
import {
  CRITICAL_AFTER_DAYS,
  addDays,
  countsBySeverity,
  daysSince,
  easternToday,
  severityForDays,
  sortAlertRows,
  storedDay,
  type AlertRow,
  type AlertSeverity,
} from "./alerts-policy"

/**
 * Server loader for /clients/alerts.
 *
 * ── SECURITY ───────────────────────────────────────────────────────────────
 * The app reads with the service-role key, which bypasses RLS, so THIS FILE is
 * the only gate on what a viewer sees. Two different scopes are applied, and
 * both are resolved from the EFFECTIVE identity so "View as {person}" previews
 * them:
 *   Sections 1 and 5 — scoped to the VIEWER (feedback assignee / meeting host).
 *   Sections 2 and 3 — scoped to the viewer's six-role ACCOUNT TEAM
 *                      (lib/access/account-team-scope.ts).
 *
 * ── THERE IS NO SUPER-USER DATA BYPASS ─────────────────────────────────────
 * EVERY viewer is scoped the same way, Super Users and `scope_all` holders
 * included. This page is a personal worklist — "what should *I* chase today" —
 * and an unfiltered firm-wide dump answers a different question badly. A viewer
 * with no assignments and no team memberships correctly sees an empty page;
 * that is the right answer, not a fault.
 *
 * This is SCOPE, not ACCESS. Who may OPEN the page is unchanged and still
 * decided by the role grant (see page.tsx) — a Super User keeps the nav link
 * and can still open it. Only what they see inside has changed.
 *
 * ── SHAPE ──────────────────────────────────────────────────────────────────
 * READ-ONLY. Every section query runs inside ONE Promise.all, so the page costs
 * a single round-trip batch, and every section fails SOFT and on its own: a
 * broken view shows an error strip in that one card instead of blanking the
 * page.
 */

/**
 * Per-section row cap. These sections are small by nature (the largest today is
 * 22 rows for any one person), so this is a guard against a pathological result
 * set, not a paging mechanism — and the card says so when it bites.
 */
export const SECTION_CAP = 100

export type AlertsScopeChip = "you" | "team" | "host"

export type AlertsSection = {
  key: "collection" | "pending_review" | "open_claimed" | "hosting"
  title: string
  scope: AlertsScopeChip
  /** One-line rule caption, showing the threshold. */
  caption: string
  rows: AlertRow[]
  counts: Record<AlertSeverity, number>
  /** Rows dropped by SECTION_CAP (0 normally — these sections are small). */
  truncated: number
  error: string | null
}

export type AlertsData = {
  today: string
  viewerName: string | null
  /** How many accounts the six-role team resolver matched. */
  teamAccountCount: number | null
  /** Team sections are denied outright — viewer holds none of the six roles. */
  teamDenied: boolean
  /**
   * The viewer's email does not resolve to a CRM person, so the two
   * viewer-scoped sections are denied rather than empty. Surfaced so the page
   * says "we could not identify you" instead of the much more dangerous
   * "nothing outstanding".
   */
  viewerUnresolved: boolean
  sections: AlertsSection[]
}

/** Empty section shell, so an errored / denied section still renders its card. */
function emptySection(
  key: AlertsSection["key"],
  title: string,
  scope: AlertsScopeChip,
  caption: string,
  error: string | null = null,
): AlertsSection {
  return {
    key,
    title,
    scope,
    caption,
    rows: [],
    counts: { red: 0, yellow: 0, blue: 0 },
    truncated: 0,
    error,
  }
}

/** Sort, cap, and tally a section's rows. Counts are of ALL rows, not the page. */
function finish(section: AlertsSection, rows: AlertRow[]): AlertsSection {
  const sorted = sortAlertRows(rows)
  return {
    ...section,
    rows: sorted.slice(0, SECTION_CAP),
    counts: countsBySeverity(sorted),
    truncated: Math.max(0, sorted.length - SECTION_CAP),
  }
}

// meeting_date and the CRM date fields are a "+00 wall clock read as-is" (see
// the note in app/profiles/page.tsx), so both formatters run in UTC — that
// prints the stored local time back, never a shifted one.
const DATETIME_FMT = new Intl.DateTimeFormat("en-US", {
  timeZone: "UTC",
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
})
const DATE_FMT = new Intl.DateTimeFormat("en-US", {
  timeZone: "UTC",
  month: "short",
  day: "numeric",
})
function fmtDateTime(iso: string | null | undefined): string | null {
  return iso ? DATETIME_FMT.format(new Date(iso)) : null
}
function fmtDate(iso: string | null | undefined): string | null {
  const day = storedDay(iso)
  return day ? DATE_FMT.format(new Date(day + "T00:00:00Z")) : null
}

/** Drop blanks, so a row never renders a dangling separator. */
function meta(...parts: (string | null | undefined)[]): string[] {
  return parts.filter((p): p is string => typeof p === "string" && p.trim() !== "")
}

/** "You: Feedback, Memo" — which of the six roles the viewer holds on this account. */
function teamLabel(team: AccountTeamScope, accountId: string | null): string | null {
  if (team.mode !== "filter" || !accountId) return null
  const roles = team.rolesByAccount.get(accountId)
  if (!roles || roles.length === 0) return null
  return "You: " + roles.map(teamRoleLabel).join(", ")
}

/**
 * The viewer's own Dynamics user_id set (one person can span duplicate CRM
 * records, so it is a set, not a single id).
 *
 * Fails CLOSED: an unresolvable or ambiguous email yields an EMPTY array, which
 * filters everything out — never an unfiltered query. There is no caller and no
 * role that gets back "everything"; see the note at the top of this file.
 *
 * EXPORTED for ./critical-count.ts (the nav badge), so the badge resolves the
 * viewer through the exact same function the page does — including the
 * duplicate-record union and every fail-closed branch.
 */
export async function viewerUserIds(
  email: string | null,
): Promise<{ ids: string[]; resolved: boolean }> {
  if (!email) return { ids: [], resolved: false }
  const identity = await loadIdentity()
  if (!identity.ok) {
    console.error("[alerts] identity resolver error — denying (fail-closed):", identity.error)
    return { ids: [], resolved: false }
  }
  const res = identity.resolve(email)
  if (res.state === "resolved") return { ids: res.userIds, resolved: true }
  if (res.state === "ambiguous") {
    console.warn("[alerts] ambiguous identity for " + email + " — denying (fail-closed).")
  }
  return { ids: [], resolved: false }
}

export async function loadAlerts(): Promise<AlertsData> {
  const sb = getSupabaseServer()
  const identity = await getEffectiveIdentity()
  const today = easternToday()

  const [viewer, team] = await Promise.all([
    viewerUserIds(identity.email),
    resolveAccountTeamScope(identity),
  ])
  const ids = viewer.ids

  const teamIds = team.mode === "filter" ? [...team.accountIds] : []
  const teamDenied = team.mode === "none"

  // ── the four section queries + one ticker lookup, in ONE parallel batch ──
  // A denied section resolves to `null` instead of querying, so the deny costs
  // no round-trip and can never be confused with an empty result set.
  const denied = Promise.resolve(null)

  const collectionQ = (() => {
    const q = sb
      .from("v_feedback_outstanding")
      .select("*")
      .order("days_since", { ascending: false })
      .order("meeting_id", { ascending: true })
      .limit(SECTION_CAP + 1)
    // In THIS view, host_id carries the FEEDBACK-responsible person
    // (Dynamics bcs_feedback) falling back to the meeting Host — see the view's
    // own comment in sql/03_views.sql and ownerName() in
    // app/feedback/feedback-view.tsx. So "assigned to you" IS host_id; a
    // host/feedback coalesce of our own here would double-count the fallback.
    if (ids.length === 0) return denied
    return q.in("host_id", ids)
  })()

  const pendingQ = (() => {
    if (teamDenied) return denied
    let q = sb.from("v_feedback_pipeline").select("*").eq("category", "pending_review")
    q = q.in("client_account_id", teamIds)
    return q.limit(SECTION_CAP + 1)
  })()

  const claimedQ = (() => {
    if (teamDenied) return denied
    let q = sb
      .from("v_feedback_pipeline")
      .select("*")
      .eq("category", "in_progress")
      // CLAIMED only — an unclaimed open report has nobody to chase, so it is
      // not an alert for this page.
      .not("claimed_by_id", "is", null)
    q = q.in("client_account_id", teamIds)
    return q.limit(SECTION_CAP + 1)
  })()

  // REMOVED FOR NOW — "Profiles — created / under review" was a fifth,
  // informational (blue) section here, reading v_profiles_upcoming filtered to
  // profile_label = 'Created/Under Review' and account-team scoped like sections
  // 2 and 3. It was taken out on 2026-09-22 while the page settles; nothing else
  // consumed it, so the whole section came out cleanly (query, rows, card, and
  // its "Profiles in progress" summary tile). To bring it back, restore it from
  // git — it is the only place v_profiles_upcoming was read on this page, and
  // the section numbering below skips 4 as the reminder.

  const hostingQ = (() => {
    const q = sb
      .from("meetings")
      .select(
        "meeting_id, meeting_date, client_account_id, client_account_name, institution_name, investor_text, is_in_person, host_id, host_name",
      )
      .eq("meeting_status_label", "Confirmed")
      // Drop DEACTIVATED meetings, the same guard v_feedback_outstanding uses:
      // state_label is the Dataverse statecode, distinct from the status above.
      .eq("state_label", "Active")
      .gte("meeting_date", today + "T00:00:00+00:00")
      // Inclusive of the 7th day — the window is "today through today + 7 days".
      .lte("meeting_date", addDays(today, 7) + "T23:59:59+00:00")
      .order("meeting_date", { ascending: true })
      .limit(SECTION_CAP + 1)
    if (ids.length === 0) return denied
    return q.in("host_id", ids)
  })()

  // Tickers for the Hosting section: `meetings` carries the client NAME but no
  // ticker, and the whole accounts table is 228 rows — one bulk read is cheaper
  // than a per-row join. (The two feedback views already carry client_ticker.)
  const tickersQ = sb.from("accounts").select("account_id, ticker_symbol")

  const [collectionRes, pendingRes, claimedRes, hostingRes, tickersRes] =
    await Promise.all([collectionQ, pendingQ, claimedQ, hostingQ, tickersQ])

  const tickerByAccount = new Map(
    ((tickersRes.data ?? []) as { account_id: string; ticker_symbol: string | null }[]).map(
      (a) => [a.account_id, a.ticker_symbol],
    ),
  )

  // ── 1. Feedback Collection — assigned to the viewer ──────────────────────
  let s1 = emptySection(
    "collection",
    "Feedback collection",
    "you",
    "Concluded meetings still missing feedback · red after " +
      CRITICAL_AFTER_DAYS +
      " days past the meeting",
    collectionRes?.error?.message ?? null,
  )
  if (collectionRes && !collectionRes.error) {
    // No re-filtering needed: the view already restricts to CONFIRMED, ACTIVE
    // meetings whose date is in the PAST and whose feedback is not complete.
    // `days_since` is the view's own Eastern day count, rendered as-is.
    const rows: AlertRow[] = ((collectionRes.data ?? []) as FeedbackOutstandingRow[]).map(
      (r) => ({
        key: r.meeting_id,
        severity: severityForDays(r.days_since),
        accountId: r.client_account_id,
        ticker: r.client_ticker,
        clientName: r.client_account_name,
        title: r.institution_name ?? "Feedback outstanding",
        meta: meta(
          r.investor_text,
          fmtDateTime(r.meeting_date),
          r.is_in_person ? "Live" : "Virtual",
          r.host_name ? "Owner: " + r.host_name : null,
          r.feedback_status_label,
        ),
        ageDays: r.days_since,
        sortAt: Date.parse(r.meeting_date) || null,
      }),
    )
    s1 = finish(s1, rows)
  }

  // ── 2. Feedback Reports — pending review (ALWAYS red) ────────────────────
  let s2 = emptySection(
    "pending_review",
    "Feedback reports — pending review",
    "team",
    "Report written and waiting on a reviewer · always critical, no age threshold",
    teamDenied ? null : (pendingRes?.error?.message ?? null),
  )
  if (!teamDenied && pendingRes && !pendingRes.error) {
    const rows: AlertRow[] = ((pendingRes.data ?? []) as FeedbackPipelineRow[]).map((r) => ({
      key: r.task_id,
      // Unconditionally critical — the ONLY section that ignores the age rule.
      severity: "red" as const,
      accountId: r.client_account_id,
      ticker: r.client_ticker,
      clientName: r.client_account_name,
      title: r.event_name,
      meta: meta(
        r.claimed_by_name ? "Reviewer: " + r.claimed_by_name : "Unclaimed",
        teamLabel(team, r.client_account_id) ??
          (r.account_manager_name ? "Acct mgr: " + r.account_manager_name : null),
        r.due_date ? "Due " + fmtDate(r.due_date) : null,
        r.meeting_count ? r.meeting_count + " meetings" : null,
      ),
      // Shown as the age badge for context; it does NOT drive the severity here.
      ageDays: r.days_in_stage,
      sortAt: r.meeting_end ? Date.parse(r.meeting_end) || null : null,
    }))
    s2 = finish(s2, rows)
  }

  // ── 3. Feedback Reports — open & claimed ─────────────────────────────────
  let s3 = emptySection(
    "open_claimed",
    "Feedback reports — open & claimed",
    "team",
    "Claimed but not yet submitted · red after " +
      CRITICAL_AFTER_DAYS +
      " days since feedback received",
    teamDenied ? null : (claimedRes?.error?.message ?? null),
  )
  if (!teamDenied && claimedRes && !claimedRes.error) {
    const rows: AlertRow[] = ((claimedRes.data ?? []) as FeedbackPipelineRow[]).map((r) => {
      // Measured from crdfa_feedback_received_date, surfaced on the view as
      // `received_date` — NOT from days_in_stage. The two agree on today's data,
      // but the rule names the received date, so that is what is scored.
      const age = daysSince(r.received_date, today)
      return {
        key: r.task_id,
        severity: severityForDays(age),
        accountId: r.client_account_id,
        ticker: r.client_ticker,
        clientName: r.client_account_name,
        title: r.event_name,
        meta: meta(
          r.claimed_by_name ? "Claimed by " + r.claimed_by_name : "Unclaimed",
          teamLabel(team, r.client_account_id),
          r.received_date ? "Received " + fmtDate(r.received_date) : "No received date",
          r.due_date ? "Due " + fmtDate(r.due_date) : null,
        ),
        ageDays: age,
        sortAt: r.received_date ? Date.parse(r.received_date) || null : null,
      }
    })
    s3 = finish(s3, rows)
  }

  // ── 4. (removed — see the note beside the queries above) ─────────────────

  // ── 5. Hosting — next 7 days (informational) ─────────────────────────────
  let s5 = emptySection(
    "hosting",
    "Hosting — next 7 days",
    "host",
    "Confirmed meetings you are the host of · informational, soonest first",
    hostingRes?.error?.message ?? null,
  )
  if (hostingRes && !hostingRes.error) {
    type HostingRow = {
      meeting_id: string
      meeting_date: string
      client_account_id: string | null
      client_account_name: string | null
      institution_name: string | null
      investor_text: string | null
      is_in_person: boolean | null
      host_name: string | null
    }
    const rows: AlertRow[] = ((hostingRes.data ?? []) as HostingRow[]).map((r) => ({
      key: r.meeting_id,
      severity: "blue" as const,
      accountId: r.client_account_id,
      ticker: tickerByAccount.get(r.client_account_id ?? "") ?? null,
      clientName: r.client_account_name,
      title: r.institution_name ?? "Meeting",
      meta: meta(
        fmtDateTime(r.meeting_date),
        r.is_in_person ? "Live" : "Virtual",
        r.investor_text,
        // No host name: every row in this section is one YOU host, so printing
        // it would say your own name on every line.
      ),
      ageDays: null,
      sortAt: Date.parse(r.meeting_date) || null,
    }))
    s5 = finish(s5, rows)
  }

  return {
    today,
    viewerName: identity.name,
    teamAccountCount: team.mode === "filter" ? team.accountIds.size : null,
    teamDenied,
    viewerUnresolved: !viewer.resolved,
    sections: [s1, s2, s3, s5],
  }
}
