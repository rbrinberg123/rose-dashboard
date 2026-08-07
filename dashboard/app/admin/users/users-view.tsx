"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { Check, Loader2, AlertTriangle, Eye, Info, Flag } from "lucide-react"
import { toast } from "sonner"

import { cn } from "@/lib/utils"
import { CARD_CLASS, CONTROL_STYLE, TEXT_MUTED, TEXT_PRIMARY } from "@/lib/design"
import { setUserRole, setUserDataScopes, type DataScopes } from "./actions"
import { setViewAsUserAction } from "@/app/view-as-actions"

/** null === "None" (no staged grant). */
export type RoleValue = "user" | "client_manager" | "logistics" | "super_user" | null

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
}

/**
 * The four specific data-scope toggles (All is handled separately as the
 * override). STAGING ONLY — recorded here, enforced by nothing yet.
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
  { value: "client_manager", label: "Client Manager" },
  { value: "logistics", label: "Logistics" },
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
  logistics: { label: "Logistics", rank: 1, bg: "#E7F1FB", text: "#0355A7" },
  client_manager: { label: "Client Manager", rank: 2, bg: "#F3ECFB", text: "#6B3FA0" },
  user: { label: "User", rank: 3, bg: "#EAF3EE", text: "#0E7C56" },
}

/** Sort key: granted roles first (Super User → Logistics → Client Manager → User), then None. */
function rank(role: RoleValue): number {
  return role === null ? 4 : ROLE_META[role].rank
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

type SaveState = "idle" | "saving" | "saved"

export function UsersView({
  users,
  missingTable,
  missingScopesTable,
  sessionResolution,
}: {
  users: UserRow[]
  missingTable: boolean
  missingScopesTable: boolean
  sessionResolution: SessionResolution
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
          here but enforced in a later pass.
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

      {/* Roster */}
      <div className={CARD_CLASS}>
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
              // Level-2 data scopes (staging). Super User → All implied + locked.
              const rowScopes = scopes[key] ?? u.scopes
              const superLock = value === "super_user"
              const allOn = superLock || rowScopes.all
              const scState = scopeSave[key] ?? "idle"
              return (
                <li key={key} className="flex flex-col gap-1.5 px-4 py-2">
                  <div className="flex items-center justify-between gap-3">
                  {/* Name + email on one line */}
                  <div className="flex min-w-0 items-baseline gap-1.5 truncate text-sm">
                    <span
                      className="font-semibold"
                      style={{ color: meta ? TEXT_PRIMARY : TEXT_MUTED }}
                    >
                      {u.name}
                    </span>
                    <span aria-hidden style={{ color: "#C3C8D2" }}>
                      ·
                    </span>
                    <span className="truncate" style={{ color: TEXT_MUTED }}>
                      {u.email}
                    </span>
                    {/* Identity-mapping indicator — display-only diagnostic */}
                    <span className="shrink-0 self-center">
                      <ResolveBadge resolution={u.resolution} email={u.email} />
                    </span>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
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

                  {/* Level-2 data scopes — Account Management enforced on client pages */}
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                    <span
                      className="font-medium uppercase tracking-wide"
                      style={{ color: TEXT_MUTED }}
                    >
                      Data scope
                    </span>

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

                    {superLock ? (
                      <span style={{ color: TEXT_MUTED }}>· implied by Super User</span>
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
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </div>
  )
}
