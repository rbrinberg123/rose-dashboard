import { test } from "node:test"
import assert from "node:assert/strict"

import { TASK_CLOSE_WRITE_THROUGH_DYNAMICS, closeMode, decideTaskClose, isSidecarClosed } from "./close.ts"

const ME = { myIds: new Set(["me"]), isAdmin: false }
const ADMIN = { myIds: new Set(["admin"]), isAdmin: true }
const open = (o: Partial<Parameters<typeof decideTaskClose>[0]> = {}) => ({
  origin: "dashboard",
  stateLabel: "Open",
  closedAt: null,
  ownerId: "me",
  ...o,
})

test("the owner may close their open task", () => {
  assert.equal(decideTaskClose(open(), ME), null)
  assert.equal(decideTaskClose(open({ origin: "dynamics" }), ME), null)
})

test("an admin may close anyone's task; a non-owner may not", () => {
  assert.equal(decideTaskClose(open({ ownerId: "someone" }), ADMIN), null)
  assert.match(decideTaskClose(open({ ownerId: "someone" }), ME) ?? "", /Not authorised/)
  assert.match(decideTaskClose(open({ ownerId: null }), ME) ?? "", /Not authorised/)
})

test("already closed — natively, or via the Dynamics sidecar — is refused", () => {
  assert.match(decideTaskClose(open({ stateLabel: "Completed" }), ADMIN) ?? "", /already closed/)
  assert.match(decideTaskClose(open({ origin: "dynamics", closedAt: "2026-10-08" }), ADMIN) ?? "", /already closed/)
})

test("dashboard closes natively; Dynamics uses the sidecar until the cutover switch", () => {
  assert.equal(closeMode("dashboard"), "native")
  assert.equal(closeMode("dynamics"), TASK_CLOSE_WRITE_THROUGH_DYNAMICS ? "native" : "sidecar")
  assert.equal(isSidecarClosed({ stateLabel: "Open", closedAt: "2026-10-08" }), true)
  assert.equal(isSidecarClosed({ stateLabel: "Completed", closedAt: "2026-10-08" }), false)
  assert.equal(isSidecarClosed({ stateLabel: "Open", closedAt: null }), false)
})
