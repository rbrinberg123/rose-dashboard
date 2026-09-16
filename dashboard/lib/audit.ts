import "server-only"

/**
 * The audit trail. ONE function, called by every write in the app.
 *
 * ══ THE RULE ═══════════════════════════════════════════════════════════════
 * EVERY server action or route handler that inserts, updates or deletes data on
 * a person's behalf MUST call `recordAudit` after the mutation succeeds. No
 * exceptions, and no second logging mechanism — if it is not in `audit_log`, it
 * did not happen as far as the trail is concerned.
 *
 * Adding a write feature? Three lines:
 *
 *     const before = await readRow(id)          // for update/delete
 *     ... the existing mutation ...
 *     await recordAudit({
 *       action: "update",
 *       entity: "my_table",
 *       recordId: id,
 *       changes: diffRows(before, patch),
 *     })
 *
 * See content/docs/18-audit-trail.md.
 *
 * ══ WHAT IS DELIBERATELY NOT AUDITED ═══════════════════════════════════════
 * Background machinery that writes on a SCHEDULE rather than on a person's
 * behalf: the nightly Dynamics sync (lib/sync/run.ts — tens of thousands of
 * mirror upserts a night), the deletion-reconciliation sweep's own bookkeeping
 * (lib/sync/reconcile.ts), and the cron send log. Those already have purpose-
 * built run logs (`sync_runs`, `sync_errors`, `reconcile_runs`) and putting
 * them here would bury the human trail under machine noise. A HUMAN acting on
 * something the sync produced — dismissing a deletion candidate, say — IS
 * audited, because that is a person making a decision.
 *
 * ══ IT MUST NEVER BREAK A SAVE ═════════════════════════════════════════════
 * `recordAudit` never throws and never returns an error. If the insert fails —
 * the table does not exist yet, the database is briefly unreachable — it warns
 * on the server console and returns. A user's save must not fail because the
 * logging did.
 *
 * That is a deliberate trade: completeness of the trail is sacrificed to
 * availability of the app. It is the right way round here because the trail is
 * a record of what the app did, not a control on what it may do — nothing
 * grants or denies access based on it. If this ever becomes a compliance
 * control rather than a history, revisit this decision explicitly.
 */

import { cookies } from "next/headers"

import { getSupabaseServer } from "@/lib/supabase"
import { getSupabaseServerAuth } from "@/lib/supabase/server"
import { lookupPerson } from "@/lib/impersonation"
import { VIEW_AS_USER_COOKIE } from "@/lib/access-control"

export type AuditAction = "create" | "update" | "delete"

/** A field-level diff: only the fields that actually changed. */
export type AuditDiff = Record<string, { old: unknown; new: unknown }>

export type RecordAuditInput = {
  action: AuditAction
  /** The table or feature being changed, e.g. "account_team_members". */
  entity: string
  /**
   * The row's identity. Stored as text so a uuid, a bigint id, or a composite
   * key ("role:client_manager|route:/portfolio") all fit one column.
   */
  recordId: string | number | null
  /**
   * update        → a field-level diff from `diffRows`
   * create/delete → the full row snapshot
   */
  changes?: unknown
  /** Short breadcrumb — which page, which bulk run. */
  context?: string
}

/**
 * Who is doing this, resolved SERVER-SIDE from the verified session.
 *
 * ── THE ACTOR IS THE REAL PERSON, NOT THE IMPERSONATED ONE ─────────────────
 * `getEffectiveIdentity()` returns the IMPERSONATED person while a super-user
 * is in "View as", which is right for deciding what they may see and wrong for
 * recording who did something — it would file a super-user's action under
 * somebody else's name, which is precisely the attribution an audit trail
 * exists to prevent.
 *
 * So this reads the real signed-in user straight from Supabase Auth (the
 * authenticity check itself, not a cookie) and, when a View-as cookie is
 * present, notes it in the context instead. Today every impersonation-capable
 * write is already refused while impersonating; this makes the trail correct
 * regardless of whether that stays true.
 */
async function resolveActor(): Promise<{
  userId: string | null
  email: string | null
  impersonating: string | null
}> {
  try {
    const supabase = await getSupabaseServerAuth()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    const email = user?.email ?? null

    let impersonating: string | null = null
    try {
      impersonating = (await cookies()).get(VIEW_AS_USER_COOKIE)?.value ?? null
    } catch {
      // No cookie store (a cron-invoked route handler). Not an error.
    }

    const person = email ? await lookupPerson(email) : null
    return { userId: person?.userId ?? null, email, impersonating }
  } catch {
    // A cron-triggered run has no session at all. Log it with a null actor
    // rather than losing the event.
    return { userId: null, email: null, impersonating: null }
  }
}

/**
 * Append one row to the audit trail.
 *
 * Call it AFTER the mutation has succeeded — a logged change that did not
 * happen is worse than an unlogged one that did, because the first is wrong and
 * the second is merely incomplete.
 */
export async function recordAudit(input: RecordAuditInput): Promise<void> {
  try {
    const actor = await resolveActor()

    const context = [input.context, actor.impersonating ? `view-as:${actor.impersonating}` : null]
      .filter(Boolean)
      .join(" · ")

    const { error } = await getSupabaseServer().from("audit_log").insert({
      actor_user_id: actor.userId,
      actor_email: actor.email,
      action: input.action,
      entity: input.entity,
      record_id: input.recordId === null ? null : String(input.recordId),
      changes: input.changes ?? null,
      context: context || null,
    })

    if (error) {
      // Swallowed on purpose — see the header. Warn loudly enough to be found.
      console.warn(
        `[audit] failed to log ${input.action} on ${input.entity}#${input.recordId}: ${error.message}`,
      )
    }
  } catch (err) {
    console.warn(`[audit] failed to log ${input.action} on ${input.entity}:`, err)
  }
}

/**
 * Field-level diff, for updates: `{ field: { old, new } }`, changed fields only.
 *
 * Compares only the keys present in `after` — the fields the write actually
 * touched — so an update of two columns does not report the other thirty as
 * "unchanged" or, worse, as changing to undefined.
 *
 * Returns `null` when nothing changed, which the caller can use to skip logging
 * a no-op save entirely.
 *
 * Values are compared by JSON shape, so a Date and its ISO string, or two
 * equal-but-not-identical objects, do not read as a change.
 */
export function diffRows(
  before: Record<string, unknown> | null | undefined,
  after: Record<string, unknown> | null | undefined,
): AuditDiff | null {
  if (!after) return null
  const out: AuditDiff = {}
  for (const [key, next] of Object.entries(after)) {
    const prev = before ? before[key] : undefined
    if (!sameValue(prev, next)) out[key] = { old: prev ?? null, new: next ?? null }
  }
  return Object.keys(out).length > 0 ? out : null
}

function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (a == null && b == null) return true
  if (a == null || b == null) return false
  return JSON.stringify(a) === JSON.stringify(b)
}

/**
 * A row snapshot for a create or a delete, with noisy internals dropped.
 *
 * `_raw` in particular would put an entire Dynamics payload into every log row;
 * the mirror already holds it and the trail does not need a second copy.
 */
export function snapshot(row: Record<string, unknown> | null | undefined): Record<string, unknown> | null {
  if (!row) return null
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(row)) {
    if (k === "_raw" || k === "_synced_at") continue
    out[k] = v
  }
  return out
}
