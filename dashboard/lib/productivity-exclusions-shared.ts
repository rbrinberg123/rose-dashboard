/**
 * Browser-safe constants for the Productivity "Former / Excluded" rollup.
 * The server-side model (and the table read) lives in
 * lib/productivity-exclusions.ts, which must never be imported by a Client
 * Component — it uses the service-role Supabase client.
 */

/** Sentinel user_id for the rollup entry (never a real uuid). */
export const EXCLUDED_ROLLUP_ID = "__former_excluded__"

/** "Former / Excluded (3 people)". */
export function excludedRollupLabel(members: number): string {
  return `Former / Excluded (${members.toLocaleString()} ${members === 1 ? "person" : "people"})`
}
