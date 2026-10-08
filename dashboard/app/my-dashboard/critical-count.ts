import { cache } from "react"

import { getSupabaseServer } from "@/lib/supabase"
import { TEAM_ROLES, resolveAccountTeamScope } from "@/lib/access/account-team-scope"
import { personIdsReviewedBy } from "@/lib/time-off-requests/reviewers"
import { viewerUserIds } from "@/app/clients/alerts/load"
import { easternToday } from "@/app/clients/alerts/alerts-policy"
import { NOT_FEEDBACK, coreTeamAccountIds, teamMembersOf, type AccountRow } from "./load"
import { criticalDueBefore, criticalMeetingBefore } from "./policy"

/**
 * The count behind the red badge on the My Dashboard nav item: every row the
 * page flags CRITICAL (the big red "!" circle), for the EFFECTIVE viewer.
 *
 * ── IT MUST AGREE WITH THE PAGE ────────────────────────────────────────────
 * Same resolvers (viewerUserIds, resolveAccountTeamScope, personIdsReviewedBy),
 * same task filter (NOT_FEEDBACK), same team-member rule (teamMembersOf), and
 * the row flag's own rule as a date cutoff (criticalDueBefore /
 * criticalMeetingBefore — their equivalence to isCritical is asserted in
 * policy.test.ts). What counts:
 *   1. Feedback to Collect — meeting day + 10 is 7+ days past.
 *   2. Reports · Pending Review (core team only) — report due 7+ days past.
 *   3. Reports · Open / Claimed — report due 7+ days past.
 *   4. Other Open Tasks (Mine + Team, feedback tasks excluded) — due 7+ days past.
 *   5. Time Off Approvals — EVERY pending request awaiting me (always critical).
 * Profiles to Review reads upcoming meetings only, so it can never be critical.
 *
 * ── CHEAP, BECAUSE IT RUNS ON EVERY PAGE ───────────────────────────────────
 * Head-only counts (no rows) except Team tasks, which fetch just the few
 * critical candidates (3 small columns) for the per-client team check. One
 * Promise.all after the resolvers; memoised per request. Fail-soft: a failed
 * part counts 0 — the badge must never break a page.
 *
 * SECURITY: per-request memo only (React cache) — never promote to a
 * module-level cache keyed by email, or one user would see another's count.
 */
export const loadMyDashboardCriticalCount = cache(async (effectiveEmail: string | null): Promise<number> => {
  if (!effectiveEmail) return 0
  const sb = getSupabaseServer()
  const today = easternToday()
  const dueCut = criticalDueBefore(today) + "T00:00:00+00:00"
  const mtgCut = criticalMeetingBefore(today) + "T00:00:00+00:00"

  const [viewer, team, accountsRes] = await Promise.all([
    viewerUserIds(effectiveEmail),
    resolveAccountTeamScope({ email: effectiveEmail }),
    sb.from("accounts").select(["account_id", "state_label", ...TEAM_ROLES.map((r) => r.idColumn)].join(",")),
  ])
  const ids = viewer.ids
  const myIds = new Set(ids)
  const teamAccountIds = team.mode === "filter" ? [...team.accountIds] : []
  const accounts = (accountsRes.data ?? []) as unknown as AccountRow[]
  const teamSet = new Set(teamAccountIds)
  // Pending Review: CORE team only, exactly as the card.
  const reviewAccountIds = coreTeamAccountIds(team)
  const book = accounts.filter((a) => teamSet.has(a.account_id) && a.state_label === "Active")
  const bookIds = book.map((a) => a.account_id)
  const { memberRoles } = teamMembersOf(book, myIds)
  const memberIds = [...memberRoles.keys()]

  const HEAD = { count: "exact" as const, head: true }
  const zero = Promise.resolve({ count: 0 })

  const [collect, review, claimed, mine, teamRows, approvals] = await Promise.all([
    ids.length
      ? sb.from("v_feedback_outstanding").select("*", HEAD).in("host_id", ids).lt("meeting_date", mtgCut)
      : zero,
    reviewAccountIds.length
      ? sb
          .from("v_feedback_pipeline")
          .select("*", HEAD)
          .eq("category", "pending_review")
          .in("client_account_id", reviewAccountIds)
          .lt("due_date", dueCut)
      : zero,
    ids.length
      ? sb
          .from("v_feedback_pipeline")
          .select("*", HEAD)
          .eq("category", "in_progress")
          .in("claimed_by_id", ids)
          .lt("due_date", dueCut)
      : zero,
    ids.length
      ? sb
          .from("v_admin_tasks_all")
          .select("*", HEAD)
          .eq("state_label", "Open")
          .or(NOT_FEEDBACK)
          .in("owner_id", ids)
          .lt("due_date", dueCut)
      : zero,
    bookIds.length && memberIds.length
      ? sb
          .from("v_admin_tasks_all")
          .select("task_id, owner_id, client_account_id")
          .eq("state_label", "Open")
          .or(NOT_FEEDBACK)
          .in("client_account_id", bookIds)
          .in("owner_id", memberIds)
          .lt("due_date", dueCut)
          .limit(500)
      : Promise.resolve({ data: [] }),
    (async () => {
      if (!ids.length) return { count: 0 }
      const people = ((await personIdsReviewedBy(ids)) ?? []).filter((p) => !myIds.has(p))
      if (!people.length) return { count: 0 }
      return sb
        .from("time_off_requests")
        .select("*", HEAD)
        .eq("status", "Pending")
        .eq("origin", "dashboard")
        .in("requested_by_id", people)
    })(),
  ])

  // Team: only someone on THAT client's team — the page's exact rule.
  const team_ = ((teamRows as { data: unknown }).data ?? []) as {
    owner_id: string | null
    client_account_id: string | null
  }[]
  const teamCount = team_.filter(
    (t) => t.owner_id && t.client_account_id && memberRoles.get(t.owner_id)?.has(t.client_account_id),
  ).length

  const n = (r: unknown) => ((r as { count?: number | null }).count ?? 0) || 0
  return n(collect) + n(review) + n(claimed) + n(mine) + teamCount + n(approvals)
})
