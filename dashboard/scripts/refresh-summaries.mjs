/**
 * ONE-TIME FORCED REGENERATE of every active client's AI summary, using
 * whatever summary prompt the TARGET SERVER is currently running.
 *
 * Run with:
 *   npm run refresh-summaries                  (targets http://localhost:3000)
 *   npm run refresh-summaries -- --url https://<your-app>.vercel.app
 *
 * (Both forms load .env.local for CRON_SECRET — see the package.json script.)
 *
 * ────────────────────────────────────────────────────────────────────────────
 * WHICH PROMPT GETS USED is decided by the server you point at, NOT by this
 * script. Targeting localhost uses your local code (the retainer-free prompt);
 * targeting the deployed URL uses whatever is deployed. Either way the summaries
 * are written to the Supabase project that server is configured for.
 * ────────────────────────────────────────────────────────────────────────────
 *
 * It drives /api/client-summary/refresh-all in small batches:
 *   - force=1   regenerate every active client, no staleness check
 *   - before=   a fixed campaign timestamp, so a client already regenerated in
 *               THIS campaign is skipped on a re-run — that is what makes an
 *               interrupted run resumable rather than a restart
 *   - limit=    a handful per request, so no single request runs long
 *
 * The campaign timestamp is saved to .refresh-summaries-state.json (gitignored)
 * and reused automatically if the script is re-run within RESUME_WINDOW_HOURS,
 * so an interrupted run just needs the same command again. It is deleted once
 * the campaign completes. Pass --restart to ignore it and begin a fresh one.
 *
 * Writes are UPDATEs of accounts.ai_summary / ai_summary_generated_at —
 * always overwrite, never append.
 *
 * NOT wired to any deploy hook or cron: the nightly cron hits the same route
 * WITHOUT force=1 and only touches stale clients. This full pass fires only
 * when you run this command.
 */
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const HERE = path.dirname(fileURLToPath(import.meta.url))
const STATE_FILE = path.join(HERE, "..", ".refresh-summaries-state.json")
const RESUME_WINDOW_HOURS = 24

// Batch size per HTTP request. The server paces 2 Anthropic calls at a time
// with a 2s gap, so ~15 clients is roughly a minute per request — short enough
// to stay well inside any serverless timeout, long enough to not be chatty.
const DEFAULT_BATCH = 15

function arg(name, fallback = null) {
  const i = process.argv.indexOf(`--${name}`)
  if (i === -1) return fallback
  const v = process.argv[i + 1]
  return v && !v.startsWith("--") ? v : fallback
}
const has = (name) => process.argv.includes(`--${name}`)

const baseUrl = (arg("url") ?? "http://localhost:3000").replace(/\/+$/, "")
const batch = Number(arg("batch", String(DEFAULT_BATCH)))
const restart = has("restart")
const dryRun = has("dry-run")

const secret = process.env.CRON_SECRET
if (!secret) {
  console.error(
    "Missing CRON_SECRET. Run via `npm run refresh-summaries` (which loads .env.local).",
  )
  process.exit(1)
}
if (!Number.isInteger(batch) || batch < 1) {
  console.error(`--batch must be a positive integer (got ${batch}).`)
  process.exit(1)
}

// --- campaign timestamp: new, or resumed from a previous interrupted run ----
function loadCampaign() {
  if (restart) return null
  try {
    const raw = JSON.parse(fs.readFileSync(STATE_FILE, "utf8"))
    if (raw.baseUrl !== baseUrl) return null
    const ageH = (Date.now() - new Date(raw.startedAt).getTime()) / 3_600_000
    if (!Number.isFinite(ageH) || ageH > RESUME_WINDOW_HOURS) return null
    return raw
  } catch {
    return null
  }
}

const resumed = loadCampaign()
const before = resumed?.before ?? new Date().toISOString()
if (!resumed && !dryRun) {
  fs.writeFileSync(
    STATE_FILE,
    JSON.stringify({ baseUrl, before, startedAt: new Date().toISOString() }, null, 2),
  )
}

console.log(`Target server : ${baseUrl}`)
console.log(`Campaign      : ${before}${resumed ? "  (RESUMED — already-done clients will be skipped)" : "  (new)"}`)
console.log(`Batch size    : ${batch} clients per request`)
console.log("")

// --- drive the endpoint until nothing is left -------------------------------
let totalSucceeded = 0
let totalFailed = 0
const allFailures = []
let pass = 0

for (;;) {
  pass += 1
  const url = new URL("/api/client-summary/refresh-all", baseUrl)
  url.searchParams.set("force", "1")
  url.searchParams.set("before", before)
  // --dry-run does exactly one client so you can eyeball the result before
  // committing to the whole book.
  url.searchParams.set("limit", String(dryRun ? 1 : batch))

  let res
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { authorization: `Bearer ${secret}` },
    })
  } catch (err) {
    console.error(`\nRequest failed: ${err.message}`)
    console.error(`Is the server at ${baseUrl} running? Re-run the same command to resume.`)
    process.exit(1)
  }

  const body = await res.json().catch(() => ({}))

  if (res.status === 401) {
    console.error("401 Unauthorized — CRON_SECRET does not match the target server's.")
    process.exit(1)
  }
  if (res.status !== 200 && res.status !== 207) {
    console.error(`HTTP ${res.status}: ${body.error ?? JSON.stringify(body)}`)
    console.error("Re-run the same command to resume from where it stopped.")
    process.exit(1)
  }

  totalSucceeded += body.succeeded ?? 0
  totalFailed += body.failed ?? 0
  if (Array.isArray(body.failures)) allFailures.push(...body.failures)

  const doneSoFar = (body.active ?? 0) - (body.remaining ?? 0)
  console.log(
    `pass ${String(pass).padStart(2)} — ${body.succeeded ?? 0} regenerated, ` +
      `${body.failed ?? 0} failed · ${doneSoFar}/${body.active ?? "?"} clients complete · ` +
      `${body.remaining ?? "?"} remaining · ${Math.round((body.elapsed_ms ?? 0) / 1000)}s`,
  )

  if (dryRun) {
    console.log("\n--dry-run: stopping after one client. Nothing else was touched.")
    process.exit(0)
  }

  if (!body.remaining || body.remaining <= 0) break

  // No forward progress (every client in the batch failed) — stop rather than
  // spin, so a systemic problem (bad API key, exhausted quota) surfaces fast.
  if ((body.succeeded ?? 0) === 0) {
    console.error("\nNo client succeeded in that pass — stopping to avoid a loop.")
    console.error("Fix the cause, then re-run the same command to resume.")
    if (allFailures.length) console.error(JSON.stringify(allFailures.slice(0, 5), null, 2))
    process.exit(1)
  }
}

console.log("")
console.log(`Done. ${totalSucceeded} summaries regenerated, ${totalFailed} failed.`)
if (allFailures.length) {
  console.log("Failures:")
  for (const f of allFailures) console.log(`  ${f.account_id}: ${f.error}`)
  console.log("\nRe-run the same command to retry just the failed clients.")
  process.exit(1)
}

// Campaign complete — clear the resume marker so the next run starts fresh.
try {
  fs.unlinkSync(STATE_FILE)
} catch {
  /* nothing to clean up */
}
