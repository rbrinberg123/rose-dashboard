import { test } from "node:test"
import assert from "node:assert/strict"

import {
  initialsOf,
  expandedInitialsOf,
  buildInitialsMap,
  lookupInitials,
  personNameCore,
  splitPeople,
  isNameSuffix,
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

test("initialsOf ignores suffixes/credentials (comma or not)", () => {
  assert.equal(initialsOf("Scott Grossman, CFA"), "SG")
  assert.equal(initialsOf("John Smith, Jr."), "JS")
  assert.equal(initialsOf("John Smith Jr."), "JS")
  assert.equal(initialsOf("Henry Ford, III"), "HF")
  assert.equal(initialsOf("Jane Doe, PhD"), "JD")
  assert.equal(initialsOf("Jane Doe, Ph.D., CFA"), "JD")
  assert.equal(initialsOf("# Lewis, Tyler"), "LT")
  assert.equal(initialsOf("Jo", 2), "JO")
  assert.equal(expandedInitialsOf("Katie Murphy, CFA"), "KMu")
})

test("personNameCore drops only KNOWN trailing suffixes", () => {
  assert.equal(personNameCore("Scott Grossman, CFA"), "Scott Grossman")
  assert.equal(personNameCore("Jane Doe, PhD, CFA"), "Jane Doe")
  assert.equal(personNameCore("John Smith Jr."), "John Smith")
  assert.equal(personNameCore("# Lewis, Tyler"), "# Lewis, Tyler")
  assert.equal(personNameCore("Katie Murphy"), "Katie Murphy")
  assert.ok(isNameSuffix("Ph.D.") && isNameSuffix("III") && !isNameSuffix("Tyler"))
})

test("splitPeople: a suffix comma never makes a phantom second person", () => {
  assert.deepEqual(splitPeople("Scott Grossman, CFA"), ["Scott Grossman, CFA"])
  assert.deepEqual(splitPeople("John Smith, Jr."), ["John Smith, Jr."])
  assert.deepEqual(splitPeople("Henry Ford, III"), ["Henry Ford, III"])
  assert.deepEqual(splitPeople("Jane Doe, PhD"), ["Jane Doe, PhD"])
  assert.deepEqual(splitPeople("# Lewis, Tyler"), ["# Lewis, Tyler"])
})

test("splitPeople: genuine multi-person values still split per person", () => {
  assert.deepEqual(splitPeople("Katie Murphy, Scott Grossman, CFA"), ["Katie Murphy", "Scott Grossman, CFA"])
  assert.deepEqual(splitPeople("Scott Grossman, CFA, Katie Murphy"), ["Scott Grossman, CFA", "Katie Murphy"])
  assert.deepEqual(splitPeople("Ann Lee, Bob Ray"), ["Ann Lee", "Bob Ray"])
  assert.deepEqual(splitPeople("Scott Grossman, CFA" + String.fromCharCode(10) + "Katie Murphy", String.fromCharCode(10)), ["Scott Grossman, CFA", "Katie Murphy"])
  assert.deepEqual(splitPeople(null), [])
  assert.deepEqual(splitPeople(" , "), [])
})
