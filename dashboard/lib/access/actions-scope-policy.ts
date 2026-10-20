/**
 * ROW-SCOPING rules for the Actions CRM tables — Tasks, Touchpoints, Notes —
 * PURE, no I/O, so every visibility decision is unit-testable (see
 * actions-scope-policy.test.ts). The resolver that reads the database and
 * applies these lives beside it in ./actions-scope.ts.
 *
 * A row is visible iff ANY of:
 *   (a) the viewer is on the row's client's CORE account team — Primary,
 *       Secondary, Associate, Logistics (Feedback Report / Memo do NOT count);
 *   (b) the viewer owns it — task: owner, creator or current assignment;
 *       touchpoint: creator; note: owner or creator;
 *   (c) the viewer has super-user privileges (super_user OR admin) → all rows;
 *   (d) the row is an EXEMPT type — a feedback-report task (sub-types Feedback,
 *       Feedback Report Sent) or a Data Upload task (the whole sub-type).
 *
 * This is ROW visibility only. Which people may OPEN these pages is decided
 * elsewhere (canAccessRoute / ADMIN_ONLY_ROUTES) and is not changed here.
 *
 * FAILS CLOSED: an unresolvable team contributes no client ids (→ own rows +
 * exempt types only); an unresolvable identity contributes no user ids either
 * (→ exempt types only); a column the deployed view lacks is simply left out
 * of the predicate (→ fewer rows, never more). There is no path that widens.
 */

import type { AccountTeamScope, TeamRole } from "./account-team-policy"

export type ActionsEntity = "tasks" | "touchpoints" | "notes"

/** Task sub-types visible to everyone, whoever owns them (rule d). */
export const ACTIONS_EXEMPT_TASK_SUBTYPES = ["Feedback", "Feedback Report Sent", "Data Upload"] as const

/**
 * The CORE account team — the four roles that confer visibility. Same four as
 * My Dashboard's CORE_TEAM_ROLES (app/my-dashboard/load.ts).
 */
export const ACTIONS_CORE_TEAM_ROLES: readonly TeamRole[] = [
  "account_manager",
  "secondary_manager",
  "associate",
  "logistics",
]

/**
 * Per-entity columns on its v_admin_*_all view. Touchpoints have no "owner"
 * person: their CRM owner_id is a per-client TEAM record, never a user, so the
 * creator is the owner there.
 */
export const ACTIONS_SCOPE_RULES: Record<
  ActionsEntity,
  {
    idColumn: string
    clientColumn: string
    ownerColumns: readonly string[]
    exempt: { column: string; values: readonly string[] } | null
  }
> = {
  tasks: {
    idColumn: "task_id",
    clientColumn: "client_account_id",
    // current_assignment_id needs sql/patches/2026-10-20_tasks_current_assignment.sql;
    // until then the view lacks it and it is dropped (narrower, never wider).
    ownerColumns: ["owner_id", "created_by_id", "current_assignment_id"],
    exempt: { column: "task_subtype_label", values: ACTIONS_EXEMPT_TASK_SUBTYPES },
  },
  touchpoints: {
    idColumn: "touchpoint_id",
    clientColumn: "client_account_id",
    ownerColumns: ["created_by_id"],
    exempt: null,
  },
  notes: {
    idColumn: "note_id",
    clientColumn: "client_account_id",
    ownerColumns: ["owner_id", "created_by_id"],
    exempt: null,
  },
}

/**
 * The resolved scope for the effective viewer:
 *   - `all`    → super_user / admin; no filter.
 *   - `filter` → the viewer's CORE-team client ids and their (unioned) CRM
 *                user ids. Either list may be empty — that is the fail-closed
 *                state, not an error.
 */
export type ActionsScope =
  | { mode: "all" }
  | { mode: "filter"; accountIds: readonly string[]; userIds: readonly string[] }

/** The accounts where the viewer holds one of the four CORE roles. */
export function coreAccountIdsOf(team: AccountTeamScope): string[] {
  if (team.mode !== "filter") return []
  return [...team.accountIds].filter((id) =>
    team.rolesByAccount.get(id)?.some((k) => ACTIONS_CORE_TEAM_ROLES.includes(k)),
  )
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Only UUID-shaped ids ever reach PostgREST grammar. */
function uuids(ids: readonly string[]): string[] {
  return [...new Set(ids.filter((id) => UUID.test(id)))]
}

/**
 * The PostgREST `.or()` argument for a `filter` scope — the ONE predicate every
 * surface applies. `available` = the deployed view's columns (null = cannot
 * tell; every column is then assumed present, and a missing one makes the
 * query ERROR, which callers treat as deny).
 *
 * With nothing to match it returns `<id>.is.null`, which no row satisfies — a
 * deny-all clause rather than an empty (unfiltered) one.
 */
export function actionsScopeOrClause(
  entity: ActionsEntity,
  scope: { accountIds: readonly string[]; userIds: readonly string[] },
  available: ReadonlySet<string> | null,
): string {
  const rule = ACTIONS_SCOPE_RULES[entity]
  const has = (col: string) => available === null || available.has(col)
  const parts: string[] = []

  const accounts = uuids(scope.accountIds)
  if (accounts.length && has(rule.clientColumn)) {
    parts.push(`${rule.clientColumn}.in.(${accounts.join(",")})`)
  }
  const users = uuids(scope.userIds)
  if (users.length) {
    for (const col of rule.ownerColumns) {
      if (has(col)) parts.push(`${col}.in.(${users.join(",")})`)
    }
  }
  if (rule.exempt && has(rule.exempt.column)) {
    // Constant values (never user input); double-quoted for the spaces.
    parts.push(`${rule.exempt.column}.in.(${rule.exempt.values.map((v) => `"${v}"`).join(",")})`)
  }

  return parts.length ? parts.join(",") : `${rule.idColumn}.is.null`
}
