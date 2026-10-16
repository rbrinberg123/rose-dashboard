import { test } from "node:test"
import assert from "node:assert/strict"

import { singleFlightRefreshFetch } from "./refresh-single-flight.ts"

const REFRESH_URL = "https://x.supabase.co/auth/v1/token?grant_type=refresh_token"

function mockFetch(status = 200) {
  const calls: string[] = []
  const real = globalThis.fetch
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    calls.push(String(input))
    await new Promise((r) => setTimeout(r, 20))
    return new Response(JSON.stringify({ access_token: "new" }), { status })
  }) as typeof fetch
  return { calls, restore: () => (globalThis.fetch = real) }
}

test("concurrent refreshes with the same refresh token share one network call", async () => {
  const m = mockFetch()
  try {
    const init = { method: "POST", body: JSON.stringify({ refresh_token: "rt-A" }) }
    const results = await Promise.all(Array.from({ length: 30 }, () => singleFlightRefreshFetch(REFRESH_URL, init)))
    assert.equal(m.calls.length, 1)
    for (const r of results) assert.deepEqual(await r.json(), { access_token: "new" })
  } finally {
    m.restore()
  }
})

test("different refresh tokens are never shared", async () => {
  const m = mockFetch()
  try {
    await Promise.all([
      singleFlightRefreshFetch(REFRESH_URL, { method: "POST", body: JSON.stringify({ refresh_token: "rt-B" }) }),
      singleFlightRefreshFetch(REFRESH_URL, { method: "POST", body: JSON.stringify({ refresh_token: "rt-C" }) }),
    ])
    assert.equal(m.calls.length, 2)
  } finally {
    m.restore()
  }
})

test("a failed refresh is not reused", async () => {
  const m = mockFetch(429)
  try {
    const init = { method: "POST", body: JSON.stringify({ refresh_token: "rt-D" }) }
    assert.equal((await singleFlightRefreshFetch(REFRESH_URL, init)).status, 429)
    await singleFlightRefreshFetch(REFRESH_URL, init)
    assert.equal(m.calls.length, 2)
  } finally {
    m.restore()
  }
})

test("non-refresh calls pass straight through", async () => {
  const m = mockFetch()
  try {
    await singleFlightRefreshFetch("https://x.supabase.co/auth/v1/user", { method: "GET" })
    await singleFlightRefreshFetch("https://x.supabase.co/auth/v1/user", { method: "GET" })
    assert.equal(m.calls.length, 2)
  } finally {
    m.restore()
  }
})
