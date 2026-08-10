import { test } from "node:test"
import assert from "node:assert/strict"

import {
  initialsOf,
  expandedInitialsOf,
  buildInitialsMap,
  lookupInitials,
} from "./team-initials.ts"

test("initialsOf: first + last initial, single word yields one letter", () => {
  assert.equal(initialsOf("Katie Murphy"), "KM")
  assert.equal(initialsOf("Kaila Migliazza"), "KM")
  assert.equal(initialsOf("Cher"), "C")
  assert.equal(initialsOf("Jane A. Doe"), "JD")
})

test("expandedInitialsOf: first initial + first two of last name (KMu / KMi)", () => {
  assert.equal(expandedInitialsOf("Katie Murphy"), "KMu")
  assert.equal(expandedInitialsOf("Kaila Migliazza"), "KMi")
})

// The whole point: global disambiguation. Katie and Kaila never share a circle
// (they sit on different account teams) but they DO share the full directory, so
// both must expand.
test("global collision expands both people even though they're never in one group", () => {
  const map = buildInitialsMap([
    "Katie Murphy",
    "Kaila Migliazza",
    "John Smith",
    "Priya Nair",
  ])
  assert.equal(lookupInitials("Katie Murphy", map), "KMu")
  assert.equal(lookupInitials("Kaila Migliazza", map), "KMi")
  // Unique initials stay at two letters.
  assert.equal(lookupInitials("John Smith", map), "JS")
  assert.equal(lookupInitials("Priya Nair", map), "PN")
})

test("a person renders identically regardless of case/spacing of the lookup", () => {
  const map = buildInitialsMap(["Katie Murphy", "Kaila Migliazza"])
  assert.equal(lookupInitials("  katie   murphy ", map), "KMu")
  assert.equal(lookupInitials("KAILA MIGLIAZZA", map), "KMi")
})

test("same-name duplicates count as one person, not a self-collision", () => {
  // The same person listed twice (e.g. two CRM records) must NOT trigger an
  // expansion by colliding with themselves.
  const map = buildInitialsMap(["Simon Rose", "Simon Rose"])
  assert.equal(lookupInitials("Simon Rose", map), "SR")
})

test("three-way collision expands all three deterministically", () => {
  const map = buildInitialsMap(["Anna Brown", "Adam Blake", "Amy Booth"])
  assert.equal(lookupInitials("Anna Brown", map), "ABr")
  assert.equal(lookupInitials("Adam Blake", map), "ABl")
  assert.equal(lookupInitials("Amy Booth", map), "ABo")
})

test("blank/null names are ignored; unknown lookups fall back to two letters", () => {
  const map = buildInitialsMap(["Katie Murphy", null, "", "   ", "Kaila Migliazza"])
  // A name not in the directory still renders (plain two letters).
  assert.equal(lookupInitials("Dana Lang", map), "DL")
  // No map at all → plain initials.
  assert.equal(lookupInitials("Katie Murphy", null), "KM")
})
