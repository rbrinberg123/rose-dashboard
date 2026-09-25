"use client"

/**
 * Admin → Time Off Reviewers: one row per person, their reviewing team as
 * removable chips, and an "Add reviewer" picker. Writes go through ./actions.ts.
 */

import * as React from "react"
import { useRouter } from "next/navigation"
import { Loader2, Search, X } from "lucide-react"
import { toast } from "sonner"

import { ListTitleCard } from "@/components/page-masthead"
import { Input } from "@/components/ui/input"
import { CARD_CLASS } from "@/lib/design"
import { addTimeOffReviewer, removeTimeOffReviewer } from "./actions"

export type ReviewerPerson = { userId: string; name: string; email: string }
export type ReviewerAssignment = { id: string; person_user_id: string; reviewer_user_id: string }

export function ReviewersView({
  roster,
  names,
  assignments,
  tableMissing,
  tableError,
  patchPath,
}: {
  roster: ReviewerPerson[]
  names: Record<string, string>
  assignments: ReviewerAssignment[]
  tableMissing: boolean
  tableError: string | null
  patchPath: string
}) {
  const router = useRouter()
  const [query, setQuery] = React.useState("")
  const [onlyAssigned, setOnlyAssigned] = React.useState(false)
  const [busy, setBusy] = React.useState<string | null>(null)
  const [, startTransition] = React.useTransition()

  const byPerson = React.useMemo(() => {
    const m = new Map<string, ReviewerAssignment[]>()
    for (const a of assignments) {
      const list = m.get(a.person_user_id) ?? []
      list.push(a)
      m.set(a.person_user_id, list)
    }
    return m
  }, [assignments])

  // Everyone on the roster, plus anyone who has a team but has since left it.
  const people = React.useMemo(() => {
    const out = [...roster]
    const seen = new Set(roster.map((p) => p.userId))
    for (const pid of byPerson.keys()) {
      if (!seen.has(pid)) out.push({ userId: pid, name: names[pid] ?? "(unknown)", email: "inactive" })
    }
    return out
  }, [roster, byPerson, names])

  const shown = people.filter((p) => {
    if (onlyAssigned && !byPerson.has(p.userId)) return false
    const q = query.trim().toLowerCase()
    return !q || p.name.toLowerCase().includes(q) || p.email.toLowerCase().includes(q)
  })

  function run(key: string, fn: () => Promise<{ ok: boolean; error?: string }>, success: string) {
    setBusy(key)
    startTransition(async () => {
      const r = await fn()
      setBusy(null)
      if (!r.ok) {
        toast.error("Could not save", { description: r.error })
        return
      }
      toast.success(success)
      router.refresh()
    })
  }

  return (
    <>
      <div className="mb-4">
        <ListTitleCard
          eyebrow="Admin"
          title="Time Off Reviewers"
          subtitle="For each person, the small team who approve or deny their time off. This is the Reviewing Team on CRM → Time Off, and decides whose Alerts page a pending request appears on. Changes apply immediately. Super-user only."
        />
      </div>

      {tableMissing && (
        <div className="mb-3 rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-[13px]">
          <div className="font-medium text-destructive">The time_off_reviewers table can&apos;t be read</div>
          <div className="mt-1 text-muted-foreground">
            {tableError} — if it doesn&apos;t exist yet, run <code>{patchPath}</code> in Supabase.
          </div>
        </div>
      )}

      <div className="mb-3 flex flex-wrap items-center gap-3">
        <div className="relative min-w-[220px] max-w-xs flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search people"
            className="h-9 pl-8"
          />
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={onlyAssigned} onChange={(e) => setOnlyAssigned(e.target.checked)} />
          Only people with a team
        </label>
        <span className="text-sm text-muted-foreground">
          {byPerson.size} of {people.length} people have a reviewing team
        </span>
      </div>

      <div className={`${CARD_CLASS} divide-y overflow-hidden`}>
        {shown.map((p) => {
          const team = byPerson.get(p.userId) ?? []
          const teamIds = new Set(team.map((a) => a.reviewer_user_id))
          const candidates = roster.filter((r) => r.userId !== p.userId && !teamIds.has(r.userId))
          return (
            <div key={p.userId} className="flex flex-wrap items-center gap-3 px-4 py-2">
              <div className="w-[220px] min-w-0">
                <div className="truncate text-[13px] font-medium">{p.name}</div>
                <div className="truncate text-[11px] text-muted-foreground">{p.email}</div>
              </div>
              <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
                {team.length === 0 && <span className="text-[12px] text-muted-foreground">No reviewers</span>}
                {team.map((a) => (
                  <span
                    key={a.id}
                    className="inline-flex items-center gap-1 rounded-full bg-[#EEF2FB] py-0.5 pl-2.5 pr-1 text-[12px] text-[#2D4A8A]"
                  >
                    {names[a.reviewer_user_id] ?? "(unknown)"}
                    <button
                      type="button"
                      aria-label={`Remove ${names[a.reviewer_user_id] ?? "reviewer"}`}
                      disabled={busy !== null || tableMissing}
                      onClick={() =>
                        run(a.id, () => removeTimeOffReviewer(a.id), "Reviewer removed")
                      }
                      className="rounded-full p-0.5 hover:bg-[#2D4A8A]/10"
                    >
                      {busy === a.id ? <Loader2 className="size-3 animate-spin" /> : <X className="size-3" />}
                    </button>
                  </span>
                ))}
              </div>
              <select
                aria-label={`Add a reviewer for ${p.name}`}
                value=""
                disabled={busy !== null || tableMissing}
                onChange={(e) => {
                  const rid = e.target.value
                  if (rid) run(`add:${p.userId}`, () => addTimeOffReviewer(p.userId, rid), "Reviewer added")
                }}
                className="h-8 w-[200px] rounded-md border border-input bg-background px-2 text-sm"
              >
                <option value="">{busy === `add:${p.userId}` ? "Adding…" : "+ Add reviewer"}</option>
                {candidates.map((c) => (
                  <option key={c.userId} value={c.userId}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
          )
        })}
        {shown.length === 0 && (
          <div className="px-4 py-8 text-center text-sm text-muted-foreground">No people match.</div>
        )}
      </div>
    </>
  )
}
