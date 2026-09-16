"use client"

/**
 * Admin → Account Teams: the searchable client list and the six-slot editor.
 *
 * ⚠️  SETUP ONLY. Saving here writes `public.account_team_members` and affects
 * NOTHING else in the app — not scoping, not permissions, not the avatar
 * clusters on Portfolio / Profiles / Events, which still read the four `*_name`
 * columns off `public.accounts`. See the header of app/admin/account-teams/page.tsx.
 *
 * All the data arrives with the page — 228 accounts, ~801 assignments, ~50
 * people — so selecting a client is instant and needs no fetch. After a write
 * the page is refreshed so the server stays the single source of truth for
 * what is stored; the component keeps no optimistic copy to drift.
 */

import * as React from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { Check, RotateCw, Search, X } from "lucide-react"

import { AccountTeamAvatars as TeamAvatars } from "@/components/account-team-avatars"
import { ListTitleCard } from "@/components/page-masthead"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { BRAND_BLUE, CANVAS, CARD_CLASS } from "@/lib/design"
import { baseTicker } from "@/lib/client-todo-format"
import {
  ACCOUNT_TEAM_ROLE_KEYS,
  ACCOUNT_TEAM_ROLE_META,
  type AccountTeamAssignment,
  type AccountTeamRole,
  type RosterPerson,
} from "@/lib/account-teams/roles"
import { type AccountStatus } from "@/lib/account-teams/status"
import { cn } from "@/lib/utils"
import { assignRole, clearRole, setAccountStatus } from "./actions"

export type AccountOption = { accountId: string; name: string; ticker: string | null }
export type PersonLookup = Record<string, { name: string; email: string | null; active: boolean }>

/** Assignments keyed account -> role. One per slot, which is today's UI rule. */
type TeamIndex = Map<string, Partial<Record<AccountTeamRole, AccountTeamAssignment>>>

function indexAssignments(rows: AccountTeamAssignment[]): TeamIndex {
  const out: TeamIndex = new Map()
  for (const r of rows) {
    const slot = out.get(r.accountId) ?? {}
    // If the table ever holds more than one person in a slot (the schema allows
    // it; the UI does not create it), the editor shows the most recently
    // updated one rather than picking arbitrarily.
    const cur = slot[r.role]
    if (!cur || (r.updatedAt ?? "") > (cur.updatedAt ?? "")) slot[r.role] = r
    out.set(r.accountId, slot)
  }
  return out
}

export function AccountTeamsView({
  accounts,
  assignments,
  people,
  roster,
  tableMissing,
  patchPath,
  statuses,
  statusTableMissing,
  statusPatchPath,
  readOnly,
}: {
  accounts: AccountOption[]
  assignments: AccountTeamAssignment[]
  people: PersonLookup
  roster: RosterPerson[]
  tableMissing: boolean
  patchPath: string
  /** The OWNED Active/Inactive flag, keyed by account. Absent = never set. */
  statuses: Record<string, AccountStatus>
  statusTableMissing: boolean
  statusPatchPath: string
  readOnly: boolean
}) {
  const router = useRouter()
  const [pending, startTransition] = React.useTransition()
  const [query, setQuery] = React.useState("")
  const [selectedId, setSelectedId] = React.useState<string | null>(accounts[0]?.accountId ?? null)
  const [error, setError] = React.useState<string | null>(null)
  const [savedAt, setSavedAt] = React.useState<number | null>(null)
  const [busyRole, setBusyRole] = React.useState<AccountTeamRole | null>(null)
  const [busyStatus, setBusyStatus] = React.useState(false)

  const teams = React.useMemo(() => indexAssignments(assignments), [assignments])

  const matches = React.useMemo(() => {
    const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean)
    if (!terms.length) return accounts
    return accounts.filter((a) => {
      const hay = `${a.name} ${a.ticker ?? ""}`.toLowerCase()
      return terms.every((t) => hay.includes(t))
    })
  }, [accounts, query])

  const selected = React.useMemo(
    () => accounts.find((a) => a.accountId === selectedId) ?? null,
    [accounts, selectedId],
  )
  const team = selectedId ? (teams.get(selectedId) ?? {}) : {}

  /** Run a write, surface its error, and re-read from the server on success. */
  const run = React.useCallback(
    (role: AccountTeamRole, fn: () => Promise<{ ok: boolean; error?: string }>) => {
      setError(null)
      setBusyRole(role)
      startTransition(async () => {
        const res = await fn()
        setBusyRole(null)
        if (!res.ok) {
          setError(res.error ?? "Save failed.")
          return
        }
        setSavedAt(Date.now())
        router.refresh()
      })
    },
    [router],
  )

  /** The status write. Same shape as `run`, with its own busy flag. */
  const runStatus = React.useCallback(
    (accountId: string, isActive: boolean) => {
      setError(null)
      setBusyStatus(true)
      startTransition(async () => {
        const res = await setAccountStatus({ accountId, isActive })
        setBusyStatus(false)
        if (!res.ok) {
          setError(res.error ?? "Save failed.")
          return
        }
        setSavedAt(Date.now())
        router.refresh()
      })
    },
    [router],
  )

  return (
    <>
      <div className="mb-4">
        <ListTitleCard
          eyebrow="Admin"
          title="Account Teams"
          subtitle="Who holds each of the six account-team roles, per client. Seeded from the CRM and dashboard-owned from here on. Super-user only."
        />
      </div>

      {/* The scope guardrail, stated on the page itself — this is the single
          most important thing for anyone landing here to understand. */}
      <div className="mb-3 rounded-lg border border-amber-300/60 bg-amber-50 px-4 py-3 text-[13px] text-amber-900">
        <span className="font-semibold">Setup only — nothing else reads this yet.</span> Editing a
        team <em>or the Active/Inactive status</em> here changes this page and nothing more. It does
        not affect who can see which client, any report, the account-team avatars on Portfolio,
        Profiles or Events, or which clients appear anywhere — those all still read the CRM fields
        on the account record. This is groundwork for making account teams and status drive the app
        later.
      </div>

      {tableMissing && (
        <div className="mb-3 rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-[13px]">
          <div className="font-medium text-destructive">
            The <code>account_team_members</code> table does not exist yet
          </div>
          <div className="mt-1 text-muted-foreground">
            Run <code>{patchPath}</code> in Supabase, then reload. Until then every role reads as
            unassigned and saving will fail.
          </div>
        </div>
      )}

      {statusTableMissing && (
        <div className="mb-3 rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-[13px]">
          <div className="font-medium text-destructive">
            The <code>account_status</code> table does not exist yet
          </div>
          <div className="mt-1 text-muted-foreground">
            Run <code>{statusPatchPath}</code> in Supabase, then reload. Until then every client
            reads as &ldquo;Not set&rdquo; and the toggle will fail.
          </div>
        </div>
      )}

      {readOnly && (
        <div className="mb-3 rounded-lg border border-input bg-muted/40 px-4 py-2 text-[13px] text-muted-foreground">
          You are viewing as someone else, so editing is disabled. Exit &ldquo;View as&rdquo; to
          make changes.
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-[320px_1fr]">
        {/* ---------------------------------------------------------- client list */}
        <div className={cn(CARD_CLASS, "flex flex-col overflow-hidden")}>
          <div className="border-b p-3" style={{ background: CANVAS }}>
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search clients"
                aria-label="Search clients"
                className="h-9 pl-8 pr-8"
              />
              {query && (
                <button
                  type="button"
                  onClick={() => setQuery("")}
                  aria-label="Clear search"
                  className="absolute right-2 top-1/2 -translate-y-1/2 cursor-pointer text-muted-foreground hover:text-foreground"
                >
                  <X className="size-3.5" />
                </button>
              )}
            </div>
            <div className="mt-2 text-[11px] text-muted-foreground">
              {matches.length.toLocaleString()} of {accounts.length.toLocaleString()} clients
            </div>
          </div>

          <ul className="max-h-[calc(100vh-22rem)] min-h-[300px] overflow-y-auto p-1">
            {matches.length === 0 && (
              <li className="px-3 py-6 text-center text-[13px] text-muted-foreground">
                No client matches &ldquo;{query}&rdquo;.
              </li>
            )}
            {matches.map((a) => {
              const slot = teams.get(a.accountId) ?? {}
              const filled = ACCOUNT_TEAM_ROLE_KEYS.filter((r) => slot[r]).length
              return (
                <li key={a.accountId}>
                  <button
                    type="button"
                    onClick={() => setSelectedId(a.accountId)}
                    aria-current={a.accountId === selectedId}
                    className={cn(
                      "flex w-full cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-left hover:bg-muted/60",
                      a.accountId === selectedId && "bg-muted/70",
                    )}
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13px] font-medium" title={a.name}>
                        {a.name}
                      </span>
                      <span className="block truncate text-[11px] text-muted-foreground">
                        {a.ticker ? baseTicker(a.ticker) : "—"}
                      </span>
                    </span>
                    {/* The team at a glance, so the list scans without needing a
                        full clients x roles grid. */}
                    <TeamAvatars
                      members={ACCOUNT_TEAM_ROLE_KEYS.map((r) => {
                        const m = ACCOUNT_TEAM_ROLE_META[r]
                        const asg = slot[r]
                        return {
                          role: m.label,
                          name: asg ? (people[asg.userId]?.name ?? null) : null,
                          bg: m.bg,
                          fg: m.fg,
                        }
                      })}
                    />
                    <StatusDot status={statuses[a.accountId] ?? null} />
                    <span className="w-8 shrink-0 text-right text-[11px] tabular-nums text-muted-foreground">
                      {filled}/6
                    </span>
                  </button>
                </li>
              )
            })}
          </ul>
        </div>

        {/* -------------------------------------------------------------- editor */}
        <div className={cn(CARD_CLASS, "p-4")}>
          {!selected ? (
            <div className="py-16 text-center text-sm text-muted-foreground">
              Select a client to edit its team.
            </div>
          ) : (
            <>
              <div className="mb-4 flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-[11px] uppercase tracking-wider text-[#9AA1AD]">Client</div>
                  <h2 className="truncate text-[17px] font-semibold text-[#1A2233]">
                    {selected.name}
                  </h2>
                  <Link
                    href={`/client-detail?account_id=${selected.accountId}`}
                    className="text-[12px] font-medium hover:underline"
                    style={{ color: BRAND_BLUE }}
                  >
                    Open client detail →
                  </Link>
                </div>
                {savedAt && !error && (
                  <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-emerald-50 px-2 py-1 text-[11px] font-medium text-emerald-800">
                    <Check className="size-3" /> Saved
                  </span>
                )}
                {pending && (
                  <span className="inline-flex shrink-0 items-center gap-1 text-[11px] text-muted-foreground">
                    <RotateCw className="size-3 animate-spin" /> Saving…
                  </span>
                )}
              </div>

              {error && (
                <div className="mb-3 flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-[13px]">
                  <span className="flex-1 text-destructive">{error}</span>
                  <button
                    type="button"
                    onClick={() => setError(null)}
                    aria-label="Dismiss"
                    className="cursor-pointer text-muted-foreground hover:text-foreground"
                  >
                    <X className="size-3.5" />
                  </button>
                </div>
              )}

              <StatusToggle
                status={statuses[selected.accountId] ?? null}
                disabled={readOnly || statusTableMissing || pending}
                busy={busyStatus}
                onSet={(next) => runStatus(selected.accountId, next)}
              />

              <div className="space-y-2">
                {ACCOUNT_TEAM_ROLE_KEYS.map((role) => (
                  <RoleSlot
                    key={role}
                    role={role}
                    assignment={team[role] ?? null}
                    people={people}
                    roster={roster}
                    disabled={readOnly || tableMissing || pending}
                    busy={busyRole === role}
                    onAssign={(userId) =>
                      run(role, () =>
                        assignRole({ accountId: selected.accountId, role, userId }),
                      )
                    }
                    onClear={() =>
                      run(role, () => clearRole({ accountId: selected.accountId, role }))
                    }
                  />
                ))}
              </div>

              <p className="mt-4 text-[11px] leading-relaxed text-muted-foreground">
                Rows marked <span className="font-medium">from CRM</span> were seeded from the
                account record and will be refreshed by the next CRM re-seed. Saving a change marks
                the slot <span className="font-medium">manual</span>, and the seed then leaves it
                alone permanently — this page becomes its owner. Clearing a slot makes it
                re-seedable again.
              </p>
            </>
          )}
        </div>
      </div>
    </>
  )
}

/* -------------------------------------------------------------------------- */

/** One of the six role rows: current assignee, a picker, and a clear button. */
function RoleSlot({
  role,
  assignment,
  people,
  roster,
  disabled,
  busy,
  onAssign,
  onClear,
}: {
  role: AccountTeamRole
  assignment: AccountTeamAssignment | null
  people: PersonLookup
  roster: RosterPerson[]
  disabled: boolean
  busy: boolean
  onAssign: (userId: string) => void
  onClear: () => void
}) {
  const meta = ACCOUNT_TEAM_ROLE_META[role]
  const current = assignment ? people[assignment.userId] : null
  // A seeded assignee may have been deactivated since — 38 rows are like this.
  // Show them, flagged, rather than rendering the slot as empty.
  const staleAssignee = !!assignment && current != null && !current.active

  return (
    <div className="flex flex-wrap items-center gap-3 rounded-md border border-[#E4E9F4] bg-[#F9FAFD] px-3 py-2">
      <div className="w-[150px] shrink-0">
        <div className="text-[13px] font-medium text-[#1A2233]">{meta.label}</div>
        <div className="text-[10px] text-muted-foreground" title={`Seeded from ${meta.crmField}`}>
          {meta.crmField}
        </div>
      </div>

      <div className="flex min-w-[190px] flex-1 items-center gap-2">
        {current ? (
          <>
            <TeamAvatars members={[{ role: meta.label, name: current.name, bg: meta.bg, fg: meta.fg }]} />
            <span className="min-w-0">
              <span className="block truncate text-[13px]">{current.name}</span>
              <span className="block truncate text-[10px] text-muted-foreground">
                {assignment?.source === "crm_seed" ? "from CRM" : "manual"}
                {staleAssignee && " · inactive employee"}
              </span>
            </span>
          </>
        ) : (
          <span className="text-[13px] text-muted-foreground">Unassigned</span>
        )}
      </div>

      <PersonPicker
        label={meta.label}
        roster={roster}
        currentUserId={assignment?.userId ?? null}
        disabled={disabled}
        busy={busy}
        onPick={onAssign}
      />

      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={disabled || !assignment}
        onClick={onClear}
        className="cursor-pointer"
      >
        Clear
      </Button>
    </div>
  )
}

/**
 * A typeahead over the Rose employee roster.
 *
 * Same shape as the quick-filter typeahead in
 * components/table-views/quick-filters.tsx — a plain input plus a listbox, not a
 * native select, because a native one cannot be searched. What it must not lose
 * by being custom: Escape closes, arrows move, Enter picks, an outside click
 * closes, and the whole thing is labelled and announced.
 *
 * The email is shown under each name because three people (Blair Mutschler,
 * Brian Smith, Simon Rose) have two mailboxes and therefore two `user_id`s, and
 * the name alone cannot tell them apart.
 */
function PersonPicker({
  label,
  roster,
  currentUserId,
  disabled,
  busy,
  onPick,
}: {
  label: string
  roster: RosterPerson[]
  currentUserId: string | null
  disabled: boolean
  busy: boolean
  onPick: (userId: string) => void
}) {
  const [open, setOpen] = React.useState(false)
  const [query, setQuery] = React.useState("")
  const [active, setActive] = React.useState(0)
  const rootRef = React.useRef<HTMLDivElement>(null)
  const listId = React.useId()
  const inputId = React.useId()

  const dupeNames = React.useMemo(() => {
    const c = new Map<string, number>()
    for (const p of roster) c.set(p.name, (c.get(p.name) ?? 0) + 1)
    return new Set([...c].filter(([, n]) => n > 1).map(([n]) => n))
  }, [roster])

  const matches = React.useMemo(() => {
    const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean)
    const hits = terms.length
      ? roster.filter((p) => {
          const hay = `${p.name} ${p.email}`.toLowerCase()
          return terms.every((t) => hay.includes(t))
        })
      : roster
    return hits.slice(0, 50)
  }, [roster, query])

  React.useEffect(() => {
    if (!open) return
    const onDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener("pointerdown", onDown)
    return () => document.removeEventListener("pointerdown", onDown)
  }, [open])

  const commit = (userId: string) => {
    setOpen(false)
    setQuery("")
    onPick(userId)
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      setOpen(false)
      return
    }
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault()
      if (!open) setOpen(true)
      setActive((i) => {
        const n = matches.length
        if (n === 0) return 0
        return e.key === "ArrowDown" ? (i + 1) % n : (i - 1 + n) % n
      })
      return
    }
    if (e.key === "Enter" && open && matches[active]) {
      e.preventDefault()
      commit(matches[active].userId)
    }
  }

  return (
    <div ref={rootRef} className="relative">
      <label htmlFor={inputId} className="sr-only">
        Assign {label}
      </label>
      <Input
        id={inputId}
        role="combobox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-autocomplete="list"
        autoComplete="off"
        disabled={disabled}
        value={query}
        placeholder={busy ? "Saving…" : "Assign…"}
        onFocus={() => {
          setOpen(true)
          setActive(0)
        }}
        onChange={(e) => {
          setQuery(e.target.value)
          setOpen(true)
          setActive(0)
        }}
        onKeyDown={onKeyDown}
        className="h-9 w-[200px]"
      />

      {open && (
        <ul
          id={listId}
          role="listbox"
          aria-label={`Assign ${label}`}
          className="absolute right-0 z-50 mt-1 max-h-[280px] w-[280px] overflow-y-auto rounded-md border bg-card p-1 shadow-lg"
        >
          {matches.length === 0 && (
            <li className="px-2 py-1.5 text-[13px] text-muted-foreground">No match.</li>
          )}
          {matches.map((p, i) => (
            <li key={p.userId}>
              <button
                type="button"
                role="option"
                aria-selected={p.userId === currentUserId}
                onMouseDown={(e) => e.preventDefault()}
                onMouseEnter={() => setActive(i)}
                onClick={() => commit(p.userId)}
                className={cn(
                  "w-full cursor-pointer rounded px-2 py-1 text-left hover:bg-muted/60",
                  i === active && "bg-muted/60",
                  p.userId === currentUserId && "font-medium",
                )}
              >
                <span className="block truncate text-[13px]">{p.name}</span>
                {/* Only shown when the name alone is ambiguous. */}
                {dupeNames.has(p.name) && (
                  <span className="block truncate text-[10px] text-muted-foreground">
                    {p.email}
                  </span>
                )}
              </button>
            </li>
          ))}
          {matches.length === 50 && (
            <li className="px-2 py-1 text-[11px] text-muted-foreground">
              Showing first 50 — keep typing to narrow.
            </li>
          )}
        </ul>
      )}
    </div>
  )
}

/* -------------------------------------------------------------------------- */

/**
 * The owned Active/Inactive status for the selected client.
 *
 * ⚠️  SETUP ONLY. Flipping this writes `public.account_status` and changes
 * NOTHING else — no page filters on it. It is also NOT the CRM's
 * `accounts.state_label`, which is what roughly fifteen views and
 * app/institution-style/page.tsx still read; the two can diverge the moment this
 * is used, and that divergence is inert by design. See lib/account-teams/status.ts.
 *
 * Three states, not two: Active, Inactive, and NOT SET (no row yet). "Not set"
 * is shown rather than defaulted to Active, because an unseeded database
 * defaulting to Active would look like somebody had decided.
 */
function StatusToggle({
  status,
  disabled,
  busy,
  onSet,
}: {
  status: AccountStatus | null
  disabled: boolean
  busy: boolean
  onSet: (isActive: boolean) => void
}) {
  const current = status?.isActive ?? null

  return (
    <div className="mb-3 flex flex-wrap items-center gap-3 rounded-md border border-[#E4E9F4] bg-white px-3 py-2">
      <div className="w-[150px] shrink-0">
        <div className="text-[13px] font-medium text-[#1A2233]">Client status</div>
        <div className="text-[10px] text-muted-foreground" title="Seeded from accounts.state_label">
          accounts.state_label
        </div>
      </div>

      <div className="flex min-w-[190px] flex-1 items-center gap-2">
        {current === null ? (
          <span className="text-[13px] text-muted-foreground">Not set</span>
        ) : (
          <span
            className="inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium"
            style={
              current
                ? { backgroundColor: "#E7F5EC", color: "#1B6B3A" }
                : { backgroundColor: "#F2F3F5", color: "#5B6472" }
            }
          >
            {current ? "Active" : "Inactive"}
          </span>
        )}
        <span className="text-[10px] text-muted-foreground">
          {status ? (status.source === "crm_seed" ? "from CRM" : "manual") : "no record yet"}
          {status?.changedBy && status.source === "manual" && ` · ${status.changedBy}`}
        </span>
      </div>

      {/* Two explicit buttons rather than a switch: a switch has no way to show
          the "not set" third state, and it invites an accidental flip on a
          control that is meant to be a deliberate decision. */}
      <div className="flex items-center gap-1">
        <Button
          type="button"
          variant={current === true ? "default" : "outline"}
          size="sm"
          disabled={disabled || busy}
          onClick={() => onSet(true)}
          className="cursor-pointer"
          aria-pressed={current === true}
        >
          Active
        </Button>
        <Button
          type="button"
          variant={current === false ? "default" : "outline"}
          size="sm"
          disabled={disabled || busy}
          onClick={() => onSet(false)}
          className="cursor-pointer"
          aria-pressed={current === false}
        >
          Inactive
        </Button>
      </div>
    </div>
  )
}

/** The roster row's status marker. A quiet dot — this is context, not the subject. */
function StatusDot({ status }: { status: AccountStatus | null }) {
  const label =
    status === null ? "Status not set" : status.isActive ? "Active" : "Inactive"
  return (
    <span
      title={label}
      aria-label={label}
      className="size-2 shrink-0 rounded-full"
      style={{
        backgroundColor:
          status === null ? "#D7DBE3" : status.isActive ? "#3FA46A" : "#B9BEC7",
      }}
    />
  )
}
