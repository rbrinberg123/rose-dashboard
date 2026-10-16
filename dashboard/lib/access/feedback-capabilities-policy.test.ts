import { test } from "node:test"
import assert from "node:assert/strict"

import {
  CLAIM_FEEDBACK_PERMISSION_KEY,
  MARK_FEEDBACK_RECEIVED_PERMISSION_KEY,
  NO_FEEDBACK_CAPABILITIES,
  decideFeedbackCapabilities,
} from "./feedback-capabilities-policy.ts"
import { DATA_PERMISSIONS, isDataPermissionKey, isRegisteredRoute } from "../page-registry.ts"

const none = NO_FEEDBACK_CAPABILITIES

test("fails closed: no super, no person flag, no role grant → neither capability", () => {
  assert.deepEqual(decideFeedbackCapabilities({ isSuper: false, userFlags: none, roleFlags: none }), none)
})

test("super users / admins always hold both", () => {
  assert.deepEqual(decideFeedbackCapabilities({ isSuper: true, userFlags: none, roleFlags: none }), {
    claimFeedback: true,
    markFeedbackReceived: true,
  })
})

test("person flag OR role grant — each capability independently", () => {
  const claimOnly = { claimFeedback: true, markFeedbackReceived: false }
  const markOnly = { claimFeedback: false, markFeedbackReceived: true }
  assert.deepEqual(decideFeedbackCapabilities({ isSuper: false, userFlags: claimOnly, roleFlags: none }), claimOnly)
  assert.deepEqual(decideFeedbackCapabilities({ isSuper: false, userFlags: none, roleFlags: markOnly }), markOnly)
  assert.deepEqual(decideFeedbackCapabilities({ isSuper: false, userFlags: claimOnly, roleFlags: markOnly }), {
    claimFeedback: true,
    markFeedbackReceived: true,
  })
})

test("both role-level keys are registered data permissions, never pages", () => {
  for (const key of [CLAIM_FEEDBACK_PERMISSION_KEY, MARK_FEEDBACK_RECEIVED_PERMISSION_KEY]) {
    assert.ok(DATA_PERMISSIONS.some((p) => p.key === key), `${key} must be in DATA_PERMISSIONS`)
    assert.equal(isDataPermissionKey(key), true)
    assert.equal(isRegisteredRoute(key), false)
    assert.ok(key.startsWith("data:"))
  }
})
