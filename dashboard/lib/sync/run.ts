/**
 * Sync orchestration. Pulls each entity from Dynamics incrementally and
 * upserts it into its Supabase mirror table, recording outcomes in sync_runs
 * and per-record failures in sync_errors.
 *
 * Design notes (mirrors the Phase 6a spec):
 *   - Incremental: each entity's last_synced_at is read before the pull and
 *     used as `modifiedon gt {ts}`. First-ever run (no sync_runs row) is a
 *     full pull. After a successful pull, last_synced_at is advanced to the
 *     run start time (captured once, before any fetching).
 *   - Resilience: network/auth failures are retried with backoff inside the
 *     Dynamics client. Per-record upsert failures are logged to sync_errors
 *     and skipped. One entity failing does not stop the others.
 */

import type { SupabaseClient } from "@supabase/supabase-js"
import { getSupabaseServer } from "@/lib/supabase"
import { fetchAll } from "./dynamics"
import { ENTITIES, type EntityConfig } from "./entities"

const BATCH_SIZE = 500

export type EntityResult = {
  entity: string
  status: "success" | "partial" | "error"
  totalRecords: number
  errorCount: number
  fetched: number
  fullPull: boolean
  message?: string
}

export type SyncResult = {
  runStartedAt: string
  finishedAt: string
  entities: EntityResult[]
}

/** Insert one row into sync_errors. Never throws — error logging is best-effort. */
async function logError(
  sb: SupabaseClient,
  runStartedAt: string,
  entityName: string,
  dynamicsId: string | null,
  message: string,
): Promise<void> {
  try {
    await sb.from("sync_errors").insert({
      run_started_at: runStartedAt,
      entity_name: entityName,
      dynamics_id: dynamicsId,
      error_message: message.slice(0, 2000),
    })
  } catch {
    // If we can't even log the error, there's nothing more to do here.
  }
}

/**
 * Upsert a batch. On batch failure, retry the rows one at a time so a single
 * bad record doesn't sink the other 499, logging each failure to sync_errors.
 * Returns the number of rows successfully written.
 */
async function upsertBatch(
  sb: SupabaseClient,
  entity: EntityConfig,
  batch: Record<string, unknown>[],
  runStartedAt: string,
): Promise<{ written: number; errors: number }> {
  const { error } = await sb.from(entity.table).upsert(batch, { onConflict: entity.pk })
  if (!error) return { written: batch.length, errors: 0 }

  // Isolate the offending row(s).
  let written = 0
  let errors = 0
  for (const row of batch) {
    const { error: rowErr } = await sb.from(entity.table).upsert(row, { onConflict: entity.pk })
    if (rowErr) {
      errors++
      await logError(sb, runStartedAt, entity.name, String(row[entity.pk] ?? ""), rowErr.message)
    } else {
      written++
    }
  }
  return { written, errors }
}

async function syncEntity(
  sb: SupabaseClient,
  entity: EntityConfig,
  runStartedAt: string,
): Promise<EntityResult> {
  // Read the incremental watermark.
  const { data: runRow } = await sb
    .from("sync_runs")
    .select("last_synced_at")
    .eq("entity_name", entity.name)
    .maybeSingle()

  const modifiedSince = (runRow?.last_synced_at as string | null) ?? null
  const fullPull = modifiedSince === null

  try {
    const rows = await fetchAll(entity.entitySet, modifiedSince)

    // Map, isolating per-record mapping failures.
    const mapped: Record<string, unknown>[] = []
    let errorCount = 0
    for (const raw of rows) {
      try {
        mapped.push(entity.map(raw, runStartedAt))
      } catch (err) {
        errorCount++
        const id = String((raw as Record<string, unknown>)[`${entity.pk}`] ?? "")
        await logError(
          sb,
          runStartedAt,
          entity.name,
          id || null,
          `map failed: ${err instanceof Error ? err.message : String(err)}`,
        )
      }
    }

    // Upsert in batches.
    let written = 0
    for (let i = 0; i < mapped.length; i += BATCH_SIZE) {
      const batch = mapped.slice(i, i + BATCH_SIZE)
      const res = await upsertBatch(sb, entity, batch, runStartedAt)
      written += res.written
      errorCount += res.errors
    }

    const status: EntityResult["status"] = errorCount > 0 ? "partial" : "success"

    // Advance the watermark to the run start time on a successful (or partial)
    // pull — partial still made forward progress and the failed rows are
    // captured in sync_errors.
    await sb.from("sync_runs").upsert(
      {
        entity_name: entity.name,
        last_synced_at: runStartedAt,
        last_status: status,
        error_count: errorCount,
        total_records: written,
      },
      { onConflict: "entity_name" },
    )

    return {
      entity: entity.name,
      status,
      totalRecords: written,
      errorCount,
      fetched: rows.length,
      fullPull,
    }
  } catch (err) {
    // Entity-level failure (e.g. fetch exhausted its retries). Record it but
    // leave last_synced_at untouched so the next run retries the same window.
    const message = err instanceof Error ? err.message : String(err)
    await logError(sb, runStartedAt, entity.name, null, message)
    await sb.from("sync_runs").upsert(
      {
        entity_name: entity.name,
        last_status: "error",
        // Bump error_count by recording at least this failure; keep prior
        // total_records (we don't know the new count).
        error_count: 1,
      },
      { onConflict: "entity_name" },
    )
    return {
      entity: entity.name,
      status: "error",
      totalRecords: 0,
      errorCount: 1,
      fetched: 0,
      fullPull,
      message,
    }
  }
}

/**
 * Run a full sync across all entities. Entities run sequentially and
 * independently — one failing does not abort the rest.
 */
export async function runSync(): Promise<SyncResult> {
  const sb = getSupabaseServer()
  const runStartedAt = new Date().toISOString()

  const entities: EntityResult[] = []
  for (const entity of ENTITIES) {
    entities.push(await syncEntity(sb, entity, runStartedAt))
  }

  return {
    runStartedAt,
    finishedAt: new Date().toISOString(),
    entities,
  }
}
