import "server-only"

import { getSupabaseServer } from "@/lib/supabase"
import { getEffectiveIdentity, getEffectiveRole } from "@/lib/effective-identity"
import { resolveAccountTeamScope } from "@/lib/access/account-team-scope"
import { hasSuperUserPrivileges } from "@/lib/access-control"
import { canReadCrmPage } from "@/lib/crm-write"

/**
 * WHO MAY VIEW AN EVENT (2026-10-16) — the read gate for the event drawer's
 * Meetings & Reports tab loaders, so that tab is readable by exactly the
 * people who can open the event's drawer:
 *
 *   - super-user privileges (super user / admin);
 *   - the CRM Events page granted (canReadCrmPage("/events") — every event,
 *     no row scoping), the drawer on /events;
 *   - My Dashboard's scope (dashboardEventInScope): an event in Live Outreach
 *     whose client is on the viewer's account team — loadDashboardEventRecord.
 *
 * READ ONLY. It grants no action: every write keeps its own gate.
 * Effective (View-as-aware) role and identity throughout.
 */
export async function canViewEvent(eventId: string): Promise<boolean> {
  const role = await getEffectiveRole()
  if (hasSuperUserPrivileges(role)) return true
  if (!role) return false
  if (await canReadCrmPage("/events")) return true
  return (await dashboardEventInScope(eventId)) === true
}

/**
 * My Dashboard's Active Marketing scope for a non-super viewer: the event is in
 * Live Outreach (v_live_outreach) and its client is on the viewer's account
 * team. true / false, or an error message when the read fails (fail closed).
 */
export async function dashboardEventInScope(eventId: string): Promise<boolean | string> {
  if (!eventId) return false
  const scope = await resolveAccountTeamScope(await getEffectiveIdentity())
  if (scope.mode !== "filter" || scope.accountIds.size === 0) return false
  const { data, error } = await getSupabaseServer()
    .from("v_live_outreach")
    .select("event_id, client_account_id")
    .eq("event_id", eventId)
    .limit(1)
  if (error) return error.message
  const row = (data ?? [])[0] as { client_account_id: string | null } | undefined
  return !!row?.client_account_id && scope.accountIds.has(row.client_account_id)
}
