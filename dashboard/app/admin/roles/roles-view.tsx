"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { AlertTriangle, Info, Lock } from "lucide-react"
import { toast } from "sonner"

import { CARD_CLASS, TEXT_MUTED, TEXT_PRIMARY } from "@/lib/design"
import {
  PAGE_REGISTRY,
  PAGE_SECTIONS,
  ASSIGNABLE_ROLES,
  type AssignableRole,
  type PageEntry,
} from "@/lib/page-registry"
import { setRolePageAccess } from "./actions"

/** Flat key into the grant/override maps. */
function keyFor(role: string, route: string): string {
  return `${role}|${route}`
}

export function RolesView({
  grants,
  missingTable,
}: {
  /** Persisted overrides keyed `${role}|${route}` → allowed. Absent ⇒ use the seed default. */
  grants: Record<string, boolean>
  missingTable: boolean
}) {
  const router = useRouter()
  const [, startTransition] = React.useTransition()

  // The editable columns (everyone except the locked super_user).
  const editableRoles = React.useMemo(
    () => ASSIGNABLE_ROLES.filter((r) => !r.locked),
    [],
  )

  // Now that this matrix is LIVE, every cell shows the TRUE enforced state:
  // checked === a saved `allowed = true` row in role_page_access. An unset cell
  // is not granted (default deny), so it shows unchecked — no seed defaults, so
  // the grid can never imply access that isn't actually enforced.
  const [allow, setAllow] = React.useState<Record<string, boolean>>(() => {
    const init: Record<string, boolean> = {}
    for (const entry of PAGE_REGISTRY) {
      for (const r of editableRoles) {
        const k = keyFor(r.value, entry.route)
        init[k] = grants[k] ?? false
      }
    }
    return init
  })
  const [pending, setPending] = React.useState<Set<string>>(new Set())

  function toggle(role: AssignableRole, entry: PageEntry, next: boolean) {
    const k = keyFor(role, entry.route)
    const prev = allow[k]
    // Optimistic — reflect the toggle immediately, mark the cell pending.
    setAllow((a) => ({ ...a, [k]: next }))
    setPending((p) => new Set(p).add(k))

    startTransition(async () => {
      const res = await setRolePageAccess(role, entry.route, next)
      setPending((p) => {
        const n = new Set(p)
        n.delete(k)
        return n
      })
      if (!res.ok) {
        setAllow((a) => ({ ...a, [k]: prev })) // roll back
        toast.error("Could not save", { description: res.error })
      } else {
        router.refresh()
      }
    })
  }

  // Per-role tally across all pages (super_user is always every page).
  const totals = ASSIGNABLE_ROLES.map((r) => {
    if (r.locked) return { role: r, count: PAGE_REGISTRY.length }
    const count = PAGE_REGISTRY.filter((e) => allow[keyFor(r.value, e.route)]).length
    return { role: r, count }
  })

  const grouped = PAGE_SECTIONS.map((section) => ({
    section,
    pages: PAGE_REGISTRY.filter((p) => p.section === section),
  })).filter((g) => g.pages.length > 0)

  const colCount = ASSIGNABLE_ROLES.length

  return (
    <div className="space-y-4">
      {/* Summary line */}
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm" style={{ color: TEXT_MUTED }}>
        <span className="font-medium tabular-nums" style={{ color: TEXT_PRIMARY }}>
          {PAGE_REGISTRY.length} pages
        </span>
        <span aria-hidden>·</span>
        <span>{ASSIGNABLE_ROLES.length} roles</span>
        {totals.map((t) => (
          <React.Fragment key={t.role.value}>
            <span aria-hidden>·</span>
            <span className="tabular-nums">
              {t.role.label}: {t.count}
            </span>
          </React.Fragment>
        ))}
      </div>

      {/* Live notice */}
      <div
        className="flex items-start gap-2 rounded-lg border border-[#BBD5F0] bg-[#EEF5FC] p-3 text-xs"
        style={{ color: "#0355A7" }}
      >
        <Info className="mt-0.5 size-4 shrink-0" />
        <p>
          <span className="font-medium">Live.</span> A page is allowed for a role only when its box
          is checked here — default deny, so a role with nothing checked can reach nothing.
          Super&nbsp;User always sees everything (locked). Changes take effect on the user&apos;s
          next page load.
        </p>
      </div>

      {missingTable ? (
        <div className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-xs text-destructive">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" />
          <p>
            The <code className="font-mono">public.role_page_access</code> table does not exist yet.
            Run the <span className="font-medium">CREATE TABLE</span> DDL in the Supabase SQL editor
            — until then, toggles will fail to save and every non-super role can reach nothing.
          </p>
        </div>
      ) : null}

      {/* Matrix */}
      <div className={`overflow-x-auto ${CARD_CLASS}`}>
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-[rgba(16,24,40,0.08)]">
              <th
                className="sticky left-0 z-10 bg-card px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wider"
                style={{ color: TEXT_MUTED }}
              >
                Page
              </th>
              {ASSIGNABLE_ROLES.map((r) => (
                <th
                  key={r.value}
                  className="px-3 py-2.5 text-center text-xs font-semibold"
                  style={{ color: TEXT_PRIMARY }}
                >
                  <span className="inline-flex items-center gap-1">
                    {r.label}
                    {r.locked ? <Lock className="size-3 opacity-60" /> : null}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {grouped.map(({ section, pages }) => (
              <React.Fragment key={section}>
                <tr>
                  <td
                    colSpan={colCount + 1}
                    className="bg-[#F7F8FA] px-4 py-1.5 text-[11px] font-semibold uppercase tracking-wider"
                    style={{ color: TEXT_MUTED }}
                  >
                    {section}
                  </td>
                </tr>
                {pages.map((entry) => (
                  <tr
                    key={entry.route}
                    className="border-b border-[rgba(16,24,40,0.05)] last:border-0 hover:bg-[#FAFBFC]"
                  >
                    <td className="sticky left-0 z-10 bg-card px-4 py-1.5">
                      <span className="font-medium" style={{ color: TEXT_PRIMARY }}>
                        {entry.label}
                      </span>
                      <span className="ml-2 font-mono text-[11px]" style={{ color: "#9AA1AD" }}>
                        {entry.route}
                      </span>
                    </td>
                    {ASSIGNABLE_ROLES.map((r) => {
                      const k = keyFor(r.value, entry.route)
                      const checked = r.locked ? true : allow[k]
                      const isPending = pending.has(k)
                      return (
                        <td key={r.value} className="px-3 py-1.5 text-center">
                          <input
                            type="checkbox"
                            aria-label={`${r.label} can access ${entry.label}`}
                            checked={checked}
                            disabled={r.locked || isPending}
                            onChange={(e) =>
                              !r.locked && toggle(r.value, entry, e.target.checked)
                            }
                            className="size-4 cursor-pointer accent-[#1E2858] disabled:cursor-not-allowed disabled:opacity-60"
                          />
                        </td>
                      )
                    })}
                  </tr>
                ))}
              </React.Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
