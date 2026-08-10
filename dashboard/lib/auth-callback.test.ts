import { test } from "node:test"
import assert from "node:assert/strict"

import { decideAuthCallback } from "./auth-callback.ts"

// The route computes `sessionEmailAllowed` from the verified session email via
// isAllowedSessionEmail (covered in auth-allowlist.test.ts). Here we assert the
// callback's branching given that guard result.

// A successful OAuth/magic-link exchange yields a verified Rose session; the
// callback continues into the app (the session that was just created stands),
// landing on the requested page or the default.
test("an allowed session continues into the app (session kept)", () => {
  const d = decideAuthCallback({
    hasCode: true,
    exchangeError: null,
    sessionEmailAllowed: true,
  })
  assert.equal(d.action, "continue")
  assert.equal(d.redirectTo, "/portfolio")
})

test("a valid `next` is honored on success; an off-site `next` falls back to /portfolio", () => {
  assert.equal(
    decideAuthCallback({
      hasCode: true,
      sessionEmailAllowed: true,
      next: "/feedback-collection",
    }).redirectTo,
    "/feedback-collection",
  )
  // Open-redirect guard: absolute / protocol-relative targets are ignored.
  assert.equal(
    decideAuthCallback({
      hasCode: true,
      sessionEmailAllowed: true,
      next: "https://evil.example.com",
    }).redirectTo,
    "/portfolio",
  )
  assert.equal(
    decideAuthCallback({
      hasCode: true,
      sessionEmailAllowed: true,
      next: "//evil.example.com",
    }).redirectTo,
    "/portfolio",
  )
})

// Domain guard: a session whose email is not @roseandco.com is rejected —
// the route signs it out and routes to /no-access.
test("a disallowed (non-roseandco.com) session is rejected: sign out + /no-access", () => {
  const d = decideAuthCallback({
    hasCode: true,
    exchangeError: null,
    sessionEmailAllowed: false,
  })
  assert.equal(d.action, "reject")
  assert.equal(d.action === "reject" && d.signOut, true)
  assert.equal(d.redirectTo, "/no-access")
})

test("a session with no allowed email fails closed (rejected)", () => {
  // sessionEmailAllowed omitted → treated as not allowed.
  const d = decideAuthCallback({ hasCode: true })
  assert.equal(d.action, "reject")
})

// Error paths bounce back to /login without reaching the domain guard.
test("a missing code returns to /login with an error flag", () => {
  const d = decideAuthCallback({ hasCode: false })
  assert.equal(d.action, "error")
  assert.equal(d.redirectTo, "/login?error=missing_code")
})

test("a failed code exchange returns to /login with the encoded error", () => {
  const d = decideAuthCallback({
    hasCode: true,
    exchangeError: "invalid request",
    sessionEmailAllowed: false,
  })
  assert.equal(d.action, "error")
  assert.equal(d.redirectTo, "/login?error=invalid%20request")
})
