"use client"

import * as React from "react"
import Link from "next/link"
import { Check, X } from "lucide-react"

import { AccountTeamAvatars as TeamAvatars } from "@/components/account-team-avatars"
import { STATUS_PILL_LIGHT, TEXT_MUTED, TEXT_PRIMARY, TEXT_TERTIARY } from "@/lib/design"
import { formatDay, stripTickerPrefix } from "@/lib/client-todo-format"
import type { ClientOnboardingRow } from "@/lib/types"
import { STEPS } from "@/app/onboarding/onboarding-table"
import { loadOnboardingDetail } from "./actions"

/**
 * My Dashboard → Onboarding feed → the ONBOARDING CARD. There was no onboarding
 * detail component to reuse (the Onboarding page is one table of every client),
 * so this is a compact, read-only drawer built in the same shell as the CRM
 * record drawers (scrim + 560px right panel). It shows, for one client, what
 * that client's row on the Onboarding page shows. Top → bottom: a compact strip
 * of key-date chips (onboarding start, contract start, first event), the nine
 * steps (done / not, with the date for the three dated ones — same STEPS
 * definition), then the onboarding notes. Days onboarding and the account team
 * (compact initials cluster, header-right) sit in the header.
 *
 * Data: loadOnboardingDetail — gated server-side to the card's own scope (a
 * client on the viewer's account team; super users pass).
 */

const OpenOnboardingContext = React.createContext<((accountId: string) => void) | null>(null)

const TEAM: { role: string; key: keyof ClientOnboardingRow; bg: string; fg: string }[] = [
  { role: "Account mgr", key: "sales_lead_primary_name", bg: "#1E2858", fg: "#FFFFFF" },
  { role: "Secondary", key: "secondary_manager_name", bg: "#3D5599", fg: "#FFFFFF" },
  { role: "Associate", key: "associate_name", bg: "#1C8C9C", fg: "#FFFFFF" },
  { role: "Logistics", key: "logistics_coordinator_name", bg: "#4FC6BC", fg: "#0A3B36" },
]

export function OnboardingDrawerHost({ allHref, children }: { allHref: string | null; children: React.ReactNode }) {
  const [openId, setOpenId] = React.useState<string | null>(null)
  const [row, setRow] = React.useState<ClientOnboardingRow | null>(null)
  const [error, setError] = React.useState<string | null>(null)

  const open = React.useCallback((id: string) => {
    setRow(null)
    setError(null)
    setOpenId(id)
  }, [])
  const close = React.useCallback(() => {
    setRow(null)
    setError(null)
    setOpenId(null)
  }, [])

  // The effect owns only the async fetch — every setState is in a callback.
  React.useEffect(() => {
    if (!openId) return
    let cancelled = false
    loadOnboardingDetail(openId).then((res) => {
      if (cancelled) return
      if (res.ok) setRow(res.data ?? null)
      else setError(res.error)
    })
    return () => {
      cancelled = true
    }
  }, [openId])

  return (
    <OpenOnboardingContext.Provider value={open}>
      {children}
      {openId && <OnboardingPane row={row} error={error} allHref={allHref} onClose={close} />}
    </OpenOnboardingContext.Provider>
  )
}

/** A dashboard row that opens the client's onboarding card instead of navigating. */
export function OpenOnboardingRow({ accountId, children }: { accountId: string; children: React.ReactNode }) {
  const open = React.useContext(OpenOnboardingContext)
  return (
    <button
      type="button"
      onClick={() => open?.(accountId)}
      className="block w-full cursor-pointer text-left transition-colors hover:bg-[rgba(16,24,40,0.02)] focus:outline-none focus-visible:bg-[rgba(16,24,40,0.04)]"
    >
      {children}
    </button>
  )
}

function OnboardingPane({
  row,
  error,
  allHref,
  onClose,
}: {
  row: ClientOnboardingRow | null
  error: string | null
  allHref: string | null
  onClose: () => void
}) {
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose()
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [onClose])

  const done = row ? STEPS.filter((s) => row[s.key] === true).length : 0
  const firstEvent = row?.first_event_name ? stripTickerPrefix(row.first_event_name, row.ticker_symbol).trim() : null

  return (
    <>
      {/* Scrim. Click anywhere off the panel to close. */}
      <div aria-hidden="true" onClick={onClose} className="fixed inset-0 z-40 bg-black/10" />
      <aside
        role="dialog"
        aria-modal="true"
        aria-label="Client onboarding"
        className="fixed right-0 top-0 z-50 flex h-screen w-[560px] max-w-[94vw] flex-col border-l border-[#E5E8EC] bg-white shadow-2xl"
      >
        <header className="border-b border-[#E5E8EC] px-5 py-4">
          <div className="flex items-start gap-3">
            <div className="min-w-0 flex-1">
              <div className="text-[11px] uppercase tracking-wider text-[#9AA1AD]">Client Onboarding</div>
              <h2 className="line-clamp-2 text-[17px] font-semibold text-[#1A2233]">
                {row ? (row.ticker_symbol ? `${row.ticker_symbol} · ${row.name}` : row.name) : error ? "Onboarding" : "Loading…"}
              </h2>
              {row && (
                <div className="mt-1 text-xs tabular-nums" style={{ color: TEXT_MUTED }}>
                  {done} of {STEPS.length} steps
                  {row.days_onboarding != null && <> · Day {row.days_onboarding}</>}
                </div>
              )}
            </div>
            {/* Account team — the shared compact initials cluster (as on Events /
                Portfolio), header-right, out of the dates strip's way. Each
                circle's tooltip is "Role: Name"; blank roles are dropped. */}
            {row && TEAM.some((t) => row[t.key]) && (
              <div className="shrink-0 pt-3.5" aria-label="Account team">
                <TeamAvatars size={30} members={TEAM.map((t) => ({ role: t.role, name: row[t.key] as string | null, bg: t.bg, fg: t.fg }))} />
              </div>
            )}
            <button type="button" onClick={onClose} aria-label="Close" className="cursor-pointer text-muted-foreground hover:text-foreground">
              <X className="size-4" />
            </button>
          </div>
        </header>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          {error && (
            <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">{error}</div>
          )}
          {!row && !error && <div className="py-10 text-center text-sm text-muted-foreground">Loading…</div>}
          {row && (
            <>
              {/* Key dates — one compact strip of chips, above the steps. */}
              <div className="mb-4 flex flex-wrap gap-1.5">
                <DateChip label="Onboarding start" value={formatDay(row.onboarding_start_date)} />
                <DateChip label="Contract start" value={formatDay(row.contract_start_date)} />
                <DateChip
                  label="First event"
                  value={firstEvent ? (row.first_event_date ? formatDay(row.first_event_date) : "No date") : "—"}
                  title={firstEvent ?? undefined}
                />
              </div>

              <Section title="Onboarding steps">
                <ul className="overflow-hidden rounded-md border border-[#E5E8EC]">
                  {STEPS.map((s) => {
                    const ok = row[s.key] === true
                    const day = s.dateKey ? row[s.dateKey] : null
                    return (
                      <li
                        key={s.key}
                        className="flex items-center gap-2.5 border-b border-[#E5E8EC] px-3 py-1.5 text-[13px] last:border-0"
                      >
                        <span
                          className="flex size-4 shrink-0 items-center justify-center rounded-full"
                          style={
                            ok
                              ? { background: STATUS_PILL_LIGHT.positive.bg, color: STATUS_PILL_LIGHT.positive.text }
                              : { border: `1px solid ${TEXT_TERTIARY}` }
                          }
                          aria-label={ok ? "Done" : "Not yet"}
                        >
                          {ok && <Check className="size-3" strokeWidth={3} />}
                        </span>
                        <span className="min-w-0 flex-1 truncate" style={{ color: ok ? TEXT_PRIMARY : TEXT_MUTED }}>
                          {s.full}
                        </span>
                        <span className="shrink-0 text-xs tabular-nums" style={{ color: TEXT_MUTED }}>
                          {ok ? (day ? formatDay(day) : "Done") : "Not yet"}
                        </span>
                      </li>
                    )
                  })}
                </ul>
              </Section>

              <Section title="Onboarding notes">
                <p className="whitespace-pre-wrap text-[13px]" style={{ color: row.onboarding_notes ? TEXT_PRIMARY : TEXT_TERTIARY }}>
                  {row.onboarding_notes ?? "No notes."}
                </p>
              </Section>
            </>
          )}
        </div>

        {allHref && (
          <footer className="border-t border-[#E5E8EC] px-5 py-2.5 text-right">
            <Link href={allHref} className="text-xs font-semibold hover:underline" style={{ color: "#0355A7" }}>
              Open the Onboarding page →
            </Link>
          </footer>
        )}
      </aside>
    </>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-5">
      <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wider" style={{ color: TEXT_MUTED }}>
        {title}
      </h3>
      {children}
    </section>
  )
}

/** A compact date chip: small muted label + the date, one line. */
function DateChip({ label, value, title }: { label: string; value: string; title?: string }) {
  return (
    <span
      className="inline-flex items-baseline gap-1.5 whitespace-nowrap rounded-md border border-[#E5E8EC] bg-[#FBFCFD] px-2 py-1"
      title={title ? `${label}: ${title} · ${value}` : `${label}: ${value}`}
    >
      <span className="text-[10.5px] uppercase tracking-wide" style={{ color: TEXT_TERTIARY }}>
        {label}
      </span>
      <span className="text-[12.5px] font-medium tabular-nums" style={{ color: TEXT_PRIMARY }}>
        {value}
      </span>
    </span>
  )
}
