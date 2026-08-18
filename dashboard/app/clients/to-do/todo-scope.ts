/**
 * PURE client-scoping helpers for the Clients → To-Do List page — no I/O, so
 * the enforcement decisions are unit-testable (see todo-scope.test.ts).
 *
 * The To-Do List is a CLIENT-level page, so it uses the same Level-2 model as
 * Portfolio / Client Detail: `resolveClientScope` returns
 *   - `null`      → see every active client,
 *   - a `Set`     → see only those account ids,
 *   - empty `Set` → see nothing (deny).
 *
 * The service-role key bypasses RLS, so the SERVER is the only gate. Two places
 * need it and both live here:
 *   - `decideTodoLoad`   — what the loader should query (deny / all / filter).
 *   - `visibleTodoRows`  — a defence-in-depth re-filter of whatever came back,
 *                          so a query that somehow returns out-of-scope rows
 *                          still can't render them.
 *   - `canEditClientNote`— the WRITE gate for the inline note action, so a user
 *                          can't save a note against a client they can't see.
 */

import type { ClientScope } from "@/lib/access/client-scope-policy"

/** What the To-Do loader should do for a resolved scope. */
export type TodoLoad =
  /** Nothing to show — render the "no clients assigned" empty state. */
  | { mode: "deny" }
  /** No client filter — query every active client. */
  | { mode: "all" }
  /** Query only these account ids. Never empty (that case is `deny`). */
  | { mode: "filter"; accountIds: string[] }

export function decideTodoLoad(scope: ClientScope): TodoLoad {
  if (scope === null) return { mode: "all" }
  if (scope.size === 0) return { mode: "deny" }
  return { mode: "filter", accountIds: [...scope] }
}

/**
 * The subset of `rows` the scope permits. Fail-closed: an empty scope drops
 * everything, and a row with no account id is never visible to a scoped user
 * (it can't be proven in-scope).
 */
export function visibleTodoRows<T extends { account_id: string | null }>(
  rows: readonly T[],
  scope: ClientScope,
): T[] {
  if (scope === null) return [...rows]
  return rows.filter((r) => r.account_id != null && scope.has(r.account_id))
}

/**
 * WRITE gate for the inline note. True only when the user may see this client,
 * so saving a note can never reach a client outside the user's account team.
 */
export function canEditClientNote(
  scope: ClientScope,
  accountId: string | null | undefined,
): boolean {
  if (!accountId) return false
  if (scope === null) return true
  return scope.has(accountId)
}
