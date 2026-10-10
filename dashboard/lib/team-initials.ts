/**
 * PURE initials logic for the account-team avatar circles. No imports, so it is
 * unit-testable with `npm test`.
 *
 * Disambiguation is GLOBAL and per-person: the collision check runs over the
 * whole account-team directory (every person who appears on these avatars),
 * not per-circle. A person whose normal two-letter initials are shared by any
 * other person in that full set expands to three letters — and does so the same
 * way on every page/team. People with unique initials stay at two letters.
 */

// ---------------------------------------------------------------------------
// PERSON-NAME PARSING — the ONE place a display name is split into people or
// trimmed to its core. Every avatar/initials renderer goes through here.
//
// WHY: display names carry commas — "Scott Grossman, CFA", "John Smith, Jr.",
// "Jane Doe, PhD", even "# Lewis, Tyler". Splitting a delimited people string
// on a bare comma drew one person as two bubbles ("Scott Grossman" + "CFA"),
// and first/last-WORD initials read "Scott Grossman, CFA" as "SC". Both bugs
// kept reappearing because each table carried its own split / initials helper.
// ---------------------------------------------------------------------------

/** Post-nominal suffixes / credentials, lowercased with dots removed. */
const NAME_SUFFIXES = new Set([
  "jr", "sr", "ii", "iii", "iv", "v", "vi",
  "phd", "md", "jd", "dds", "do", "esq", "mba", "ma", "ms", "msc", "bsc", "ba", "bs",
  "cfa", "cpa", "caia", "cfp", "frm", "cma", "cmt", "pe", "rn", "cais", "chfc", "clu", "cipm", "acca", "ca",
])

/** True when `token` is a known suffix/credential ("CFA", "Jr.", "Ph.D.", "III"). */
export function isNameSuffix(token: string): boolean {
  const t = token.trim().toLowerCase().replace(/\./g, "")
  return t.length > 0 && NAME_SUFFIXES.has(t)
}

/**
 * The person's name without trailing suffixes/credentials, comma-separated or
 * not: "Scott Grossman, CFA" → "Scott Grossman", "John Smith Jr." → "John
 * Smith", "Jane Doe, PhD, CFA" → "Jane Doe". Only KNOWN suffixes are dropped,
 * so "# Lewis, Tyler" is left whole.
 */
export function personNameCore(name: string): string {
  let parts = name.split(",").map((p) => p.trim())
  while (parts.length > 1 && parts[parts.length - 1].split(/\s+/).every(isNameSuffix)) parts = parts.slice(0, -1)
  const words = parts.join(", ").split(/\s+/).filter(Boolean)
  while (words.length > 1 && isNameSuffix(words[words.length - 1].replace(/,$/, ""))) words.pop()
  return words.join(" ").replace(/,$/, "")
}

/**
 * Split a delimited string of display names into PEOPLE.
 *
 * Prefer a delimiter that cannot occur inside a name (Clients' team cells use a
 * line break). Where the data's delimiter IS a comma (the Meetings view joins a
 * meeting's hosts with ", "), a fragment that is only a suffix ("CFA", "Jr.")
 * or a single word ("Tyler" in "# Lewis, Tyler") is the tail of the previous
 * name, not a new person — a real second person has at least two words.
 */
export function splitPeople(value: string | null | undefined, delimiter: string = ","): string[] {
  const people: string[] = []
  for (const raw of (value ?? "").split(delimiter)) {
    const frag = raw.trim()
    if (!frag) continue
    const words = frag.split(/\s+/)
    const continuation = words.every(isNameSuffix) || words.length === 1
    if (continuation && people.length > 0 && delimiter.trim() === ",") {
      people[people.length - 1] += ", " + frag
    } else {
      people.push(frag)
    }
  }
  return people
}

/** The name's words for initials: suffixes dropped, letter-less tokens ("#") skipped. */
function initialWords(name: string): string[] {
  return personNameCore(name)
    .split(/\s+/)
    .map((w) => w.replace(/[^\p{L}\p{N}'-]/gu, ""))
    .filter((w) => /[\p{L}\p{N}]/u.test(w))
}

/**
 * First + last initial, uppercased, ignoring suffixes ("Scott Grossman, CFA" →
 * "SG"). A single-word name yields one letter, or `singleWordLetters` letters
 * for the few badges that prefer "JO" over "J".
 */
export function initialsOf(name: string, singleWordLetters: 1 | 2 = 1): string {
  const words = initialWords(name)
  if (words.length === 0) return ""
  if (words.length === 1) return words[0].slice(0, singleWordLetters).toUpperCase()
  return (words[0][0] + words[words.length - 1][0]).toUpperCase()
}

// Disambiguated form: first-name initial + first two letters of the last name
// (e.g. "Katie Murphy" → "KMu", "Kaila Migliazza" → "KMi"). Falls back to the
// normal initials when there's no distinct last name to expand.
export function expandedInitialsOf(name: string): string {
  const words = initialWords(name)
  if (words.length < 2) return initialsOf(name)
  const last = words[words.length - 1]
  return (
    words[0][0].toUpperCase() +
    last[0].toUpperCase() +
    (last[1] ?? "").toLowerCase()
  )
}

// Case/whitespace-insensitive key so a person maps to one entry regardless of
// how their name is spaced or cased across rows.
export function normalizeName(name: string): string {
  return name.trim().replace(/\s+/g, " ").toLowerCase()
}

/**
 * Build the global initials map once over the full set of people. Returns a
 * plain (serializable) object keyed by normalized name → the initials to show.
 *
 * A person's two-letter initials expand iff those two letters are shared by
 * another DISTINCT person in the set. Same-name duplicates (the same person
 * appearing twice) collapse to one entry and never count as a collision with
 * themselves. Deterministic and independent of any single circle or page.
 */
export function buildInitialsMap(
  names: readonly (string | null | undefined)[],
): Record<string, string> {
  // Distinct people, keyed by normalized name (first spelling wins).
  const distinct = new Map<string, string>()
  for (const n of names) {
    const trimmed = n?.trim()
    if (!trimmed) continue
    const key = normalizeName(trimmed)
    if (!distinct.has(key)) distinct.set(key, trimmed)
  }

  // How many distinct people share each two-letter initial.
  const counts = new Map<string, number>()
  for (const original of distinct.values()) {
    const base = initialsOf(original)
    counts.set(base, (counts.get(base) ?? 0) + 1)
  }

  const map: Record<string, string> = {}
  for (const [key, original] of distinct) {
    const base = initialsOf(original)
    map[key] = (counts.get(base) ?? 0) > 1 ? expandedInitialsOf(original) : base
  }
  return map
}

// Look up a person's display initials in the global map, falling back to plain
// two-letter initials when the name isn't in the directory (or no map yet).
export function lookupInitials(
  name: string,
  map: Record<string, string> | null | undefined,
): string {
  if (map) {
    const hit = map[normalizeName(name)]
    if (hit) return hit
  }
  return initialsOf(name)
}
