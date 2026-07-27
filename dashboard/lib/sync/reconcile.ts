/**
 * Deletion-reconciliation sweep.
 *
 * The nightly sync (./run.ts) is incremental (`modifiedon gt watermark`) and
 * upsert-only, so a HARD delete in Dynamics never propagates — the mirror row
 * is simply never touched again and lingers forever. This sweep closes that
 * gap WITHOUT ever deleting anything itself:
 *
 *   1. Pull the full set of live primary keys per entity from Dynamics (a
 *      read-only $select={idField} full pull — see fetchAllIds).
 *   2. Diff them against the mirror-table primary keys.
 *   3. Flag mirror rows whose pk is absent from the live set into the
 *      `deletion_candidates` review queue for a human to approve/keep.
 *
 * SAFETY GUARD (the whole reason this is a queue, not an auto-delete): if the
 * live-ID fetch errored, or it returned ZERO ids while the mirror table still
 * has rows, that entity is skipped entirely and the skip is recorded as an
 * error. A transient Dynamics outage can therefore never queue an entire table
 * for deletion.
 *
 * Reappearances self-heal: any candidate still `pending`/`dismissed` whose pk
 * shows up in a later live pull is removed from the queue — it was never really
 * deleted.
 *
 * Mirrors runSync's shape: entities run sequentially and independently, and the
 * function returns a per-entity summary. All writes here are to Supabase
 * bookkeeping tables (deletion_candidates, reconcile_runs) — Dynamics is only
 * ever read.
 */

import type { SupabaseClient } from "@supabase/supabase-js"
import { getSupabaseServer } from "@/lib/supabase"
import { fetchAllIds } from "./dynamics"
import { ENTITIES, type EntityConfig } from "./entities"

/** PostgREST caps a single response at 1000 rows; page the mirror keys in this size. */
const PAGE = 1000
/** Chunk size for `.in()` filters so the query string stays well under URL limits. */
const IN_CHUNK = 150

export type ReconcileEntityResult = {
  entity: string
  /** Mirror rows scanned. */
  checked: number
  /** Live ids pulled from Dynamics. */
  liveCount: number
  /** New candidates inserted this sweep. */
  newlyFlagged: number
  /** Existing candidates whose last_seen_missing_at was bumped. */
  bumped: number
  /** Candidates removed because their pk reappeared in Dynamics. */
  reappeared: number
  /** True when the safety guard skipped this entity (see message). */
  skipped: boolean
  message?: string
}

export type ReconcileResult = {
  runStartedAt: string
  finishedAt: string
  entities: ReconcileEntityResult[]
}

const skipped = (
  entity: string,
  message: string,
  liveCount = 0,
  checked = 0,
): ReconcileEntityResult => ({
  entity,
  checked,
  liveCount,
  newlyFlagged: 0,
  bumped: 0,
  reappeared: 0,
  skipped: true,
  message,
})

// -----------------------------------------------------------------------------
// Human-readable labels for the queue. Each takes a mirror row and returns a
// short one-liner so an admin can recognise what they're about to delete.
// -----------------------------------------------------------------------------

const s = (v: unknown): string | null => {
  if (v === null || v === undefined) return null
  const str = String(v).trim()
  return str === "" ? null : str
}

/** ISO datetime/date → YYYY-MM-DD, or null. */
const day = (v: unknown): string | null => {
  const str = s(v)
  return str ? str.slice(0, 10) : null
}

/** Join the non-empty parts with a separator. */
const join = (parts: (string | null)[], sep = " · "): string =>
  parts.filter((p): p is string => !!p).join(sep)

function labelFor(entityName: string, row: Record<string, unknown>): string {
  switch (entityName) {
    case "accounts": {
      const name = s(row.name)
      const ticker = s(row.ticker_symbol)
      return join([name, ticker ? `(${ticker})` : null], " ") || "Account"
    }
    case "systemusers":
      return join([s(row.display_name), s(row.email)]) || "User"
    case "meetings":
      return (
        join([day(row.meeting_date), s(row.client_account_name), s(row.institution_name) ?? s(row.investor_text)]) ||
        "Meeting"
      )
    case "touchpoints":
      return join([s(row.subject), s(row.client_account_name), day(row.scheduled_start)]) || "Touchpoint"
    case "client_notes":
      return join([s(row.client_account_name), s(row.name), day(row.note_date)]) || "Client note"
    case "contracts": {
      const dates = join([day(row.contract_start_date), day(row.contract_termination_date)], " → ")
      return join([s(row.client_account_name), s(row.name), dates || null]) || "Contract"
    }
    case "tasks":
      return join([s(row.subject), s(row.bcs_account_name) ?? s(row.regarding_name)]) || "Task"
    case "new_vacationrequest": {
      const dates = join([day(row.start_date), day(row.end_date)], " → ")
      return join([s(row.requested_by_name), s(row.pto_type) ?? s(row.name), dates || null]) || "Time-off request"
    }
    case "events":
      return join([s(row.name), s(row.client_account_name), s(row.dates)]) || "Event"
    default:
      return entityName
  }
}

// -----------------------------------------------------------------------------

/** Read every mirror primary key, paging past the 1000-row PostgREST cap. */
async function fetchMirrorPks(sb: SupabaseClient, entity: EntityConfig): Promise<string[]> {
  const pks: string[] = []
  let from = 0
  for (;;) {
    const { data, error } = await sb
      .from(entity.table)
      .select(entity.pk)
      .order(entity.pk, { ascending: true })
      .range(from, from + PAGE - 1)
    if (error) throw new Error(`read ${entity.table} pks: ${error.message}`)
    const page = (data ?? []) as unknown as Record<string, unknown>[]
    for (const r of page) {
      const v = r[entity.pk]
      if (v !== null && v !== undefined) pks.push(String(v))
    }
    if (page.length < PAGE) break
    from += PAGE
  }
  return pks
}

type ExistingCandidate = { id: number; pk_value: string; status: string }

async function reconcileEntity(
  sb: SupabaseClient,
  entity: EntityConfig,
  runStartedAt: string,
): Promise<ReconcileEntityResult> {
  // 1. Live ids from Dynamics (read-only full pull). A failure here must never
  //    flag anything — bail out as a skip.
  let liveIds: string[]
  try {
    liveIds = await fetchAllIds(entity.entitySet, entity.idField)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return skipped(entity.name, `live-ID fetch failed: ${message}`)
  }

  // 2. Mirror keys.
  let mirrorPks: string[]
  try {
    mirrorPks = await fetchMirrorPks(sb, entity)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return skipped(entity.name, message, liveIds.length)
  }

  // SAFETY GUARD: an empty pull against a non-empty mirror is almost certainly a
  // transient outage, not a mass deletion. Skip rather than queue the whole table.
  if (liveIds.length === 0 && mirrorPks.length > 0) {
    return skipped(
      entity.name,
      `live pull returned 0 ids while mirror has ${mirrorPks.length} rows — skipped to avoid mass-flagging`,
      0,
      mirrorPks.length,
    )
  }

  // Compare case-insensitively (Dynamics guids vs Postgres uuid text).
  const liveSet = new Set(liveIds.map((id) => id.toLowerCase()))
  const missing = mirrorPks.filter((pk) => !liveSet.has(pk.toLowerCase()))

  // 3. Load this entity's existing open candidates.
  const { data: existingData, error: existingErr } = await sb
    .from("deletion_candidates")
    .select("id, pk_value, status")
    .eq("entity_name", entity.name)
    .in("status", ["pending", "dismissed"])
  if (existingErr) {
    return skipped(entity.name, `read candidates: ${existingErr.message}`, liveIds.length, mirrorPks.length)
  }
  const existing = (existingData ?? []) as unknown as ExistingCandidate[]
  const existingByPk = new Map(existing.map((c) => [c.pk_value.toLowerCase(), c]))

  // 3a. Reappearances: open candidate whose pk is live again → remove from queue.
  const reappearedIds = existing
    .filter((c) => liveSet.has(c.pk_value.toLowerCase()))
    .map((c) => c.id)
  let reappeared = 0
  for (let i = 0; i < reappearedIds.length; i += IN_CHUNK) {
    const chunk = reappearedIds.slice(i, i + IN_CHUNK)
    const { error } = await sb.from("deletion_candidates").delete().in("id", chunk)
    if (!error) reappeared += chunk.length
  }

  // 3b. Split the missing set into brand-new vs already-queued.
  const newPks = missing.filter((pk) => !existingByPk.has(pk.toLowerCase()))
  const bumpIds = missing
    .map((pk) => existingByPk.get(pk.toLowerCase()))
    .filter((c): c is ExistingCandidate => !!c)
    .map((c) => c.id)

  // Bump last_seen_missing_at on the still-missing existing candidates.
  let bumped = 0
  for (let i = 0; i < bumpIds.length; i += IN_CHUNK) {
    const chunk = bumpIds.slice(i, i + IN_CHUNK)
    const { error } = await sb
      .from("deletion_candidates")
      .update({ last_seen_missing_at: runStartedAt })
      .in("id", chunk)
    if (!error) bumped += chunk.length
  }

  // Insert the new candidates, snapshotting the mirror row for the label + audit.
  let newlyFlagged = 0
  for (let i = 0; i < newPks.length; i += IN_CHUNK) {
    const chunk = newPks.slice(i, i + IN_CHUNK)
    const { data: rowsData, error: rowsErr } = await sb
      .from(entity.table)
      .select("*")
      .in(entity.pk, chunk)
    if (rowsErr) continue
    const rows = (rowsData ?? []) as unknown as Record<string, unknown>[]
    const byPk = new Map(rows.map((r) => [String(r[entity.pk]).toLowerCase(), r]))

    const inserts = chunk.map((pk) => {
      const row = byPk.get(pk.toLowerCase()) ?? {}
      // Drop the heavy _raw Dynamics blob from the audit snapshot.
      const { _raw, ...snapshot } = row as Record<string, unknown> & { _raw?: unknown }
      void _raw
      return {
        entity_name: entity.name,
        table_name: entity.table,
        pk_column: entity.pk,
        pk_value: pk,
        label: labelFor(entity.name, row),
        raw_snapshot: snapshot,
        status: "pending",
        first_detected_at: runStartedAt,
        last_seen_missing_at: runStartedAt,
      }
    })

    // onConflict guards against a race with a prior partial insert; ignoreDuplicates
    // keeps an already-queued row untouched.
    const { error: insErr, count } = await sb
      .from("deletion_candidates")
      .upsert(inserts, { onConflict: "entity_name,pk_value", ignoreDuplicates: true, count: "exact" })
    if (!insErr) newlyFlagged += count ?? inserts.length
  }

  return {
    entity: entity.name,
    checked: mirrorPks.length,
    liveCount: liveIds.length,
    newlyFlagged,
    bumped,
    reappeared,
    skipped: false,
  }
}

/**
 * Run the reconciliation sweep across every synced entity and persist a
 * summary row in reconcile_runs. Entities run sequentially and independently —
 * one skipping does not abort the rest.
 */
export async function runReconciliation(): Promise<ReconcileResult> {
  const sb = getSupabaseServer()
  const runStartedAt = new Date().toISOString()

  const entities: ReconcileEntityResult[] = []
  for (const entity of ENTITIES) {
    entities.push(await reconcileEntity(sb, entity, runStartedAt))
  }

  const finishedAt = new Date().toISOString()

  // Best-effort bookkeeping row so the admin page can show the last sweep time
  // even for cron-triggered runs.
  try {
    await sb.from("reconcile_runs").insert({
      started_at: runStartedAt,
      finished_at: finishedAt,
      entities_checked: entities.filter((e) => !e.skipped).length,
      newly_flagged: entities.reduce((n, e) => n + e.newlyFlagged, 0),
      reappeared: entities.reduce((n, e) => n + e.reappeared, 0),
      skipped: entities.filter((e) => e.skipped).length,
      summary: entities,
    })
  } catch {
    // Logging the run is best-effort; the sweep itself already did its work.
  }

  return { runStartedAt, finishedAt, entities }
}
