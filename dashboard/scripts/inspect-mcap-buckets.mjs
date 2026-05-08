/**
 * Throwaway: prints the current bucket strings for the three client-stats views,
 * plus the distinct market_cap_label values that appear on portfolio rows.
 * Run with:
 *   node --env-file=.env.local scripts/inspect-mcap-buckets.mjs
 */
import { createClient } from "@supabase/supabase-js"

const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
})

for (const view of [
  "v_client_stats_by_market_cap",
  "v_client_stats_by_region",
  "v_client_stats_by_sector",
]) {
  const { data, error } = await sb.from(view).select("*")
  console.log(`\n--- ${view} ---`)
  if (error) {
    console.log(`error: ${error.message}`)
    continue
  }
  console.log(`${data.length} rows; columns: ${Object.keys(data[0] ?? {}).join(", ")}`)
  for (const r of data) console.log(JSON.stringify(r))
}

const { data: pf } = await sb.from("v_client_portfolio").select("market_cap_label")
const labels = new Map()
for (const r of pf ?? []) {
  const k = r.market_cap_label ?? "(null)"
  labels.set(k, (labels.get(k) ?? 0) + 1)
}
console.log(`\n--- distinct v_client_portfolio.market_cap_label values ---`)
for (const [k, n] of [...labels.entries()].sort()) console.log(`${k}: ${n}`)
