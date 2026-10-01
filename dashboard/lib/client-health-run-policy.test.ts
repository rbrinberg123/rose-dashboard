import { test } from "node:test"
import assert from "node:assert/strict"

import { decideStart, isRunAlive, LEASE_MS } from "./client-health-run-policy.ts"

const NOW = Date.parse("2026-10-05T09:00:00Z")
const iso = (ms: number) => new Date(ms).toISOString()

test("a run holding an unexpired lease is alive", () => {
  assert.equal(isRunAlive({ status: "running", lease_until: iso(NOW + 1000), heartbeat_at: iso(NOW - LEASE_MS * 2) }, NOW), true)
})

test("a run mid-handoff (no lease, fresh heartbeat) is alive", () => {
  assert.equal(isRunAlive({ status: "running", lease_until: null, heartbeat_at: iso(NOW - 1000) }, NOW), true)
})

test("a run whose lease and heartbeat lapsed is stale", () => {
  assert.equal(
    isRunAlive({ status: "running", lease_until: iso(NOW - 1000), heartbeat_at: iso(NOW - LEASE_MS - 1) }, NOW),
    false,
  )
})

test("a finished run is never alive", () => {
  assert.equal(isRunAlive({ status: "finished", lease_until: iso(NOW + 1000), heartbeat_at: iso(NOW) }, NOW), false)
})

test("start while a live run is in progress never launches a second run", () => {
  const live = { status: "running" as const, lease_until: iso(NOW + 60_000), heartbeat_at: iso(NOW) }
  assert.deepEqual(decideStart(live, null, "manual", NOW), { kind: "already_running" })
  assert.deepEqual(decideStart(live, null, "cron", NOW), { kind: "already_running" })
})

test("a stale run is reclaimed (resumed), not restarted", () => {
  const stale = { status: "running" as const, lease_until: null, heartbeat_at: iso(NOW - LEASE_MS - 1) }
  assert.deepEqual(decideStart(stale, null, "manual", NOW), { kind: "reclaim" })
  assert.deepEqual(decideStart(stale, null, "cron", NOW), { kind: "reclaim" })
})

test("cron watchdog fires are no-ops once this week's run started; manual always runs", () => {
  const recent = { started_at: iso(NOW - 60 * 60 * 1000) }
  assert.deepEqual(decideStart(null, recent, "cron", NOW), { kind: "up_to_date" })
  assert.deepEqual(decideStart(null, recent, "manual", NOW), { kind: "create" })
  const lastWeek = { started_at: iso(NOW - 7 * 24 * 60 * 60 * 1000) }
  assert.deepEqual(decideStart(null, lastWeek, "cron", NOW), { kind: "create" })
})
