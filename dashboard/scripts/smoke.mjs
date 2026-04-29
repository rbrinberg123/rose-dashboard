/**
 * Connectivity smoke test. Run with:
 *   node --env-file=.env.local scripts/smoke.mjs
 *
 * Confirms .env.local is wired up, the JWT role is what we expect, and the
 * mirror tables / computed views are returning rows.
 */
import { createClient } from "@supabase/supabase-js"

const url = process.env.SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !key) {
  console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY")
  process.exit(1)
}

// Decode the JWT payload (no signature check — just to inspect the role claim).
function jwtRole(token) {
  try {
    const payload = token.split(".")[1]
    const json = Buffer.from(payload, "base64url").toString("utf8")
    return JSON.parse(json).role
  } catch {
    return "unparseable"
  }
}

console.log(`URL host:   ${new URL(url).host}`)
console.log(`Key role:   ${jwtRole(key)}   (expected: service_role)`)

const sb = createClient(url, key, {
  auth: { persistSession: false, autoRefreshToken: false },
})

const checks = [
  { view: "accounts", limit: 1 },
  { view: "v_client_portfolio", limit: 3 },
]

let ok = true
for (const { view, limit } of checks) {
  const { data, error, count } = await sb
    .from(view)
    .select("*", { count: "exact" })
    .limit(limit)
  if (error) {
    ok = false
    console.error(`✗ ${view}: ${error.message}`)
    continue
  }
  console.log(`\n✓ ${view}  (rows: ${count})`)
  if (data && data[0]) {
    console.log(`  columns (${Object.keys(data[0]).length}): ${Object.keys(data[0]).join(", ")}`)
    console.log(`  sample[0]:`, JSON.stringify(data[0], null, 2))
  } else {
    console.log("  (no rows returned)")
  }
}

process.exit(ok ? 0 : 1)
