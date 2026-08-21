/**
 * Central registry of every navigable page in the app.
 *
 * ONE list, grouped by nav section, that drives the Admin → Roles matrix today
 * (rows = pages) and can later drive enforcement. Enumerates the real page
 * routes under `app/*` — excluding `api`, `auth`, `login`, and `no-access` —
 * and INCLUDES the hidden/parked pages (Upcoming Meetings, Relationships,
 * Conference Rooms, legacy Planning) so the matrix covers everything reachable.
 *
 * This registry is the row set for the Roles matrix AND is read at request time
 * by lib/page-access.ts (getAllowedRoutes) to order a role's granted routes for
 * enforcement/landing. The live gate is role_page_access (see the Roles matrix
 * and lib/access-control.ts); this file just enumerates the pages it covers.
 *
 * Section labels mirror the sidebar nav (components/nav.tsx). Pages that are not
 * linked from a nav section are still bucketed into the closest one:
 *   - the financial / cost-modeling pages sit under Contracts (they feed
 *     contract profitability), and
 *   - Relationships sits under Institutions (it is institution-keyed).
 */

export type NavSection =
  | "Clients"
  | "Institutions"
  | "Productivity"
  | "Logistics"
  | "Contracts"
  | "Admin"

/** Section render order for the matrix (matches the sidebar top-to-bottom). */
export const PAGE_SECTIONS: readonly NavSection[] = [
  "Clients",
  "Institutions",
  "Productivity",
  "Logistics",
  "Contracts",
  "Admin",
] as const

export type PageEntry = {
  /** URL path segment (leading slash), the same string the proxy matches on. */
  route: string
  /** Human label shown in the matrix's page column. */
  label: string
  section: NavSection
}

/**
 * Every navigable page. Order within a section is roughly the nav order, with
 * parked/hidden pages after the linked ones.
 */
export const PAGE_REGISTRY: readonly PageEntry[] = [
  // ---- Clients ----
  { route: "/", label: "Home (Client Statistics)", section: "Clients" },
  { route: "/client-statistics", label: "Client Statistics", section: "Clients" },
  { route: "/portfolio", label: "Client Portfolio", section: "Clients" },
  { route: "/client-detail", label: "Client Detail", section: "Clients" },
  { route: "/clients/to-do", label: "To-Do List", section: "Clients" },

  // ---- Institutions ----
  { route: "/institutions", label: "Institution Summary", section: "Institutions" },
  { route: "/institution-detail", label: "Institution Detail", section: "Institutions" },
  { route: "/institution-style", label: "Institution Style / Set Finder", section: "Institutions" },
  { route: "/relationships", label: "Relationships (hidden)", section: "Institutions" },

  // ---- Productivity ----
  { route: "/people-statistics", label: "People Statistics", section: "Productivity" },
  { route: "/productivity", label: "Productivity Summary", section: "Productivity" },
  { route: "/productivity-detail", label: "Productivity Detail", section: "Productivity" },
  { route: "/capacity", label: "Capacity", section: "Productivity" },

  // ---- Logistics ----
  { route: "/planning-v2", label: "Planning", section: "Logistics" },
  { route: "/planning", label: "Planning (legacy, hidden)", section: "Logistics" },
  { route: "/calendar", label: "NDRS Calendar", section: "Logistics" },
  { route: "/scheduler", label: "Host Calendar", section: "Logistics" },
  { route: "/live-outreach", label: "Live Outreach", section: "Logistics" },
  { route: "/profiles", label: "Profiles", section: "Logistics" },
  { route: "/feedback-manager", label: "Feedback Reports", section: "Logistics" },
  { route: "/feedback-collection", label: "Feedback Collection", section: "Logistics" },
  { route: "/feedback", label: "Feedback (redirect → Collection)", section: "Logistics" },
  { route: "/onboarding", label: "Onboarding", section: "Logistics" },
  { route: "/time-off", label: "Time Off", section: "Logistics" },
  { route: "/pipeline", label: "Upcoming Meetings (hidden)", section: "Logistics" },
  { route: "/conference-rooms", label: "Conference Rooms (hidden)", section: "Logistics" },

  // ---- Contracts (incl. the parked financial / cost-modeling pages) ----
  { route: "/contract-management", label: "Contract Management", section: "Contracts" },
  { route: "/renewals", label: "Contract Renewals", section: "Contracts" },
  { route: "/margin", label: "Margin by Client", section: "Contracts" },
  { route: "/revenue-overrides", label: "Revenue Overrides", section: "Contracts" },
  { route: "/direct-costs", label: "Direct Costs", section: "Contracts" },
  { route: "/cost-assumptions", label: "Cost Assumptions", section: "Contracts" },
  { route: "/overhead-overrides", label: "Overhead Overrides", section: "Contracts" },
  { route: "/quarterly-overhead", label: "Quarterly Overhead", section: "Contracts" },
  { route: "/salary-schedule", label: "Salary Schedule", section: "Contracts" },
  { route: "/exceptions", label: "Exception Report", section: "Contracts" },

  // ---- Admin ----
  { route: "/admin", label: "Admin Hub", section: "Admin" },
  { route: "/admin/sync", label: "Sync Status", section: "Admin" },
  { route: "/admin/reconciliation", label: "Deletion Reconciliation", section: "Admin" },
  { route: "/admin/database", label: "Database Health", section: "Admin" },
  { route: "/admin/users", label: "Users & Roles", section: "Admin" },
  { route: "/admin/roles", label: "Roles Matrix", section: "Admin" },
  { route: "/admin/docs", label: "Documentation", section: "Admin" },
] as const

// ---- assignable roles (matrix columns) ------------------------------------
/**
 * The roles offered as columns in the Roles matrix. Mirrors the roles offered
 * in the Users grid selector, minus "None". `super_user` is LOCKED — it always
 * has access to everything, so its column is all-checked and non-editable and
 * is never written to role_page_access.
 */
export type AssignableRole =
  | "user"
  | "associate"
  | "client_manager"
  | "logistics"
  | "super_user"

export const ASSIGNABLE_ROLES: readonly {
  value: AssignableRole
  label: string
  locked?: boolean
}[] = [
  { value: "user", label: "User" },
  { value: "associate", label: "Associate" },
  { value: "client_manager", label: "Client Manager" },
  { value: "logistics", label: "Logistics" },
  { value: "super_user", label: "Super User", locked: true },
] as const

/** True when `route` is a real registered page (guards the save action). */
export function isRegisteredRoute(route: string): boolean {
  return PAGE_REGISTRY.some((p) => p.route === route)
}

// ---- data permissions (matrix rows that are NOT pages) ---------------------
/**
 * Field-level DATA permissions, shown as their own section of rows in the Roles
 * matrix beneath the page rows. These are NOT pages: they gate which FIELDS a
 * role may receive, not which routes it may open.
 *
 * They are persisted in the same `public.role_page_access` table, under a
 * `data:`-prefixed key in the `route` column. That prefix can never collide
 * with a real route, and `getAllowedRoutes` filters its result through
 * PAGE_REGISTRY, so a data-permission row can never be mistaken for a page a
 * role may navigate to.
 */
export type DataPermissionEntry = {
  /** Storage key written to role_page_access.route. */
  key: string
  label: string
  /** One-line explanation shown next to the row. */
  description: string
}

export const DATA_PERMISSIONS: readonly DataPermissionEntry[] = [
  {
    // Must stay identical to FINANCIALS_PERMISSION_KEY in
    // lib/access/financials-policy.ts (the resolver reads that constant). Kept
    // as a literal rather than an import so this module stays dependency-free
    // and unit-testable on its own; lib/page-registry.test.ts asserts the two
    // are the same string, so a drift fails the test run.
    key: "data:financials",
    label: "Financials",
    description:
      "See retainer / fee dollar figures — Portfolio Retainer column + contract doc, Client Detail Annualized Retainer and $ per Meeting",
  },
] as const

/** True when `key` is a real data permission (guards the save action). */
export function isDataPermissionKey(key: string): boolean {
  return DATA_PERMISSIONS.some((p) => p.key === key)
}

/**
 * The intended default access per role — the reference for the OPTIONAL go-live
 * seed SQL (see docs 01-access-and-users.md). NOTE: the live Roles matrix no
 * longer shows these as pre-checked; it shows only saved role_page_access rows
 * (default deny), so the grid can never imply un-enforced access. This helper
 * remains as documentation of the recommended starting grants:
 *   - super_user  → everything (a hard backstop; never written to the table).
 *   - client_manager → all Clients + Institutions pages.
 *   - logistics   → all Logistics pages.
 *   - associate   → nothing (deny-by-default; set in the Roles matrix).
 *   - user        → nothing (left for an admin to configure).
 */
export function seedDefaultAllowed(role: AssignableRole, entry: PageEntry): boolean {
  switch (role) {
    case "super_user":
      return true
    case "client_manager":
      return entry.section === "Clients" || entry.section === "Institutions"
    case "logistics":
      return entry.section === "Logistics"
    // Associate ships with NO default access on purpose: a new role must not
    // grant anything until a super-user ticks boxes for it in the Roles matrix.
    case "associate":
      return false
    case "user":
      return false
  }
}
