import { cache } from "react"

import { getSupabaseServer } from "@/lib/supabase"
import { resolveAccountTeamScope } from "@/lib/access/account-team-scope"
import { CRITICAL_AFTER_DAYS, criticalCutoffDay, easternToday } from "./alerts-policy"
import { viewerUserIds } from "./load"

/**
 * The count behind the app-wide red badge on the Alerts nav item.
 *
 * ── IT MUST AGREE WITH THE PAGE, ALWAYS ────────────────────────────────────
 * A badge that disagrees with the page it points at is worse than no badge, so
 * nothing here re-derives scoping or severity. It reuses:
 *   - `viewerUserIds` — the page's own viewer resolver (exported from ./load),
 *     including the duplicate-CRM-record union and every fail-closed branch;
 *   - `resolveAccountTeamScope` — the page's own six-role team resolver;
 *   - `criticalCutoffDay` / `CRITICAL_AFTER_DAYS` — the page's own ten-day rule,
 *     expressed as a date cutoff so it can be applied in SQL. The equivalence
 *     of the two forms is asserted in alerts-policy.test.ts.
 * The only thing this file decides for itself is WHICH THREE sections count.
 *
 * ── RED ONLY, AND ONLY THREE SECTIONS ──────────────────────────────────────
 *   1. Feedback collection assigned to the viewer, > 10 days past the meeting.
 *   2. Feedback reports pending review (account team) — always critical.
 *   3. Feedback reports open & claimed (account team), > 10 days since received.
 * Profiles and Hosting are informational — blue, never red — so they are not
 * counted. Yellow "needs attention" items are not counted either.
 *
 * ── CHEAP, BECAUSE IT RUNS ON EVERY PAGE ───────────────────────────────────
 * The nav renders app-wide, so this must never cost what the page costs. It
 * fetches NO ROWS: all three queries are `head: true` + `count: "exact"`, so
 * PostgREST returns a count in the Content-Range header and an empty body. The
 * three run in ONE Promise.all, after the two resolvers (themselves parallel),
 * and the whole function is memoised per request with React `cache()`.
 *
 * A viewer scoped to nothing costs even less: an empty id set or an empty team
 * short-circuits that section to 0 without issuing a query at all.
 */

/**
 * Per-request memo, keyed on the EFFECTIVE email.
 *
 * ── SECURITY: PER-REQUEST ONLY ─────────────────────────────────────────────
 * This is a specific person's scoped count. React's `cache()` is scoped to one
 * request's dispatcher, so a later request for a different user starts cold.
 * Never promote it to a module-level cache keyed by email — that would show one
 * user another user's alert count. Same rule as `getRealRole` in
 * lib/user-role.ts and `loadScopesForEmail` in lib/access/data-scope.ts.
 *
 * Takes the email as an ARGUMENT rather than calling `getEffectiveIdentity()`
 * itself, and that is a deliberate performance decision: the root layout gets
 * its identity from the proxy header precisely to avoid a ~180 ms
 * `auth.getUser()` round trip, and resolving identity again here would hand
 * that cost straight back on every page in the app.
 */
export const loadCriticalAlertCount = cache(
  async (effectiveEmail: string | null): Promise<number> => {
    if (!effectiveEmail) return 0

    const sb = getSupabaseServer()
    const today = easternToday()
    const cutoff = criticalCutoffDay(today)

    const [viewer, team] = await Promise.all([
      viewerUserIds(effectiveEmail),
      resolveAccountTeamScope({ email: effectiveEmail }),
    ])
    const ids = viewer.ids
    const teamIds = team.mode === "filter" ? [...team.accountIds] : []

    // Nothing in scope → 0 without touching the database.
    if (ids.length === 0 && teamIds.length === 0) return 0

    const zero = Promise.resolve({ count: 0 })
    const HEAD = { count: "exact" as const, head: true }

    const [collection, pending, claimed] = await Promise.all([
      // 1. Collection assigned to the viewer, past the threshold. `days_since`
      //    is the view's own Eastern day count — the same number the page reads
      //    — so `> CRITICAL_AFTER_DAYS` is literally severityForDays' red test.
      ids.length === 0
        ? zero
        : sb
            .from("v_feedback_outstanding")
            .select("*", HEAD)
            .in("host_id", ids)
            .gt("days_since", CRITICAL_AFTER_DAYS),

      // 2. Pending review on the viewer's account team. Unconditionally red.
      teamIds.length === 0
        ? zero
        : sb
            .from("v_feedback_pipeline")
            .select("*", HEAD)
            .eq("category", "pending_review")
            .in("client_account_id", teamIds),

      // 3. Open & claimed on the viewer's account team, past the threshold.
      //    `< cutoff` is the SQL form of daysSince(received_date) > 10; a NULL
      //    received_date does not match, which matches the page scoring an
      //    unknown age as yellow rather than red.
      teamIds.length === 0
        ? zero
        : sb
            .from("v_feedback_pipeline")
            .select("*", HEAD)
            .eq("category", "in_progress")
            .not("claimed_by_id", "is", null)
            .in("client_account_id", teamIds)
            .lt("received_date", cutoff + "T00:00:00+00:00"),
    ])

    // Fail-soft: a failed count contributes 0 rather than throwing. The badge is
    // an ornament on the nav — it must never be able to break every page in the
    // app, and under-counting is the safe direction for a "look over here" cue.
    return (collection.count ?? 0) + (pending.count ?? 0) + (claimed.count ?? 0)
  },
)
