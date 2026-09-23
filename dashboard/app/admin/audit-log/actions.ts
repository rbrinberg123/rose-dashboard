"use server"

/**
 * Audit Log viewer — the two on-demand READS.
 *
 * ⚠️  THERE IS NO WRITE PATH HERE, AND THERE MUST NEVER BE ONE. `audit_log` is
 * append-only: UPDATE and DELETE are revoked from service_role and blocked by a
 * trigger that raises even for the table owner. The viewer reads; the trail is
 * written only by `recordAudit` in lib/audit.ts, from the actions that actually
 * change something. A "tidy up the log" feature is not a feature.
 *
 * ══ SECURITY ═══════════════════════════════════════════════════════════════
 * Both functions re-check super_user before building a query. The trail records
 * every write in the app — salary edits, permission grants, deleted mirror rows
 * — so it is at least as sensitive as the most sensitive thing it describes.
 * The page gate is not enough on its own: a server action is its own entry
 * point and can be invoked directly.
 */

import { getSupabaseServer } from "@/lib/supabase"
import { getEffectiveRole } from "@/lib/effective-identity"
import { describeError, fail, ok, type ActionResult } from "@/lib/actions"
import {
  changeLines,
  originOf,
  resolveRecord,
  type AuditOrigin,
  type ChangeLine,
  type NameLookup,
  type ResolveContext,
} from "@/lib/audit-log/labels"

/** One entry, with its diff already rendered into readable lines. */
export type AuditRecordDetail = {
  id: number
  occurred_at: string
  actor_email: string | null
  action: string
  entity: string
  record_id: string | null
  context: string | null
  /** The field-by-field old → new list, uuids already resolved to names. */
  lines: ChangeLine[]
  /** The record id made readable — a client name where it resolves to one. */
  recordLabel: string
  /** Set when the record turned out to be account-keyed, for the client link. */
  accountId: string | null
  /** Who authored the audited record — see originOf. */
  origin: AuditOrigin
}

/**
 * One row's full record, INCLUDING `changes` — which the LIST query never
 * selects. A drawer opening reads exactly one row.
 *
 * ── THE DIFF IS RENDERED HERE, NOT IN THE BROWSER ──────────────────────────
 * `changes` is full of raw uuids ("user_id": {"old": null, "new": "a8dce…"}),
 * and turning those into "— → Brian Smith" needs the accounts and users
 * lookups. Doing it server-side means the page never has to ship those two
 * tables (~550 rows) to the browser just so a drawer can read well. The cost is
 * two small extra reads per drawer open, which is the right trade for a panel
 * that opens on a click.
 */
export async function loadAuditRecord(id: number): Promise<ActionResult<AuditRecordDetail>> {
  const role = await getEffectiveRole()
  if (role !== "super_user") return fail("Not authorised.")
  if (!Number.isFinite(id)) return fail("No audit id.")

  const sb = getSupabaseServer()
  const [rowRes, accountsRes, usersRes] = await Promise.all([
    sb
      .from("audit_log")
      .select("id, occurred_at, actor_email, action, entity, record_id, context, changes")
      .eq("id", id)
      .maybeSingle(),
    sb.from("accounts").select("account_id, name"),
    sb.from("users").select("user_id, display_name, email"),
  ])

  if (rowRes.error) return fail(describeError(rowRes.error))
  if (!rowRes.data) return fail("Audit entry not found.")

  const accounts: NameLookup = {}
  for (const a of (accountsRes.data ?? []) as { account_id: string; name: string | null }[]) {
    if (a.name) accounts[a.account_id] = a.name
  }
  const people: NameLookup = {}
  for (const u of (usersRes.data ?? []) as {
    user_id: string
    display_name: string | null
    email: string | null
  }[]) {
    people[u.user_id] = u.display_name?.trim() || u.email || "(unknown)"
  }
  const ctx: ResolveContext = { people, accounts }

  const row = rowRes.data as unknown as {
    id: number
    occurred_at: string
    actor_email: string | null
    action: string
    entity: string
    record_id: string | null
    context: string | null
    changes: unknown
  }

  const resolved = resolveRecord(row.entity, row.record_id, ctx)

  return ok({
    id: row.id,
    occurred_at: row.occurred_at,
    actor_email: row.actor_email,
    action: row.action,
    entity: row.entity,
    record_id: row.record_id,
    context: row.context,
    lines: changeLines(row.changes, ctx),
    recordLabel: resolved.label,
    accountId: resolved.accountId,
    origin: originOf(row.changes, row.context),
  })
}

/**
 * The distinct actors, for the Actor dropdown.
 *
 * Fetched by the CLIENT after the table renders, never by the page loader —
 * nothing on screen needs a dropdown's contents in order to paint a table.
 *
 * ── WHY THIS IS A CAPPED SCAN AND NOT A VIEW ───────────────────────────────
 * The CRM pages get their dropdown values from a dedicated `*_filter_options`
 * view, which does the DISTINCT in Postgres. That is the right pattern at their
 * scale and it is the right pattern here EVENTUALLY — but it would mean another
 * pending SQL patch for a table that currently has zero rows, and the other two
 * dropdowns (Entity, Action) need no query at all because both are closed sets
 * the code already knows.
 *
 * So: read `actor_email` over a capped window and distinct it here. Cheap while
 * the log is small, and the (actor_email, occurred_at) index keeps it ordered
 * work rather than a sort.
 *
 * WHEN TO CHANGE THIS: once the log passes roughly the cap below, this stops
 * seeing every actor. Add `v_admin_audit_filter_options` then — the call site
 * does not change shape.
 */
const ACTOR_SCAN_CAP = 20000

export async function loadAuditActors(): Promise<ActionResult<string[]>> {
  const role = await getEffectiveRole()
  if (role !== "super_user") return fail("Not authorised.")

  const sb = getSupabaseServer()
  const { data, error } = await sb
    .from("audit_log")
    .select("actor_email")
    .not("actor_email", "is", null)
    .order("occurred_at", { ascending: false })
    .limit(ACTOR_SCAN_CAP)

  if (error) return fail(describeError(error))

  const seen = new Set<string>()
  for (const r of (data ?? []) as { actor_email: string | null }[]) {
    if (r.actor_email) seen.add(r.actor_email)
  }
  return ok([...seen].sort((a, b) => a.localeCompare(b)))
}
