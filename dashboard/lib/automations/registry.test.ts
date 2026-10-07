import { test } from "node:test"
import assert from "node:assert/strict"

import { AUTOMATIONS } from "./registry.ts"

test("every automation has a unique id", () => {
  const ids = AUTOMATIONS.map((a) => a.id)
  assert.equal(new Set(ids).size, ids.length)
})

test("Active entries say where they live; Planned entries name no code", () => {
  for (const a of AUTOMATIONS) {
    if (a.status === "Active") assert.ok(a.where.length > 0, `${a.id} is Active but has no location`)
    else assert.equal(a.where.length, 0, `${a.id} is Planned but names code`)
  }
})

test("the catalogue holds the existing automations plus the feedback-report ones", () => {
  const active = AUTOMATIONS.filter((a) => a.status === "Active")
  const planned = AUTOMATIONS.filter((a) => a.status === "Planned")
  assert.equal(active.length, 16) // 13 existing + 3 feedback-report automations
  assert.equal(planned.length, 2)
  for (const id of ["feedback-report-auto-create", "feedback-report-meeting-routing", "feedback-report-close-review"]) {
    assert.ok(active.some((a) => a.id === id), `${id} missing`)
  }
})

test("every field is filled in", () => {
  for (const a of AUTOMATIONS) {
    for (const k of ["name", "trigger", "effect", "scope"] as const) {
      assert.ok(a[k].trim().length > 0, `${a.id}.${k} is empty`)
    }
  }
})
