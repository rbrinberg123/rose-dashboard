import { test } from "node:test"
import assert from "node:assert/strict"

import { matchActionStepLinks, splitActionSteps, type ActionStepLink } from "./action-step-links.ts"

const link = (stepText: string, stepIndex: number, createdAt: string, taskId = createdAt): ActionStepLink => ({
  taskId,
  stepIndex,
  stepText,
  createdAt,
})

test("splitActionSteps: semicolon list, trimmed, blanks dropped", () => {
  assert.deepEqual(splitActionSteps(" Call CFO ; ; Send deck;"), ["Call CFO", "Send deck"])
  assert.deepEqual(splitActionSteps(null), [])
})

test("matchActionStepLinks: by text first, newest first", () => {
  const steps = ["Call CFO", "Send deck"]
  const m = matchActionStepLinks(steps, [
    link("Send deck", 0, "2026-10-01", "a"),
    link("Send deck", 1, "2026-10-05", "b"),
  ])
  assert.deepEqual(m[0], [])
  assert.deepEqual(m[1].map((l) => l.taskId), ["b", "a"])
})

test("matchActionStepLinks: index fallback only when the text matches nothing", () => {
  const steps = ["Call CFO today", "Send deck"]
  const m = matchActionStepLinks(steps, [link("Call CFO", 0, "2026-10-01", "x"), link("Gone", 7, "2026-10-01", "y")])
  assert.deepEqual(m[0].map((l) => l.taskId), ["x"])
  assert.equal(m.flat().length, 1)
})
