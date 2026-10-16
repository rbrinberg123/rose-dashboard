"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { Check, Loader2, AlertTriangle, Eye, Info, Flag, ChevronDown, ChevronRight, Lock } from "lucide-react"
import { toast } from "sonner"

import { cn } from "@/lib/utils"
import { formatDate } from "@/lib/format"
import { CARD_CLASS, CONTROL_STYLE, TEXT_MUTED, TEXT_PRIMARY } from "@/lib/design"
import { setUserRole, setUserDataScopes, setUserPageGrant, setUserCrmLevel, type DataScopes } from "./actions"
import {
  CRM_LEVELS,
  CRM_LEVEL_LABELS,
  isCrmLevelRoute,
  levelAtLeast,
  maxLevel,
  type CrmLevel,
} from "@/lib/access/crm-levels-policy"
import { setViewAsUserAction } from "@/app/view-as-actions"
import {
  ALWAYS_ALLOWED_ROUTES,
  canAccessRoute,
  hasSuperUserPrivileges,
  isGrantableRoute,
  isHiddenRoute,
} from "@/lib/access-control"
import { PAGE_REGISTRY, PAGE_SECTIONS } from "@/lib/page-registry"

/** null === "None" (no staged grant). */
export type RoleValue =
  | "user"
  | "associate"
  | "client_manager"
  | "logistics"
  | "admin"
  | "super_user"
  | null

/**
 * Identity-mapping result for the "Resolves?" indicator — whether a login email
 * maps to exactly one CRM `users` row (display-only diagnostic; see page.tsx).
 */
export type Resolution =
  | { state: "resolved"; userIds: string[]; name: string }
  | { state: "no_match" }
  | { state: "ambiguous"; personCount: number }
  | { state: "service" }
  | { state: "blank" }

/**
 * Resolution of the LIVE authenticated session email (the real login) — the
 * actual session→user_id path enforcement uses. `null` when there is no session
 * email (nothing to show). See page.tsx.
 */
export type SessionResolution =
  | { state: "resolved"; email: string; userIds: string[]; name: string }
  | { state: "no_match"; email: string }
  | { state: "ambiguous"; email: string; personCount: number }
  | null

export type UserRow = {
  email: string
  name: string
  role: RoleValue
  /** Level-2 data scopes (Account Management is enforced; see actions.ts). */
  scopes: DataScopes
  /** Shared/service mailbox row — tagged, never resolved to a login. */
  service: boolean
  /** Does the login email resolve to a CRM person? */
  resolution: Resolution
  /** Per-user page grants on top of the role (public.user_page_grants). */
  pageGrants: PageGrant[]
}

/** One per-user page grant row. */
export type PageGrant = {
  route: string
  grantedBy: string
  grantedAt: string
  /** The person's own CRM access level on a level-gated CRM table (2026-10-16). */
  crmLevel?: CrmLevel
}

/**
 * The four specific ROW-scope toggles (All is handled separately as the
 * override). Financials is deliberately NOT in this list — it is a field-level
 * grant, not a row scope, so All must not override or dim it.
 */
const SCOPE_FIELDS: { key: keyof Omit<DataScopes, "all">; label: string; title: string }[] = [
  {
    key: "account_mgmt",
    label: "Account Mgmt",
    title: "Account Management — clients where they're on the account team",
  },
  { key: "booker", label: "Booker", title: "Meetings where they are the booker" },
  { key: "host", label: "Host", title: "Meetings where they are the host" },
  { key: "feedback", label: "Feedback", title: "Meetings where they are the feedback assignee" },
]

const ROLE_OPTIONS: { value: string; label: string }[] = [
  { value: "", label: "None" },
  { value: "user", label: "User" },
  { value: "associate", label: "Associate" },
  { value: "client_manager", label: "Client Manager" },
  { value: "logistics", label: "Logistics" },
  { value: "admin", label: "Admin" },
  { value: "super_user", label: "Super User" },
]

// Granted-role pill styling + sort priority. Higher-privilege roles float
// first; None has no pill and the lowest priority. Tints reuse the site
// palette (navy / brand-blue / violet / money-green) so pills read as part of
// the system.
const ROLE_META: Record<
  Exclude<RoleValue, null>,
  { label: string; rank: number; bg: string; text: string }
> = {
  super_user: { label: "Super User", rank: 0, bg: "#E6E9F5", text: "#1E2858" },
  // Navy, one step lighter than Super User — the near-super-user tier.
  admin: { label: "Admin", rank: 1, bg: "#EEF0F8", text: "#3D5599" },
  logistics: { label: "Logistics", rank: 2, bg: "#E7F1FB", text: "#0355A7" },
  client_manager: { label: "Client Manager", rank: 3, bg: "#F3ECFB", text: "#6B3FA0" },
  // Teal tint — the one site colour not already spoken for by another pill.
  associate: { label: "Associate", rank: 4, bg: "#E3F2F3", text: "#0E8A7C" },
  user: { label: "User", rank: 5, bg: "#EAF3EE", text: "#0E7C56" },
}

/** Sort key: granted roles first (Super User → Admin → Logistics → Client
 *  Manager → Associate → User), then None. */
function rank(role: RoleValue): number {
  return role === null ? 6 : ROLE_META[role].rank
}

// Identity-mapping badge colors (reuse the site status palette).
const RESOLVE_GREEN = "#0E7C56"
const RESOLVE_AMBER = "#B7791F"
const RESOLVE_GREY = "#9AA1AD"

/**
 * Compact "Resolves?" badge shown inline at the end of a person's email line.
 * Display-only: reports whether the login email resolves to a CRM person (see
 * page.tsx). Kept to icon-height so it adds no row height. A resolved person may
 * span >1 CRM record (same-name duplicate, unioned) — shown as "✓ N".
 */
function ResolveBadge({ resolution, email }: { resolution: Resolution; email: string }) {
  switch (resolution.state) {
    case "resolved": {
      const n = resolution.userIds.length
      return (
        <span
          className="inline-flex items-center gap-0.5"
          style={{ color: RESOLVE_GREEN }}
          title={`Resolves to ${resolution.name} — user_id${n > 1 ? "s" : ""} ${resolution.userIds.join(", ")}${
            n > 1 ? " (duplicate CRM records, unioned)" : ""
          }`}
          aria-label={`Email resolves to ${resolution.name}`}
        >
          <Check className="size-3.5" />
          {n > 1 ? <span className="text-[11px] font-medium tabular-nums">{n}</span> : null}
        </span>
      )
    }
    case "no_match":
      return (
        <span
          className="inline-flex items-center gap-0.5 text-[11px] font-medium"
          style={{ color: RESOLVE_AMBER }}
          title={`${email} matches no CRM users row`}
        >
          <Flag className="size-3" /> No match
        </span>
      )
    case "ambiguous":
      return (
        <span
          className="inline-flex items-center gap-0.5 text-[11px] font-medium"
          style={{ color: RESOLVE_AMBER }}
          title={`${email} matches ${resolution.personCount} different people (ambiguous)`}
        >
          <Flag className="size-3" /> Ambiguous ({resolution.personCount})
        </span>
      )
    case "service":
      return (
        <span
          className="inline-flex items-center rounded-full bg-[#F1F3F7] px-1.5 py-0.5 text-[10px] font-medium"
          style={{ color: RESOLVE_GREY }}
          title="Shared/service mailbox — never resolved to a login"
        >
          service/shared
        </span>
      )
    case "blank":
      return (
        <span
          className="inline-flex items-center text-[11px]"
          style={{ color: RESOLVE_GREY }}
          title="No email on file"
        >
          —
        </span>
      )
  }
}

/**
 * Thin bar resolving the LIVE authenticated session email (the real login) —
 * the exact session→user_id path enforcement relies on. Deliberately a full-
 * width tinted bar (not a tiny per-row badge) so it reads as page-level. A
 * red-amber "does NOT resolve" here is the case that silently breaks scoping.
 */
function SessionBanner({ resolution }: { resolution: SessionResolution }) {
  if (!resolution) return null

  if (resolution.state === "resolved") {
    const n = resolution.userIds.length
    return (
      <div
        className="flex items-center gap-2 rounded-lg border border-emerald-300/60 bg-emerald-50 px-3 py-1.5 text-xs"
        style={{ color: RESOLVE_GREEN }}
      >
        <Check className="size-4 shrink-0" />
        <span>
          Your login <span className="font-medium">{resolution.email}</span> resolves to{" "}
          {n > 1 ? "user_ids" : "user_id"}{" "}
          <span className="font-mono">{resolution.userIds.join(", ")}</span> — {resolution.name}
          {n > 1 ? ` (${n} CRM records, unioned)` : ""}.
        </span>
      </div>
    )
  }

  return (
    <div
      className="flex items-center gap-2 rounded-lg border border-amber-300/60 bg-amber-50 px-3 py-1.5 text-xs"
      style={{ color: "#92600B" }}
    >
      <AlertTriangle className="size-4 shrink-0" />
      <span>
        {resolution.state === "no_match" ? (
          <>
            Your login <span className="font-medium">{resolution.email}</span> does{" "}
            <span className="font-semibold">NOT</span> resolve to any CRM user.
          </>
        ) : (
          <>
            Your login <span className="font-medium">{resolution.email}</span> is ambiguous —
            matches {resolution.personCount} different CRM people.
          </>
        )}
      </span>
    </div>
  )
}

/**
 * The "Pages" panel under a person's row — per-user page grants on top of the
 * role, grouped like the nav (PAGE_SECTIONS). Three states per page:
 *   - From role → locked on (the Roles matrix grants it to their role);
 *   - Granted   → a toggle with "Granted by X · date";
 *   - off       → a grantable page they cannot open yet.
 * Strict pages (isGrantableRoute false: ADMIN_ONLY_ROUTES, hidden, the Admin
 * section, always-allowed, /feedback) are only listed when the ROLE already
 * reaches them — locked, never toggleable. Grants are page access only; the
 * server action re-checks every rule, this only draws them.
 */
function PagesPanel({
  role,
  roleRoutes,
  roleLevels,
  grants,
  saving,
  nameFor,
  onToggle,
  onLevel,
}: {
  role: Exclude<RoleValue, null>
  roleRoutes: readonly string[]
  /** The role's CRM access levels (2026-10-16) — the baseline the person inherits. */
  roleLevels: Partial<Record<string, CrmLevel>>
  grants: PageGrant[]
  saving: Record<string, boolean>
  nameFor: (email: string) => string
  onToggle: (route: string, on: boolean) => void
  onLevel: (route: string, roleLevel: CrmLevel, next: CrmLevel) => void
}) {
  const grantByRoute = new Map(grants.map((g) => [g.route, g]))
  const always = ALWAYS_ALLOWED_ROUTES as readonly string[]
  const rows = PAGE_REGISTRY.map((p) => ({
    ...p,
    fromRole:
      !always.includes(p.route) && !isHiddenRoute(p.route) && canAccessRoute(role, p.route, roleRoutes),
    grantable: isGrantableRoute(p.route, PAGE_REGISTRY),
  })).filter((p) => p.fromRole || p.grantable)
  const grantedCount = rows.filter((p) => p.grantable && grantByRoute.has(p.route)).length

  return (
    <div className="mt-1.5 mb-1 ml-4 rounded-md border border-[rgba(16,24,40,0.08)] bg-[#FAFBFC] px-3 py-2 text-xs">
      <div className="mb-1.5" style={{ color: TEXT_MUTED }}>
        Page access = role pages + individual grants ({grantedCount} granted). Grants open the page
        only — what they can do there still follows their role and data scopes.
      </div>
      <div className="grid gap-x-6 gap-y-2 sm:grid-cols-2 lg:grid-cols-3">
        {PAGE_SECTIONS.map((section) => {
          const items = rows.filter((p) => p.section === section)
          if (items.length === 0) return null
          return (
            <div key={section}>
              <div className="mb-0.5 font-semibold" style={{ color: TEXT_PRIMARY }}>
                {section}
              </div>
              <ul className="space-y-0.5">
                {items.map((p) => {
                  const grant = grantByRoute.get(p.route)
                  const busy = !!saving[p.route]
                  const locked = p.fromRole && !grant
                  // CRM tables (2026-10-16): a level dropdown, inheriting the role's
                  // level as the baseline. Raise-only: nothing below the role's level
                  // is offered; a higher pick is this person's OVERRIDE.
                  if (isCrmLevelRoute(p.route)) {
                    const superish = role === "super_user" || role === "admin"
                    const roleLevel: CrmLevel = superish ? "manage" : (roleLevels[p.route] ?? "none")
                    const own: CrmLevel = grant ? (grant.crmLevel ?? "view") : "none"
                    const effective = maxLevel(roleLevel, own)
                    const isOverride = !superish && own !== "none" && own !== roleLevel && levelAtLeast(own, roleLevel)
                    return (
                      <li key={p.route} className="flex flex-wrap items-center gap-1.5">
                        <select
                          aria-label={p.label + " access level"}
                          value={effective}
                          disabled={superish || busy}
                          onChange={(e) => onLevel(p.route, roleLevel, e.target.value as CrmLevel)}
                          className="h-6 rounded border border-input bg-background px-1 text-[11px] disabled:cursor-not-allowed disabled:opacity-60"
                          style={{ color: TEXT_PRIMARY }}
                        >
                          {CRM_LEVELS.map((l) => (
                            <option key={l} value={l} disabled={!levelAtLeast(l, roleLevel)}>
                              {CRM_LEVEL_LABELS[l]}
                            </option>
                          ))}
                        </select>
                        <span className="min-w-0 truncate" style={{ color: TEXT_PRIMARY }} title={p.route}>
                          {p.label}
                        </span>
                        <span
                          className="inline-flex shrink-0 items-center gap-0.5 rounded-full bg-[#F1F3F7] px-1.5 text-[10px]"
                          style={{ color: TEXT_MUTED }}
                          title="The level this person's role gives them"
                        >
                          <Lock className="size-2.5" /> Role: {superish ? "Manage (implicit)" : CRM_LEVEL_LABELS[roleLevel]}
                        </span>
                        {isOverride ? (
                          <span
                            className="shrink-0 rounded-full px-1.5 text-[10px] font-semibold uppercase tracking-wide"
                            style={{ backgroundColor: "#EEF5FC", color: "#0154a6" }}
                            title={grant ? "Granted by " + nameFor(grant.grantedBy) + " · " + formatDate(grant.grantedAt) : undefined}
                          >
                            Override
                          </span>
                        ) : null}
                        {busy ? <Loader2 className="size-3 shrink-0 animate-spin" /> : null}
                      </li>
                    )
                  }
                  return (
                    <li key={p.route} className="flex items-center gap-1.5">
                      <input
                        type="checkbox"
                        checked={p.fromRole || !!grant}
                        disabled={locked || busy || !p.grantable}
                        onChange={(e) => onToggle(p.route, e.target.checked)}
                        className="size-3.5 cursor-pointer accent-[#1E2858] disabled:cursor-not-allowed"
                        aria-label={`${p.label} page access`}
                      />
                      <span className="min-w-0 truncate" style={{ color: TEXT_PRIMARY }} title={p.route}>
                        {p.label}
                      </span>
                      {p.fromRole ? (
                        <span
                          className="inline-flex shrink-0 items-center gap-0.5 rounded-full bg-[#F1F3F7] px-1.5 text-[10px]"
                          style={{ color: TEXT_MUTED }}
                        >
                          <Lock className="size-2.5" /> From role
                        </span>
                      ) : null}
                      {grant ? (
                        <span className="shrink-0 text-[10px]" style={{ color: "#0E7C56" }}>
                          Granted by {nameFor(grant.grantedBy)} · {formatDate(grant.grantedAt)}
                        </span>
                      ) : null}
                      {busy ? <Loader2 className="size-3 shrink-0 animate-spin" /> : null}
                    </li>
                  )
                })}
              </ul>
            </div>
          )
        })}
      </div>
    </div>
  )
}

type SaveState = "idle" | "saving" | "saved"

export function UsersView({
  users,
  missingTable,
  missingScopesTable,
  sessionResolution,
  rolePages,
  roleCrmLevels,
  missingPageGrantsTable,
}: {
  users: UserRow[]
  missingTable: boolean
  missingScopesTable: boolean
  sessionResolution: SessionResolution
  /** role → routes the Roles matrix grants it (role_page_access). */
  rolePages: Record<string, string[]>
  /** role → CRM table → the role's access level (2026-10-16). */
  roleCrmLevels: Record<string, Partial<Record<string, CrmLevel>>>
  missingPageGrantsTable: boolean
}) {
  const router = useRouter()
  // Local role state so the selector reflects the change immediately, keyed by
  // lower-cased email. Seeded from the server-rendered roster.
  const [roles, setRoles] = React.useState<Record<string, RoleValue>>(() => {
    const init: Record<string, RoleValue> = {}
    for (const u of users) init[u.email.toLowerCase()] = u.role
    return init
  })
  // Local data-scope state, same optimistic pattern as roles.
  const [scopes, setScopes] = React.useState<Record<string, DataScopes>>(() => {
    const init: Record<string, DataScopes> = {}
    for (const u of users) init[u.email.toLowerCase()] = u.scopes
    return init
  })
  const [saveState, setSaveState] = React.useState<Record<string, SaveState>>({})
  const [scopeSave, setScopeSave] = React.useState<Record<string, SaveState>>({})
  const [grantedOnly, setGrantedOnly] = React.useState(false)
  // Per-user page grants: which rows have the Pages panel open, the local
  // (optimistic) grant lists, and which email|route toggles are saving.
  const [pagesOpen, setPagesOpen] = React.useState<Record<string, boolean>>({})
  const [pageGrants, setPageGrants] = React.useState<Record<string, PageGrant[]>>(() => {
    const init: Record<string, PageGrant[]> = {}
    for (const u of users) init[u.email.toLowerCase()] = u.pageGrants
    return init
  })
  const [pageSaving, setPageSaving] = React.useState<Record<string, Record<string, boolean>>>({})
  const nameByEmail = React.useMemo(
    () => new Map(users.map((u) => [u.email.toLowerCase(), u.name])),
    [users],
  )
  const nameFor = (email: string) => nameByEmail.get(email.toLowerCase()) ?? email
  const [, startTransition] = React.useTransition()

  const total = users.length
  const granted = Object.values(roles).filter((r) => r !== null).length
  const none = total - granted

  // Identity-mapping tally for the diagnostic summary line (static server data).
  const resolveStats = React.useMemo(() => {
    let resolved = 0
    let noMatch = 0
    let ambiguous = 0
    let service = 0
    let unioned = 0
    for (const u of users) {
      if (u.resolution.state === "resolved") {
        resolved++
        if (u.resolution.userIds.length > 1) unioned++
      } else if (u.resolution.state === "no_match") noMatch++
      else if (u.resolution.state === "ambiguous") ambiguous++
      else if (u.resolution.state === "service") service++
    }
    return { resolved, noMatch, ambiguous, service, unioned }
  }, [users])

  // Display order: granted first (by role priority), then None, each group
  // alphabetical by name. Recomputed from the live `roles` map so a row
  // re-floats as soon as its role changes.
  const displayed = React.useMemo(() => {
    return users
      .map((u) => ({ ...u, role: roles[u.email.toLowerCase()] ?? null }))
      .filter((u) => !grantedOnly || u.role !== null)
      .sort((a, b) => rank(a.role) - rank(b.role) || a.name.localeCompare(b.name))
  }, [users, roles, grantedOnly])

  function handleChange(user: UserRow, raw: string) {
    const key = user.email.toLowerCase()
    const next: RoleValue = raw === "" ? null : (raw as RoleValue)
    const prev = roles[key] ?? null

    // Optimistic: update the selector + show "Updating…" immediately.
    setRoles((r) => ({ ...r, [key]: next }))
    setSaveState((s) => ({ ...s, [key]: "saving" }))

    startTransition(async () => {
      const result = await setUserRole(user.email, next)
      if (result.ok) {
        setSaveState((s) => ({ ...s, [key]: "saved" }))
        // Clear the "Saved" tick after a moment.
        window.setTimeout(() => {
          setSaveState((s) => (s[key] === "saved" ? { ...s, [key]: "idle" } : s))
        }, 1500)
        router.refresh()
      } else {
        // Roll back to the previous role and surface the error.
        setRoles((r) => ({ ...r, [key]: prev }))
        setSaveState((s) => ({ ...s, [key]: "idle" }))
        toast.error("Could not save role", { description: result.error })
      }
    })
  }

  function handleScopeChange(user: UserRow, field: keyof DataScopes, checked: boolean) {
    const key = user.email.toLowerCase()
    const prev = scopes[key]
    const next: DataScopes = { ...prev, [field]: checked }

    // Optimistic — reflect immediately, mark saving.
    setScopes((s) => ({ ...s, [key]: next }))
    setScopeSave((s) => ({ ...s, [key]: "saving" }))

    startTransition(async () => {
      const result = await setUserDataScopes(user.email, next)
      if (result.ok) {
        setScopeSave((s) => ({ ...s, [key]: "saved" }))
        window.setTimeout(() => {
          setScopeSave((s) => (s[key] === "saved" ? { ...s, [key]: "idle" } : s))
        }, 1500)
        router.refresh()
      } else {
        setScopes((s) => ({ ...s, [key]: prev }))
        setScopeSave((s) => ({ ...s, [key]: "idle" }))
        toast.error("Could not save data scope", { description: result.error })
      }
    })
  }

  function handlePageGrant(user: UserRow, route: string, on: boolean) {
    const key = user.email.toLowerCase()
    const prev = pageGrants[key] ?? []
    const setBusy = (busy: boolean) =>
      setPageSaving((s) => ({ ...s, [key]: { ...s[key], [route]: busy } }))

    // Optimistic — the server stamps the real granter/date (shown on next load).
    setPageGrants((g) => ({
      ...g,
      [key]: on
        ? [...prev.filter((x) => x.route !== route), { route, grantedBy: "you", grantedAt: new Date().toISOString() }]
        : prev.filter((x) => x.route !== route),
    }))
    setBusy(true)

    startTransition(async () => {
      const result = await setUserPageGrant(user.email, route, on)
      setBusy(false)
      if (result.ok) {
        router.refresh()
      } else {
        setPageGrants((g) => ({ ...g, [key]: prev }))
        toast.error("Could not save page grant", { description: result.error })
      }
    })
  }

  /**
   * A person's own CRM access level (2026-10-16), RAISE-ONLY over their role's:
   * picking the role's level removes their own grant; anything higher is
   * stored as their override.
   */
  function handleCrmLevel(user: UserRow, route: string, roleLevel: CrmLevel, next: CrmLevel) {
    const key = user.email.toLowerCase()
    const prev = pageGrants[key] ?? []
    const stored: CrmLevel = next === roleLevel ? "none" : next
    const existing = prev.find((x) => x.route === route)
    const setBusy = (busy: boolean) =>
      setPageSaving((s) => ({ ...s, [key]: { ...s[key], [route]: busy } }))
    setPageGrants((g) => ({
      ...g,
      [key]:
        stored === "none"
          ? prev.filter((x) => x.route !== route)
          : [
              ...prev.filter((x) => x.route !== route),
              {
                route,
                grantedBy: existing?.grantedBy ?? "you",
                grantedAt: existing?.grantedAt ?? new Date().toISOString(),
                crmLevel: stored,
              },
            ],
    }))
    setBusy(true)
    startTransition(async () => {
      const result = await setUserCrmLevel(user.email, route, stored)
      setBusy(false)
      if (result.ok) {
        router.refresh()
      } else {
        setPageGrants((g) => ({ ...g, [key]: prev }))
        toast.error("Could not save access level", { description: result.error })
      }
    })
  }

  return (
    <div className="space-y-4">
      {/* Summary line + filter */}
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm" style={{ color: TEXT_MUTED }}>
          <span className="tabular-nums font-medium" style={{ color: TEXT_PRIMARY }}>
            {total} user{total === 1 ? "" : "s"}
          </span>
          <span aria-hidden>·</span>
          <span className="tabular-nums">{granted} granted</span>
          <span aria-hidden>·</span>
          <span className="tabular-nums">{none} none</span>
        </div>
        <label className="flex cursor-pointer items-center gap-2 text-sm select-none" style={{ color: TEXT_MUTED }}>
          <input
            type="checkbox"
            checked={grantedOnly}
            onChange={(e) => setGrantedOnly(e.target.checked)}
            className="size-3.5 cursor-pointer accent-[#1E2858]"
          />
          Show granted only
        </label>
      </div>

      {/* Live notice */}
      <div
        className="flex items-start gap-2 rounded-lg border border-[#BBD5F0] bg-[#EEF5FC] p-3 text-xs"
        style={{ color: "#0355A7" }}
      >
        <Info className="mt-0.5 size-4 shrink-0" />
        <p>
          <span className="font-medium">Live.</span> The role you set here controls what each
          person can access (a person with <span className="font-medium">None</span> can reach
          nothing). Which pages each role sees is configured in{" "}
          <span className="font-medium">Roles</span>. Changes take effect on the user&apos;s next
          page load.
        </p>
      </div>

      {missingTable ? (
        <div className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-xs text-destructive">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" />
          <p>
            The <code className="font-mono">public.user_role_grants</code> table does not exist yet.
            Run the <span className="font-medium">CREATE TABLE</span> DDL in the Supabase SQL editor
            — until then, selections here will fail to save.
          </p>
        </div>
      ) : null}

      {/* Data-scope staging notice */}
      <div
        className="flex items-start gap-2 rounded-lg border border-[#BBD5F0] bg-[#EEF5FC] p-3 text-xs"
        style={{ color: "#0355A7" }}
      >
        <Info className="mt-0.5 size-4 shrink-0" />
        <p>
          <span className="font-medium">Data scope — enforced.</span>{" "}
          <span className="font-medium">Account Management</span> now controls which clients a
          person sees on the client pages (Portfolio, Client Detail, NDRS Calendar, Onboarding):
          nothing checked = no client rows (deny-by-default); Super Users always see everything.
          Changes take effect on the user&apos;s next page load.{" "}
          <span className="font-medium">Booker / Host / Feedback</span> (meeting-level) are recorded
          here but enforced in a later pass.{" "}
          <span className="font-medium">Financials</span> is not a row scope: it is a separate
          field-level grant deciding whether the person sees retainer / fee dollar figures at all
          (Portfolio&apos;s Retainer column and contract doc link, Client Detail&apos;s Annualized
          Retainer and $ per Meeting). Ungranted users never receive those values. It composes with
          row scoping — row scoping picks the clients, Financials picks whether their dollars show.
        </p>
      </div>

      {missingScopesTable ? (
        <div className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-xs text-destructive">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" />
          <p>
            The <code className="font-mono">public.user_data_scopes</code> table does not exist yet.
            Run the <span className="font-medium">CREATE TABLE</span> DDL in the Supabase SQL editor
            — until then, scope selections will fail to save.
          </p>
        </div>
      ) : null}

      {missingPageGrantsTable ? (
        <div className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-xs text-destructive">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" />
          <p>
            The <code className="font-mono">public.user_page_grants</code> table does not exist yet.
            Run <span className="font-mono">sql/patches/2026-10-14_user_page_grants.sql</span> in the
            Supabase SQL editor — until then, access is role-only and Pages toggles will fail to save.
          </p>
        </div>
      ) : null}

      {/* Live-session resolution banner — tests the real login→user_id path */}
      <SessionBanner resolution={sessionResolution} />

      {/* Identity-mapping diagnostic summary (display-only) */}
      <div className="text-xs" style={{ color: TEXT_MUTED }}>
        <span className="font-medium" style={{ color: TEXT_PRIMARY }}>
          Identity mapping:
        </span>{" "}
        <span className="tabular-nums">{resolveStats.resolved}</span> resolve
        <span aria-hidden> · </span>
        <span className="tabular-nums">{resolveStats.noMatch}</span> no-match
        <span aria-hidden> · </span>
        <span className="tabular-nums">{resolveStats.ambiguous}</span> ambiguous
        <span aria-hidden> · </span>
        <span className="tabular-nums">{resolveStats.service}</span> service/shared
        <span aria-hidden> · </span>
        <span className="tabular-nums">{resolveStats.unioned}</span> with duplicate records (unioned)
      </div>

      {/* Roster — scrolls horizontally on narrow widths so the scope columns
          stay aligned rather than wrapping. */}
      <div className={`overflow-x-auto ${CARD_CLASS}`}>
        {displayed.length === 0 ? (
          <div className="p-8 text-center text-sm" style={{ color: TEXT_MUTED }}>
            {total === 0
              ? "No active @roseandco.com users found."
              : "No users have a role yet."}
          </div>
        ) : (
          <ul className="divide-y divide-[rgba(16,24,40,0.06)]">
            {displayed.map((u) => {
              const key = u.email.toLowerCase()
              const value = u.role
              const meta = value ? ROLE_META[value] : null
              const state = saveState[key] ?? "idle"
              // Level-2 data scopes (staging). Super User / Admin → All implied +
              // locked: getUserScopes bypasses the scopes table for both
              // (hasSuperUserPrivileges), so a box here would do nothing.
              const rowScopes = scopes[key] ?? u.scopes
              const superLock = hasSuperUserPrivileges(value)
              const allOn = superLock || rowScopes.all
              const scState = scopeSave[key] ?? "idle"
              // Per-user page grants are a no-op for super_user / admin (they
              // already reach everything grantable) and for no-role users
              // (denied before the list is read) — so no panel for them.
              const canGrantPages = value !== null && !superLock
              const pagesShown = canGrantPages && !!pagesOpen[key]
              const grantCount = (pageGrants[key] ?? []).length
              return (
                <li key={key} className="px-4 py-1.5">
                <div className="flex items-center gap-3">
                  {/* Name + email + resolve badge — FIXED-WIDTH left column, so the
                      data-scope group starts at the same x on every row (long
                      names/emails truncate rather than push the columns). */}
                  <div className="flex w-72 shrink-0 items-baseline gap-1.5 text-sm">
                    <span
                      className="min-w-0 truncate font-semibold"
                      style={{ color: meta ? TEXT_PRIMARY : TEXT_MUTED }}
                    >
                      {u.name}
                    </span>
                    <span aria-hidden className="shrink-0" style={{ color: "#C3C8D2" }}>
                      ·
                    </span>
                    <span className="min-w-0 flex-1 truncate" style={{ color: TEXT_MUTED }}>
                      {u.email}
                    </span>
                    {/* Identity-mapping indicator — display-only diagnostic */}
                    <span className="shrink-0 self-center">
                      <ResolveBadge resolution={u.resolution} email={u.email} />
                    </span>
                  </div>

                  {/* Fills the rest of the row: the scope group is left-justified
                      right after the fixed name column, role controls pushed far right. */}
                  <div className="flex flex-1 items-center gap-x-4">
                    {/* Level-2 data scopes — left-justified, fixed start x, stable
                        order so each checkbox lines up in a column down the table.
                        `ml-4` adds a clear break after the resolve badge (applied to
                        the whole group, so the aligned column just shifts right). */}
                    <div className="ml-4 flex shrink-0 items-center gap-x-2.5 text-xs">
                      {/* All — overrides the other four; implied + locked for Super User */}
                      <label
                        className={cn(
                          "flex items-center gap-1",
                          superLock ? "cursor-default" : "cursor-pointer",
                        )}
                        style={{ color: TEXT_PRIMARY }}
                      >
                        <input
                          type="checkbox"
                          checked={allOn}
                          disabled={superLock || scState === "saving"}
                          onChange={(e) => handleScopeChange(u, "all", e.target.checked)}
                          className="size-3.5 cursor-pointer accent-[#1E2858] disabled:cursor-not-allowed"
                          aria-label={`All data for ${u.name}`}
                        />
                        All
                      </label>

                      {SCOPE_FIELDS.map((f) => {
                        // All (or Super User) overrides these — dim + disable them.
                        const disabled = allOn || scState === "saving"
                        return (
                          <label
                            key={f.key}
                            title={f.title}
                            className={cn(
                              "flex items-center gap-1",
                              disabled ? "cursor-default opacity-40" : "cursor-pointer",
                            )}
                            style={{ color: TEXT_PRIMARY }}
                          >
                            <input
                              type="checkbox"
                              checked={rowScopes[f.key]}
                              disabled={disabled}
                              onChange={(e) => handleScopeChange(u, f.key, e.target.checked)}
                              className="size-3.5 cursor-pointer accent-[#1E2858] disabled:cursor-not-allowed"
                              aria-label={`${f.label} for ${u.name}`}
                            />
                            {f.label}
                          </label>
                        )
                      })}

                      {/* Financials — FIELD-level grant, orthogonal to the row
                          scopes above: it decides whether this person may see
                          dollar figures (Portfolio Retainer + contract doc,
                          Client Detail Annualized Retainer + $ per Meeting), not
                          which rows they get. Deliberately NOT dimmed by "All"
                          (All is a row override and says nothing about money);
                          only Super User locks it on. */}
                      <span aria-hidden style={{ color: "#C3C8D2" }}>
                        |
                      </span>
                      <label
                        title="Financials — may see retainer / fee dollar figures (Portfolio Retainer column + contract doc, Client Detail Annualized Retainer and $ per Meeting). Independent of the row scopes."
                        className={cn(
                          "flex items-center gap-1",
                          superLock ? "cursor-default" : "cursor-pointer",
                        )}
                        style={{ color: TEXT_PRIMARY }}
                      >
                        <input
                          type="checkbox"
                          checked={superLock || rowScopes.financials}
                          disabled={superLock || scState === "saving"}
                          onChange={(e) => handleScopeChange(u, "financials", e.target.checked)}
                          className="size-3.5 cursor-pointer accent-[#0E7C56] disabled:cursor-not-allowed"
                          aria-label={`Financials for ${u.name}`}
                        />
                        Financials
                      </label>

                      {/* Claim feedback — a CAPABILITY, like Financials not a
                          row scope: may this person claim Feedback tasks on
                          Feedback Reports? Super User implies it. */}
                      <label
                        title="Claim feedback — may claim unclaimed Feedback report tasks (Feedback Reports + the event drawer). Also grantable per role in Admin → Roles. Independent of the row scopes."
                        className={cn(
                          "flex items-center gap-1",
                          superLock ? "cursor-default" : "cursor-pointer",
                        )}
                        style={{ color: TEXT_PRIMARY }}
                      >
                        <input
                          type="checkbox"
                          checked={superLock || rowScopes.claim_feedback}
                          disabled={superLock || scState === "saving"}
                          onChange={(e) => handleScopeChange(u, "claim_feedback", e.target.checked)}
                          className="size-3.5 cursor-pointer accent-[#0E7C56] disabled:cursor-not-allowed"
                          aria-label={`Claim feedback for ${u.name}`}
                        />
                        Claim feedback
                      </label>

                      {/* Mark feedback received (2026-10-16) — a CAPABILITY, like
                          Claim feedback: Mark feedback all in, plus assign /
                          release / reassign Feedback report tasks. Super User
                          implies it. The role-level half is in Admin → Roles. */}
                      <label
                        title="Mark feedback received — may mark a report's feedback all in, and assign / release / reassign its Feedback report task. Independent of the row scopes."
                        className={cn(
                          "flex items-center gap-1",
                          superLock ? "cursor-default" : "cursor-pointer",
                        )}
                        style={{ color: TEXT_PRIMARY }}
                      >
                        <input
                          type="checkbox"
                          checked={superLock || rowScopes.mark_feedback_received}
                          disabled={superLock || scState === "saving"}
                          onChange={(e) => handleScopeChange(u, "mark_feedback_received", e.target.checked)}
                          className="size-3.5 cursor-pointer accent-[#0E7C56] disabled:cursor-not-allowed"
                          aria-label={`Mark feedback received for ${u.name}`}
                        />
                        Mark feedback received
                      </label>

                      {superLock ? (
                        <span style={{ color: TEXT_MUTED }}>· implied by {meta?.label ?? "Super User"}</span>
                      ) : null}

                      <span className="flex items-center text-[11px]" style={{ color: TEXT_MUTED }}>
                        {scState === "saving" ? (
                          <>
                            <Loader2 className="mr-1 size-3 animate-spin" /> Saving…
                          </>
                        ) : scState === "saved" ? (
                          <>
                            <Check className="mr-1 size-3 text-emerald-600" /> Saved
                          </>
                        ) : null}
                      </span>
                    </div>

                    {/* Role controls — pushed to the far right (unchanged). */}
                    <div className="ml-auto flex shrink-0 items-center gap-2">
                      {/* Pages — per-user page grants panel (toggles open below the row). */}
                      {canGrantPages ? (
                        <button
                          type="button"
                          onClick={() => setPagesOpen((o) => ({ ...o, [key]: !o[key] }))}
                          aria-expanded={pagesShown}
                          title={`Individual page grants for ${u.name}`}
                          className="flex items-center gap-1 rounded-md px-1.5 py-1 text-xs text-[#5B6472] transition-colors hover:bg-[#F4F6F9] hover:text-[#1E2858]"
                        >
                          {pagesShown ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
                          Pages
                          {grantCount > 0 ? (
                            <span className="rounded-full bg-[#EAF3EE] px-1.5 text-[10px] font-medium text-[#0E7C56]">
                              +{grantCount}
                            </span>
                          ) : null}
                        </button>
                      ) : null}
                      {/* View as this person — super-user testing. Posts the email
                          to the server action (which re-checks the real role),
                          sets the view_as_user cookie, and redirects into their
                          view. The top banner is the always-present way back. */}
                      <form action={setViewAsUserAction}>
                        <input type="hidden" name="email" value={u.email} />
                        <button
                          type="submit"
                          title={`View the app as ${u.name}`}
                          className="flex items-center gap-1 rounded-md px-1.5 py-1 text-xs text-[#5B6472] transition-colors hover:bg-[#F4F6F9] hover:text-[#1E2858]"
                        >
                          <Eye className="size-3.5" />
                          <span className="hidden sm:inline">View as</span>
                        </button>
                      </form>
                      {meta ? (
                        <span
                          className="hidden rounded-full px-2 py-0.5 text-[11px] font-medium sm:inline"
                          style={{ background: meta.bg, color: meta.text }}
                        >
                          {meta.label}
                        </span>
                      ) : null}
                      <span className="flex w-16 items-center justify-end text-xs" style={{ color: TEXT_MUTED }}>
                        {state === "saving" ? (
                          <>
                            <Loader2 className="mr-1 size-3 animate-spin" /> Updating…
                          </>
                        ) : state === "saved" ? (
                          <>
                            <Check className="mr-1 size-3 text-emerald-600" /> Saved
                          </>
                        ) : null}
                      </span>
                      <select
                        aria-label={`Role for ${u.name}`}
                        value={value ?? ""}
                        disabled={state === "saving"}
                        onChange={(e) => handleChange(u, e.target.value)}
                        className="h-8 cursor-pointer px-2 text-sm disabled:cursor-not-allowed disabled:opacity-60"
                        style={CONTROL_STYLE}
                      >
                        {ROLE_OPTIONS.map((o) => (
                          <option key={o.value} value={o.value}>
                            {o.label}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                </div>
                {pagesShown && value ? (
                  <PagesPanel
                    role={value}
                    roleRoutes={rolePages[value] ?? []}
                    roleLevels={roleCrmLevels[value] ?? {}}
                    grants={pageGrants[key] ?? []}
                    saving={pageSaving[key] ?? {}}
                    nameFor={nameFor}
                    onToggle={(route, on) => handlePageGrant(u, route, on)}
                    onLevel={(route, roleLevel, next) => handleCrmLevel(u, route, roleLevel, next)}
                  />
                ) : null}
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </div>
  )
}
