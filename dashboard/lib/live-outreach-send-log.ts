import { getSupabaseServer } from "@/lib/supabase"

/**
 * Idempotency ledger for the scheduled Live Outreach digest.
 *
 * One row per (job_key, sent_on) — a PRIMARY KEY on that pair means only the
 * FIRST insert for a given Eastern date succeeds; a duplicate cron delivery
 * hits a unique-violation and is told the day is already claimed. This is the
 * second guard behind the Eastern-time window (the two cron fires an hour apart
 * already guarantee only one lands in the 7:30 window; this also stops a rare
 * duplicate delivery of the SAME fire).
 *
 * SERVER-ONLY: uses the service_role client (bypasses RLS — the table has RLS
 * on with no policies, matching user_roles). Never import into a Client Component.
 *
 * Table (run sql/18_cron_send_log.sql in Supabase):
 *   create table public.cron_send_log (
 *     job_key text not null, sent_on date not null,
 *     sent_at timestamptz not null default now(),
 *     primary key (job_key, sent_on));
 */

/** Postgres unique_violation SQLSTATE — the row for (job_key, sent_on) already exists. */
const UNIQUE_VIOLATION = "23505"

/**
 * Atomically claim today's send. Returns `{ claimed: true }` only for the
 * caller that inserted the row first. On a unique-violation the day is already
 * claimed (`claimed: false`). On any other DB error it ALSO returns
 * `claimed: false` (fail closed — do not send if we cannot record it), with the
 * reason surfaced for the cron logs.
 */
export async function claimDailySend(
  jobKey: string,
  sentOn: string,
): Promise<{ claimed: boolean; reason?: string }> {
  const sb = getSupabaseServer()
  const { error } = await sb.from("cron_send_log").insert({ job_key: jobKey, sent_on: sentOn })
  if (!error) return { claimed: true }
  if (error.code === UNIQUE_VIOLATION) return { claimed: false, reason: "already-sent-today" }
  return { claimed: false, reason: `claim-error: ${error.message}` }
}

/**
 * Release a claim (delete the row) so a later retry can resend — called only
 * when the send itself failed after the claim succeeded.
 */
export async function releaseDailySend(jobKey: string, sentOn: string): Promise<void> {
  const sb = getSupabaseServer()
  await sb.from("cron_send_log").delete().eq("job_key", jobKey).eq("sent_on", sentOn)
}
