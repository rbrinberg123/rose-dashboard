import { cache } from "react"

import { getSupabaseServer } from "@/lib/supabase"
import { hasSuperUserPrivileges } from "@/lib/access-control"
import { getEffectiveIdentity, getEffectiveRole } from "@/lib/effective-identity"
import { availableColumns, type ExtraFilter } from "@/lib/table-views/query"
import type { EntitySpec } from "@/lib/table-views/types"
import { TASKS_SPEC } from "@/lib/tasks/spec"
import { TOUCHPOINTS_SPEC } from "@/lib/touchpoints/spec"
import { NOTES_SPEC } from "@/lib/notes/spec"
import { loadIdentity } from "./identity"
import { resolveAccountTeamScope } from "./account-team-scope"
import {
  ACTIONS_SCOPE_RULES,
  actionsScopeOrClause,
  coreAccountIdsOf,
  type ActionsEntity,
  type ActionsScope,
} from "./actions-scope-policy"

export type { ActionsEntity, ActionsScope } from "./actions-scope-policy"

/**
 * The database side of Tasks / Touchpoints / Notes ROW scoping. The rules (who
 * sees which row, the exempt sub-types, the fail-closed shape) live in
 * ./actions-scope-policy.ts — read its header first.
 *
 * Every surface that lists or opens one of these rows goes through here:
 *   - lists, view counts, the capped-row count and Excel export → pass
 *     `actionsScopeFilter(...)` as (part of) the fetchRows / countRows `extra`;
 *   - drawers, edit loads, edits and closes → `canSeeActionsRow(...)`.
 *
 * View-as aware: the super-user bypass reads the EFFECTIVE role, and team /
 * ownership read the EFFECTIVE identity — so "View as {person}" shows exactly
 * that person's rows. In ROLE View-as the identity is still your own account.
 */

const SPECS: Record<ActionsEntity, EntitySpec> = {
  tasks: TASKS_SPEC,
  touchpoints: TOUCHPOINTS_SPEC,
  notes: NOTES_SPEC,
}

/**
 * The effective viewer's scope, memoised for ONE request (a page asks for it
 * once per count). Never promote to a module-level cache — it is one person's
 * row scope (same rule as getUserScopes in ./data-scope.ts).
 */
export const resolveActionsScope = cache(async (): Promise<ActionsScope> => {
  const [role, identity] = await Promise.all([getEffectiveRole(), getEffectiveIdentity()])
  if (hasSuperUserPrivileges(role)) return { mode: "all" }

  const email = identity.email
  if (!email) return { mode: "filter", accountIds: [], userIds: [] }

  // Ownership: the person's full (unioned) CRM id set. Any doubt → no ids.
  let userIds: string[] = []
  const idx = await loadIdentity()
  if (!idx.ok) {
    console.error("[actions-scope] identity resolver error — exempt rows only (fail-closed):", idx.error)
  } else {
    const res = idx.resolve(email)
    if (res.state === "ambiguous") {
      console.warn(`[actions-scope] ambiguous identity for ${email} — exempt rows only (fail-closed).`)
    } else if (res.state === "resolved") {
      userIds = res.userIds
    }
  }

  // Team: CORE roles only. resolveAccountTeamScope fails closed to `none`.
  const accountIds = coreAccountIdsOf(await resolveAccountTeamScope(identity))
  return { mode: "filter", accountIds, userIds }
})

/** Columns the deployed view has (memoised in production by availableColumns). */
function viewColumns(entity: ActionsEntity) {
  return availableColumns(getSupabaseServer(), SPECS[entity])
}

/**
 * The query-layer filter for one entity's list / count / export. Compose it
 * with any other `extra` (the quick filters). `all` → no-op.
 */
export async function actionsScopeFilter(entity: ActionsEntity): Promise<ExtraFilter> {
  const scope = await resolveActionsScope()
  if (scope.mode === "all") return (q) => q
  const clause = actionsScopeOrClause(entity, scope, await viewColumns(entity))
  return (<Q,>(q: Q): Q =>
    (q as unknown as { or: (f: string) => unknown }).or(clause) as Q) as ExtraFilter
}

/**
 * May the effective viewer see this ONE row? Checked against the entity's view
 * with the very same predicate as the list. Any error → false.
 */
export async function canSeeActionsRow(entity: ActionsEntity, id: string): Promise<boolean> {
  const scope = await resolveActionsScope()
  if (scope.mode === "all") return true
  if (!id) return false
  const rule = ACTIONS_SCOPE_RULES[entity]
  const clause = actionsScopeOrClause(entity, scope, await viewColumns(entity))
  const { data, error } = await getSupabaseServer()
    .from(SPECS[entity].viewName)
    .select(rule.idColumn)
    .eq(rule.idColumn, id)
    .or(clause)
    .maybeSingle()
  if (error) {
    console.error(`[actions-scope] ${entity} row check failed — denying (fail-closed):`, error.message)
    return false
  }
  return !!data
}
