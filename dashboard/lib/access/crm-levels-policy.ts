/**
 * PURE rules for CRM ACCESS LEVELS (2026-10-16) — no I/O, unit-tested in
 * crm-levels-policy.test.ts. The four primary CRM tables — Clients
 * (/accounts), Events, Meetings, Contacts — each carry a per-role and
 * per-person level:
 *
 *   none    no access (the page is not granted)
 *   view    the list, filters, export, saved views and read-only drawer —
 *           EXACTLY the old boolean page grant (nav + reads key off >= view)
 *   edit    + edit existing dashboard-created records (non-protected fields)
 *   manage  + create records, delete / purge them, and change PROTECTED fields
 *
 * Storage: the existing grant tables, no parallel system.
 *   role_page_access   (role, route, allowed, crm_level) — `allowed` stays the
 *                      view bit every reader already uses; crm_level refines it.
 *   user_page_grants   (email, route, crm_level) — a row = at least view.
 * A person's EFFECTIVE level is the HIGHER of their role's level and their own
 * (raise-only, like the additive page grants). The resolver is
 * lib/access/crm-levels.ts; the write gate is requireCrmLevel (lib/crm-write.ts).
 *
 * Tasks / Touchpoints / Notes joined 2026-10-20 with the same four levels.
 * Their ROWS stay filtered by the Actions row scoping
 * (lib/access/actions-scope.ts) — a level never widens which rows are
 * visible, and every write also requires the row to be visible. Their special
 * actions (task Close, feedback claim / review / sent, Memo upload, the
 * Onboarding page's touchpoint cells) keep their own rules, not these levels.
 */

export const CRM_LEVELS = ["none", "view", "edit", "manage"] as const
export type CrmLevel = (typeof CRM_LEVELS)[number]

export const CRM_LEVEL_LABELS: Record<CrmLevel, string> = {
  none: "None",
  view: "View",
  edit: "Edit",
  manage: "Manage",
}

/** The routes that carry a level (must stay the grantable CRM list pages). */
export const CRM_LEVEL_ROUTES = [
  "/accounts",
  "/events",
  "/meetings",
  "/contacts",
  // 2026-10-20 — rows row-scoped (lib/access/actions-scope.ts).
  "/tasks",
  "/touchpoints",
  "/notes",
] as const
export type CrmLevelRoute = (typeof CRM_LEVEL_ROUTES)[number]

/** Mirror table → its route, for the shared write helpers in lib/crm-write.ts. */
export const CRM_LEVEL_TABLE_ROUTE: Readonly<Record<string, CrmLevelRoute>> = {
  accounts: "/accounts",
  events: "/events",
  meetings: "/meetings",
  contacts: "/contacts",
  tasks: "/tasks",
  touchpoints: "/touchpoints",
  client_notes: "/notes",
}

export function isCrmLevelRoute(route: string): route is CrmLevelRoute {
  return (CRM_LEVEL_ROUTES as readonly string[]).includes(route)
}

export function isCrmLevel(v: unknown): v is CrmLevel {
  return typeof v === "string" && (CRM_LEVELS as readonly string[]).includes(v)
}

const RANK: Record<CrmLevel, number> = { none: 0, view: 1, edit: 2, manage: 3 }

export function levelAtLeast(level: CrmLevel, min: CrmLevel): boolean {
  return RANK[level] >= RANK[min]
}

export function maxLevel(a: CrmLevel, b: CrmLevel): CrmLevel {
  return RANK[a] >= RANK[b] ? a : b
}

/**
 * A role_page_access row → level. `allowed` is authoritative for view (it is
 * what getAllowedRoutes / canAccessRoute read), so allowed=false is ALWAYS
 * none and a legacy allowed=true row with no crm_level is view. Fails closed.
 */
export function levelFromRoleRow(row: { allowed?: boolean | null; crm_level?: string | null } | null | undefined): CrmLevel {
  if (!row?.allowed) return "none"
  const l = row.crm_level
  return l === "edit" || l === "manage" ? l : "view"
}

/** A user_page_grants row → level. The row itself is a view grant; crm_level only raises it. */
export function levelFromGrantRow(row: { crm_level?: string | null } | null | undefined): CrmLevel {
  if (!row) return "none"
  const l = row.crm_level
  return l === "edit" || l === "manage" ? l : "view"
}

export type CrmWriteAction = "edit" | "create" | "delete"

/** The minimum level for each write. */
export const CRM_WRITE_MIN: Record<CrmWriteAction, CrmLevel> = {
  edit: "edit",
  create: "manage",
  delete: "manage",
}

/**
 * May this viewer take `action` on a level-gated table? null = yes.
 *
 * ── IMPLICIT FULL ACCESS (the rule to revisit) ──────────────────────────────
 * `isSuper` = hasSuperUserPrivileges — super_user OR admin. Both BYPASS the
 * level entirely and are implicitly Manage on all four tables, exactly as
 * they bypassed the old super-user-only write gate. To make ADMINS subject to
 * the matrix instead, pass isStrictSuperUser(role) here (and in
 * getEffectiveCrmLevels, lib/access/crm-levels.ts) — those are the two places.
 */
export function decideCrmWrite(action: CrmWriteAction, level: CrmLevel, isSuper: boolean): string | null {
  if (isSuper) return null
  const min = CRM_WRITE_MIN[action]
  if (levelAtLeast(level, min)) return null
  return `Not authorised — ${action === "edit" ? "editing" : action === "create" ? "creating" : "deleting"} needs ${CRM_LEVEL_LABELS[min]} access to this table.`
}

/* ---------------------------------------------------------------------------
 * PROTECTED FIELDS — the hook (SHIPPED EMPTY, 2026-10-16).
 *
 * A column listed here can be CHANGED only at Manage (or by super users /
 * admins); Edit can change everything else. The lists are deliberately EMPTY:
 * today nothing is restricted beyond create / delete. To protect a field, add
 * its mirror-table column name (the key the entity's update builder writes,
 * e.g. "name" on accounts) to the right list — enforcement is already wired in
 * updateDashboardRow (lib/crm-write.ts) via protectedFieldViolation below.
 * ------------------------------------------------------------------------ */
export const PROTECTED_CLIENT_FIELDS: readonly string[] = []
export const PROTECTED_EVENT_FIELDS: readonly string[] = []
export const PROTECTED_MEETING_FIELDS: readonly string[] = []
export const PROTECTED_CONTACT_FIELDS: readonly string[] = []
export const PROTECTED_TASK_FIELDS: readonly string[] = []
export const PROTECTED_TOUCHPOINT_FIELDS: readonly string[] = []
export const PROTECTED_NOTE_FIELDS: readonly string[] = []

export const PROTECTED_FIELDS: Readonly<Record<CrmLevelRoute, readonly string[]>> = {
  "/accounts": PROTECTED_CLIENT_FIELDS,
  "/events": PROTECTED_EVENT_FIELDS,
  "/meetings": PROTECTED_MEETING_FIELDS,
  "/contacts": PROTECTED_CONTACT_FIELDS,
  "/tasks": PROTECTED_TASK_FIELDS,
  "/touchpoints": PROTECTED_TOUCHPOINT_FIELDS,
  "/notes": PROTECTED_NOTE_FIELDS,
}

/**
 * Would this edit change a protected field the viewer may not change?
 * `changed` = the columns whose value actually differs. null = fine.
 */
export function protectedFieldViolation(
  route: CrmLevelRoute,
  changed: readonly string[],
  level: CrmLevel,
  isSuper: boolean,
  protectedFields: Readonly<Record<CrmLevelRoute, readonly string[]>> = PROTECTED_FIELDS,
): string | null {
  if (isSuper || levelAtLeast(level, "manage")) return null
  const hit = changed.filter((c) => protectedFields[route].includes(c))
  return hit.length ? `Changing ${hit.join(", ")} needs Manage access.` : null
}

/* ---------------------------------------------------------------------------
 * QUICK ADD (2026-10-20) — the "+" menus (nav, Client Detail, Onboarding).
 * Each record type is offered only at MANAGE on the table it creates on (or to
 * super users / admins) — the same bar as that table's create action, which
 * re-checks it server-side (requireCrmLevel(route, "create")). A menu with no
 * type left is not drawn at all.
 * ------------------------------------------------------------------------ */
export const QUICK_ADD_CREATE_ROUTE = {
  client: "/accounts",
  meeting: "/meetings",
  event: "/events",
  task: "/tasks",
  touch: "/touchpoints",
  note: "/notes",
  contact: "/contacts",
} as const satisfies Record<string, CrmLevelRoute>

export type QuickAddKind = keyof typeof QUICK_ADD_CREATE_ROUTE

/** The quick-add types this viewer may create, in QUICK_ADD_CREATE_ROUTE order. */
export function quickAddKinds(levels: Readonly<Record<CrmLevelRoute, CrmLevel>>, isSuper: boolean): QuickAddKind[] {
  return (Object.keys(QUICK_ADD_CREATE_ROUTE) as QuickAddKind[]).filter(
    (k) => isSuper || levels[QUICK_ADD_CREATE_ROUTE[k]] === "manage",
  )
}
