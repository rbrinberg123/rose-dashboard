import { test } from "node:test"
import assert from "node:assert/strict"

import {
  isAllowedEmail,
  isAllowedSessionEmail,
} from "./auth-allowlist.ts"

// --- Login allowlist (who may request a magic link) -------------------------

test("a @roseandco.com address is allowed to log in (case + whitespace insensitive)", () => {
  assert.equal(isAllowedEmail("scott@roseandco.com"), true)
  assert.equal(isAllowedEmail("  Scott@RoseAndCo.com  "), true)
})

test("a non-roseandco.com address is rejected from logging in", () => {
  assert.equal(isAllowedEmail("someone@gmail.com"), false)
  assert.equal(isAllowedEmail("attacker@roseandco.com.evil.com"), false)
  assert.equal(isAllowedEmail("noatsign"), false)
  assert.equal(isAllowedEmail(""), false)
})

// --- Domain guard (defense in depth on an established session) --------------
// Enforced in the auth callback after a session exists, for BOTH magic-link
// and Microsoft/Entra SSO sign-ins.

test("domain guard accepts a verified @roseandco.com session email", () => {
  assert.equal(isAllowedSessionEmail("scott@roseandco.com"), true)
  assert.equal(isAllowedSessionEmail("Scott@RoseAndCo.com"), true)
})

test("domain guard rejects a non-roseandco.com session email", () => {
  assert.equal(isAllowedSessionEmail("outsider@gmail.com"), false)
  assert.equal(isAllowedSessionEmail("evil@notroseandco.com"), false)
})

test("domain guard fails closed for a null/undefined/blank email", () => {
  assert.equal(isAllowedSessionEmail(null), false)
  assert.equal(isAllowedSessionEmail(undefined), false)
  assert.equal(isAllowedSessionEmail(""), false)
})
