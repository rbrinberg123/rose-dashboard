/**
 * Host → email coverage report. Run with:
 *   node --env-file=.env.local scripts/host-email-coverage.mjs
 *
 * READ-ONLY: measures only, writes nothing. Answers "of the distinct hosts in
 * our meeting data, how many resolve to a valid mailbox in users.email?" — the
 * coverage that drives Microsoft Graph calendar features (see lib/graph/hosts.ts).
 *
 * Mirrors the resolver's logic: duplicate Dynamics ids are folded to their
 * canonical identity via public.user_id_aliases before the mailbox lookup, so
 * these numbers match what lib/graph/hosts.ts actually delivers.
 *
 * Re-run after the backfill sync, and periodically as hosts change, to spot
 * hosts with no mailbox (ex-employees, system/app accounts) that will show
 * "no calendar available".
 */
import { createClient } from "@supabase/supabase-js"

const url = process.env.SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !key) {
  console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY")
  process.exit(1)
}

const sb = createClient(url, key, {
  auth: { persistSession: false, autoRefreshToken: false },
})

// 1) Distinct host_ids from meetings (paged).
const hostSet = new Set()
const PAGE = 1000
for (let offset = 0; ; offset += PAGE) {
  const { data, error } = await sb
    .from("meetings")
    .select("host_id")
    .not("host_id", "is", null)
    .range(offset, offset + PAGE - 1)
  if (error) {
    console.error(`✗ meetings: ${error.message}`)
    process.exit(1)
  }
  for (const r of data) if (r.host_id) hostSet.add(r.host_id)
  if (data.length < PAGE) break
}
const hostIds = [...hostSet]
console.log(`Distinct hosts in meetings: ${hostIds.length}`)

// 1b) Fold duplicate ids to canonical identity (matches lib/graph resolver).
const { data: aliasRows, error: aliasErr } = await sb
  .from("user_id_aliases")
  .select("alias_user_id, canonical_user_id")
if (aliasErr) {
  console.error(`✗ user_id_aliases: ${aliasErr.message}`)
  process.exit(1)
}
const aliasMap = new Map(aliasRows.map((r) => [r.alias_user_id, r.canonical_user_id]))
const canonicalOf = (id) => aliasMap.get(id) ?? id
if (aliasRows.length) {
  console.log(`(folding ${aliasRows.length} duplicate host ids via user_id_aliases)`)
}

// 2) Look up the canonical identities in users (chunked). Detect whether the
//    email column exists yet (pre-migration it won't).
let emailColumnExists = true
const users = new Map()
const canonicalIds = [...new Set(hostIds.map(canonicalOf))]
const CHUNK = 100
for (let i = 0; i < canonicalIds.length; i += CHUNK) {
  const chunk = canonicalIds.slice(i, i + CHUNK)
  let { data, error } = await sb
    .from("users")
    .select("user_id, display_name, email")
    .in("user_id", chunk)
  if (error && emailColumnExists && error.code === "42703") {
    // undefined_column: users.email not created yet — fall back without it.
    emailColumnExists = false
    ;({ data, error } = await sb
      .from("users")
      .select("user_id, display_name")
      .in("user_id", chunk))
  }
  if (error) {
    console.error(`✗ users: ${error.message}`)
    process.exit(1)
  }
  for (const u of data) users.set(u.user_id, u)
}

// 3) Tally, keyed back to the raw host ids that appear in meeting data.
let withEmail = 0
let blankEmail = 0
let notInUsers = 0
const blanks = []
for (const id of hostIds) {
  const u = users.get(canonicalOf(id))
  if (!u) {
    notInUsers++
    blanks.push({ id, name: "(not in users table)" })
    continue
  }
  const email = emailColumnExists && typeof u.email === "string" ? u.email.trim() : ""
  if (email) withEmail++
  else {
    blankEmail++
    blanks.push({ id, name: u.display_name || "(no name)" })
  }
}

console.log("")
if (!emailColumnExists) {
  console.log("NOTE: users.email column does not exist yet — run the migration first")
  console.log("      (sql/patches/2026-07-18_users_email.sql). Email coverage is 0 until then.")
  console.log("")
}
console.log(`Resolve to a VALID email : ${withEmail} / ${hostIds.length}`)
console.log(`Exist in users, no email : ${blankEmail}`)
console.log(`Not in users table       : ${notInUsers}`)
console.log("")
console.log("Hosts that would be skipped ('no calendar available'):")
for (const b of blanks) console.log(`  - ${b.name}  [${b.id}]`)
