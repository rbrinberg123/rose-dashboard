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

// First + last initial, uppercased. A single-word name yields one letter.
export function initialsOf(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean)
  if (words.length === 0) return ""
  if (words.length === 1) return words[0][0].toUpperCase()
  return (words[0][0] + words[words.length - 1][0]).toUpperCase()
}

// Disambiguated form: first-name initial + first two letters of the last name
// (e.g. "Katie Murphy" → "KMu", "Kaila Migliazza" → "KMi"). Falls back to the
// normal initials when there's no distinct last name to expand.
export function expandedInitialsOf(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean)
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
