"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { Check, Loader2, AlertTriangle } from "lucide-react"
import { toast } from "sonner"

import { CARD_CLASS, CONTROL_STYLE, TEXT_MUTED, TEXT_PRIMARY } from "@/lib/design"
import { setUserRole } from "./actions"

/** null === "None" (no staged grant). */
export type RoleValue = "user" | "logistics" | "super_user" | null

export type UserRow = {
  email: string
  name: string
  role: RoleValue
}

const ROLE_OPTIONS: { value: string; label: string }[] = [
  { value: "", label: "None" },
  { value: "user", label: "User" },
  { value: "logistics", label: "Logistics" },
  { value: "super_user", label: "Super User" },
]

// Granted-role pill styling + sort priority. Higher-privilege roles float
// first; None has no pill and the lowest priority. Tints reuse the site
// palette (navy / brand-blue / money-green) so pills read as part of the
// system.
const ROLE_META: Record<
  Exclude<RoleValue, null>,
  { label: string; rank: number; bg: string; text: string }
> = {
  super_user: { label: "Super User", rank: 0, bg: "#E6E9F5", text: "#1E2858" },
  logistics: { label: "Logistics", rank: 1, bg: "#E7F1FB", text: "#0355A7" },
  user: { label: "User", rank: 2, bg: "#EAF3EE", text: "#0E7C56" },
}

/** Sort key: granted roles first (Super User → Logistics → User), then None. */
function rank(role: RoleValue): number {
  return role === null ? 3 : ROLE_META[role].rank
}

type SaveState = "idle" | "saving" | "saved"

export function UsersView({
  users,
  missingTable,
}: {
  users: UserRow[]
  missingTable: boolean
}) {
  const router = useRouter()
  // Local role state so the selector reflects the change immediately, keyed by
  // lower-cased email. Seeded from the server-rendered roster.
  const [roles, setRoles] = React.useState<Record<string, RoleValue>>(() => {
    const init: Record<string, RoleValue> = {}
    for (const u of users) init[u.email.toLowerCase()] = u.role
    return init
  })
  const [saveState, setSaveState] = React.useState<Record<string, SaveState>>({})
  const [grantedOnly, setGrantedOnly] = React.useState(false)
  const [, startTransition] = React.useTransition()

  const total = users.length
  const granted = Object.values(roles).filter((r) => r !== null).length
  const none = total - granted

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

      {/* Staging notice */}
      <div
        className="flex items-start gap-2 rounded-lg border border-amber-300/60 bg-amber-50 p-3 text-xs"
        style={{ color: "#92600B" }}
      >
        <AlertTriangle className="mt-0.5 size-4 shrink-0" />
        <p>
          <span className="font-medium">Staging only.</span> Roles assigned here are saved to a
          decoupled table and have <span className="font-medium">no effect</span> on what anyone can
          access. Enforcement is unchanged until a separate go-live step points at these grants.
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
              return (
                <li key={key} className="flex items-center justify-between gap-3 px-4 py-1.5">
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
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
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
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </div>
  )
}
