/**
 * PURE identity-resolution index — maps a login email to a CRM person's
 * `users.user_id`(s). No I/O and no `@/` imports, so it is unit-testable with
 * `npm test`.
 *
 * Identity resolves against **`public.users.email` ONLY**. There is no
 * `internalemailaddress` column on `public.users` (the Dynamics field of that
 * name is synced INTO `users.email`); matching it silently errored and denied
 * everyone. The name shown comes from `display_name`.
 *
 * Row classification:
 *   - `excluded` — no email, a non-`@roseandco.com` address (incl.
 *     `@onmicrosoft.com` / external domains), or a Dynamics-disabled row whose
 *     local-part starts with a 32-hex hash. Dropped from the roster AND never
 *     resolvable.
 *   - `service`  — a shared/service `@roseandco.com` mailbox (`conference*`,
 *     `ga`, `corporateaccess`, `dmgsupport`, `externaldev`) or a `#`-prefixed
 *     display name. Kept in the roster (tagged) but NEVER resolvable.
 *   - `human`    — a real person. Resolvable.
 *
 * Same-name duplicates: two active, non-hashed human rows with the same
 * normalized `display_name` are the SAME person, so a login that hits one
 * resolves to the UNION of all their user_ids — a superset that downstream
 * relationship checks match "any of". It can only ever add the twin's
 * clients/meetings, never remove the primary's.
 */

export type UsersRow = {
  user_id: string
  display_name: string | null
  email: string | null
}

export type Classification = "human" | "service" | "excluded"

const ROSE_DOMAIN = "@roseandco.com"
/** Local-part beginning with a 32-hex hash = a Dynamics-disabled/anonymized row. */
const HASHED_LOCAL = /^[0-9a-f]{32}/
/** Shared/service `@roseandco.com` local-parts that are not a single human. */
const SERVICE_LOCALS = new Set(["ga", "corporateaccess", "dmgsupport", "externaldev"])

export function classifyUser(row: UsersRow): {
  classification: Classification
  /** Normalized (trimmed + lower-cased) email, or null. */
  email: string | null
  /** Trimmed display name (falls back to the email when blank). */
  name: string
} {
  const name = row.display_name?.trim() ?? ""
  const email = row.email?.trim().toLowerCase() || null
  if (!email) return { classification: "excluded", email: null, name }

  const at = email.lastIndexOf("@")
  const local = at > 0 ? email.slice(0, at) : ""
  const domain = at >= 0 ? email.slice(at) : ""

  // Only @roseandco.com is ever a human/service; everything else is excluded.
  if (domain !== ROSE_DOMAIN) return { classification: "excluded", email, name }
  // Dynamics-disabled/anonymized → never resolvable, not in the roster.
  if (HASHED_LOCAL.test(local)) return { classification: "excluded", email, name }
  // Shared/service mailbox or #-prefixed name → tagged, never resolvable.
  if (SERVICE_LOCALS.has(local) || local.startsWith("conference") || name.startsWith("#")) {
    return { classification: "service", email, name }
  }
  return { classification: "human", email, name }
}

export type PersonResolution =
  | { state: "resolved"; userIds: string[]; name: string }
  | { state: "no_match" }
  | { state: "ambiguous"; personCount: number; userIds: string[] }

export type RosterEntry = {
  userId: string
  name: string
  email: string
  /** True for a shared/service mailbox row (tagged; never resolvable). */
  service: boolean
}

export type IdentityIndex = {
  /** Resolve a login email to the person's user_id set (union). */
  resolve: (email: string | null | undefined) => PersonResolution
  /** Humans + tagged service rows (excluded rows dropped), deduped by email. */
  roster: RosterEntry[]
  humanCount: number
  serviceCount: number
  /** How many distinct people span >1 record (their ids get unioned). */
  unionedPeople: number
}

type Human = { userId: string; name: string; normName: string; email: string }

export function buildIdentityIndex(rows: UsersRow[]): IdentityIndex {
  const humans: Human[] = []
  const roster: RosterEntry[] = []
  const seenEmails = new Set<string>()

  for (const r of rows) {
    const c = classifyUser(r)
    if (c.classification === "excluded" || !c.email) continue
    if (seenEmails.has(c.email)) continue // dedupe roster by email
    seenEmails.add(c.email)

    const name = c.name || c.email
    const service = c.classification === "service"
    roster.push({ userId: r.user_id, name, email: c.email, service })
    if (!service) {
      humans.push({ userId: r.user_id, name, normName: name.toLowerCase(), email: c.email })
    }
  }

  const byEmail = new Map<string, Human[]>()
  const byName = new Map<string, Human[]>()
  for (const h of humans) {
    const e = byEmail.get(h.email)
    if (e) e.push(h)
    else byEmail.set(h.email, [h])
    const n = byName.get(h.normName)
    if (n) n.push(h)
    else byName.set(h.normName, [h])
  }

  let unionedPeople = 0
  for (const list of byName.values()) {
    if (new Set(list.map((h) => h.userId)).size > 1) unionedPeople++
  }

  const resolve = (email: string | null | undefined): PersonResolution => {
    const e = email?.trim().toLowerCase()
    if (!e) return { state: "no_match" }
    const matched = byEmail.get(e) ?? []
    if (matched.length === 0) return { state: "no_match" }
    const names = new Set(matched.map((h) => h.normName))
    // Union every user_id of every record sharing a matched person's name.
    const userIds = new Set<string>()
    for (const nm of names) for (const h of byName.get(nm) ?? []) userIds.add(h.userId)
    if (names.size > 1) {
      // One email hitting >1 DISTINCT person is a genuine ambiguity (not the
      // expected same-name union) — callers should treat this as fail-closed.
      return { state: "ambiguous", personCount: names.size, userIds: [...userIds] }
    }
    return { state: "resolved", userIds: [...userIds], name: matched[0].name }
  }

  roster.sort((a, b) => a.name.localeCompare(b.name))
  return {
    resolve,
    roster,
    humanCount: humans.length,
    serviceCount: roster.length - humans.length,
    unionedPeople,
  }
}

export type IdentityData = { ok: false; error: string } | ({ ok: true } & IdentityIndex)

/**
 * Turn a `users` query result into identity data — PURE, so the loud
 * "resolver error" branch is unit-testable. A query error yields
 * `{ ok: false }` (a distinct error state), NEVER a silently-empty index that
 * would masquerade as "everyone no-match / nobody has access".
 */
export function fromUsersQuery(result: {
  data: UsersRow[] | null
  error: { message: string } | null
}): IdentityData {
  if (result.error) return { ok: false, error: result.error.message }
  return { ok: true, ...buildIdentityIndex(result.data ?? []) }
}
