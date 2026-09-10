// ---------------------------------------------------------------------------
// The account team: WHO is on it, in what order, and in what colours.
//
// A plain module, deliberately NOT the "use client" component file. Both a
// server component (app/events/page.tsx, which bulk-reads these columns off
// `accounts`) and client components (Portfolio's table, the Events table) read
// this, and a server component importing a value out of a "use client" module
// gets a client reference rather than the value itself.
//
// Rendering lives in components/account-team-avatars.tsx.
// ---------------------------------------------------------------------------

/** One team member to render as an avatar. A blank name is dropped by the cluster. */
export type TeamAvatarMember = {
  role: string
  name: string | null | undefined
  bg: string
  fg: string
}

/**
 * The four account-team roles, in display order. Account mgr = the sales lead.
 * Colours come from the shared navy→teal palette; Logistics is light, so it
 * takes dark text.
 *
 * One definition so every surface showing the cluster shows the same four
 * people, in the same order, in the same colours: Client Portfolio, Profiles,
 * and the Events Client column.
 *
 * The keys are ACCOUNT columns, and that distinction matters. An event carries
 * its OWN `account_manager_name` and `logistics_coordinator_name` — that is the
 * event's staffing, and it differs from the account's on 187 and 148 live events
 * respectively. The cluster is the ACCOUNT team, so it is always read from the
 * account, never from the event.
 */
export const ACCOUNT_TEAM_ROLES = [
  { role: "Account mgr", key: "sales_lead_primary_name", bg: "#1E2858", fg: "#FFFFFF" },
  { role: "Secondary", key: "secondary_manager_name", bg: "#3D5599", fg: "#FFFFFF" },
  { role: "Associate", key: "associate_name", bg: "#1C8C9C", fg: "#FFFFFF" },
  { role: "Logistics", key: "logistics_coordinator_name", bg: "#4FC6BC", fg: "#0A3B36" },
] as const

/** The account-team columns to select off `accounts` for a bulk read. */
export const ACCOUNT_TEAM_KEYS: readonly string[] = ACCOUNT_TEAM_ROLES.map((r) => r.key)

/** Anything carrying the four account-team name columns. */
export type AccountTeamSource = Partial<
  Record<(typeof ACCOUNT_TEAM_ROLES)[number]["key"], string | null | undefined>
>

/**
 * Map a row carrying the four account-team columns into avatar members. Blank
 * names are dropped by the cluster, so callers need not pre-filter.
 */
export function accountTeamMembers(src: AccountTeamSource | null | undefined): TeamAvatarMember[] {
  return ACCOUNT_TEAM_ROLES.map((r) => ({
    role: r.role,
    name: src?.[r.key] ?? null,
    bg: r.bg,
    fg: r.fg,
  }))
}
