/**
 * Client DEACTIVATION — the shared, client-safe half (constants + types).
 * The server-side permission gate is lib/accounts/deactivation-gate.ts; the
 * actions are deactivateClient / reactivateClient in app/accounts/actions.ts.
 *
 * ══ MODEL (Option 2 — pre-cutover shortcut) ════════════════════════════════
 * Deactivate sets `accounts.state_label = 'Inactive'` and stamps the
 * dashboard-owned sidecar columns (deactivated_at / _by / deactivation_reason,
 * sql/patches/2026-10-12b_account_deactivation.sql). Reactivate sets it back to
 * 'Active', clears the stamp and records reactivated_at / _by. Because every
 * existing view and query already means `state_label = 'Active'` by "active
 * client", the client leaves (and rejoins) every active surface — counts,
 * Portfolio, Client Detail, the scoped Client pickers
 * (loadActiveAccountOptions) — with no view rewrite. Related records are never
 * touched.
 *
 * That shortcut is only sound for DASHBOARD-origin clients, whose state_label
 * the dashboard already owns (the sync never writes them). For Dynamics-origin
 * clients the sync rewrites state_label from Dynamics, so the planned cutover
 * follow-up is Option 1: a generated `is_active_effective` column
 * (state_label = 'Active' AND deactivated_at IS NULL) with the ~50 views and
 * ~12 code sites repointed at it. See content/docs/20-clients.md.
 *
 * NOT public.account_status — that dashboard-owned flag is inert ("setup
 * only", lib/account-teams/status.ts), overlaps this, and is deliberately not
 * read or written here. Reconcile or remove it later.
 */

/**
 * ══ CUTOVER SWITCH ══════════════════════════════════════════════════════════
 * false = Deactivate / Reactivate are offered and accepted for origin =
 * 'dashboard' clients ONLY. Flip to true at cutover — and NOT before Option 1
 * lands, or the next sync would silently re-activate a deactivated Dynamics
 * client by rewriting its state_label (the DB trigger would then clear the
 * stamp). Checked server-side in deactivation-gate.ts; the UI reads it too,
 * only to explain why the button is missing.
 */
export const DEACTIVATION_INCLUDES_DYNAMICS = false

/** Whether a client of this origin can be deactivated / reactivated at all. */
export function deactivationAllowedForOrigin(origin: string | null | undefined): boolean {
  return origin === "dashboard" || (DEACTIVATION_INCLUDES_DYNAMICS && origin === "dynamics")
}

/** Longest reason accepted from the confirm dialog. */
export const DEACTIVATION_REASON_MAX = 500

/** A client's deactivation state plus what the viewer may do about it. */
export type ClientDeactivationState = {
  accountId: string
  name: string | null
  origin: string | null
  stateLabel: string | null
  deactivatedAt: string | null
  deactivatedBy: string | null
  reason: string | null
  reactivatedAt: string | null
  reactivatedBy: string | null
  /** The viewer passes the permission gate AND the origin gate. */
  canManage: boolean
  /** Why canManage is false, for a quiet note (null when it is true). */
  blockedReason: string | null
}
