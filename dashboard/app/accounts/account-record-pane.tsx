"use client"

/**
 * The client-record drawer — the Clients twin of
 * app/contacts/contact-record-pane.tsx.
 *
 * Slides in from the right as a SIBLING of the list, never wrapping it, so
 * opening a record cannot remount the table — which is what keeps the list's
 * scroll position and virtualisation window intact.
 *
 * ── RENDERED FROM FIELD DEFINITIONS, NOT JSX ───────────────────────────────
 * Every field comes from `ACCOUNT_SECTIONS` in lib/accounts/record.ts —
 * `{ label, sourceKey, type }` — rather than hand-written markup per field. That
 * is what makes turning this into a real editor a localised change: swap the
 * read-only renderer below for an input keyed off `type`, add form state, add a
 * save action. The sections, labels and ordering do not move.
 *
 * VIEW ONLY. Nothing here is editable and nothing writes back — Dynamics is the
 * system of record. The Account Team block in particular is a DISPLAY of the
 * Dynamics fields: it does not read or write public.account_team_members, and
 * which of the two is canonical is a separate, open question.
 */

import * as React from "react"
import Link from "next/link"

import { ExternalLink, X } from "lucide-react"

import { AccountTeamAvatars as TeamAvatars } from "@/components/account-team-avatars"
import { BRAND_BLUE, STATUS_PILL_LIGHT } from "@/lib/design"
import {
  ACCOUNT_SECTIONS,
  type AccountFieldDef,
  type AccountRecord,
} from "@/lib/accounts/record"
import { isPersonName } from "@/lib/accounts/spec"
import { TestBadge } from "@/components/test-badge"
import { RecordEditBar } from "@/components/record-edit-bar"
import { cn } from "@/lib/utils"

/** Eastern, matching every other date on the page. */
const EASTERN = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  month: "numeric",
  day: "numeric",
  year: "numeric",
})

function formatDate(iso: string | null): string | null {
  if (!iso) return null
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? String(iso) : EASTERN.format(d)
}

/**
 * Active / Inactive pill colours, mapped onto the app's shared
 * STATUS_PILL_LIGHT buckets so the state reads the same here as anywhere else.
 *
 * Driven by the Dynamics `statecode` label rather than by `is_active`, so an
 * unexpected third value shows its own text in the neutral bucket instead of
 * being silently flattened to "Inactive".
 */
export function accountStatePill(stateLabel: string | null): { bg: string; text: string } {
  const s = (stateLabel ?? "").trim().toLowerCase()
  if (s === "active") return STATUS_PILL_LIGHT.positive
  return STATUS_PILL_LIGHT.neutral
}

function Pill({ children, bg, text }: { children: React.ReactNode; bg: string; text: string }) {
  return (
    <span
      className="inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium"
      style={{ backgroundColor: bg, color: text }}
    >
      {children}
    </span>
  )
}

/** The gradient underline every section header in the app carries. */
function SectionHeader({ title }: { title: string }) {
  return (
    <div className="mb-2">
      <div className="text-[11px] font-semibold uppercase tracking-wider text-[#5B6472]">
        {title}
      </div>
      <div
        className="mt-1 h-[2px] w-full rounded-full"
        style={{ background: "linear-gradient(90deg, #1E2858, #0355A7, #1C8C9C)" }}
      />
    </div>
  )
}

/**
 * One field. An empty value renders a quiet em dash, never a blank box — a gap
 * in the CRM should read as a gap, not as a rendering failure.
 */
function Field({
  def,
  record,
  accountId,
}: {
  def: AccountFieldDef
  record: AccountRecord
  accountId: string | null
}) {
  const raw = record[def.sourceKey]
  const empty = raw === null || raw === undefined || raw === ""
  const fullWidth = def.type === "notes"

  let body: React.ReactNode = "—"
  if (!empty) {
    switch (def.type) {
      case "date":
        body = formatDate(String(raw)) ?? "—"
        break
      case "toggle":
        body = raw === true ? "Yes" : raw === false ? "No" : "—"
        break
      case "number":
        body = typeof raw === "number" ? raw.toLocaleString() : String(raw)
        break
      case "person":
        // Several account-team lookups point at a TEAM rather than a named
        // individual, so a single-token value is shown verbatim rather than
        // rendered as one misleading initial.
        body = isPersonName(String(raw)) ? (
          <span className="inline-flex items-center gap-2">
            <TeamAvatars
              members={[{ role: def.label, name: String(raw), bg: "#1E2858", fg: "#FFFFFF" }]}
            />
            <span>{String(raw)}</span>
          </span>
        ) : (
          String(raw)
        )
        break
      case "link":
        if (def.sourceKey === "name" && accountId) {
          // The client itself, linked to the same /client-detail?account_id=
          // destination the rest of the app uses.
          body = (
            <Link
              href={`/client-detail?account_id=${accountId}`}
              className="font-medium hover:underline"
              style={{ color: BRAND_BLUE }}
            >
              {String(raw)}
            </Link>
          )
        } else if (def.sourceKey === "website_url" && String(raw).startsWith("http")) {
          // Only an http(s) value becomes a real link. The CRM holds plenty of
          // bare "example.com" values, and a link that silently resolves against
          // the dashboard's own origin is worse than plain text.
          body = (
            <a
              href={String(raw)}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 font-medium hover:underline"
              style={{ color: BRAND_BLUE }}
            >
              {String(raw)} <ExternalLink className="size-3 shrink-0" />
            </a>
          )
        } else {
          body = String(raw)
        }
        break
      default:
        body = String(raw)
    }
  }

  return (
    <div className={cn(fullWidth && "col-span-2")}>
      <div className="text-[11px] text-[#9AA1AD]">{def.label}</div>
      <div
        className={cn(
          "mt-0.5 rounded-md border border-[#E4E9F4] bg-[#F4F6FB] px-2 py-1 text-[13px]",
          empty && "text-muted-foreground",
          fullWidth && "whitespace-pre-wrap leading-relaxed",
        )}
      >
        {body}
      </div>
    </div>
  )
}

export function AccountRecordPane({
  record,
  loading,
  error,
  onClose,
  onEdit,
}: {
  record: AccountRecord | null
  loading: boolean
  error: string | null
  onClose: () => void
  /** Opens the edit form — shown only for origin='dashboard' clients. */
  onEdit?: () => void
}) {
  const open = loading || !!record || !!error
  if (!open) return null

  const statePill = accountStatePill(record?.state_label ?? null)

  return (
    <>
      {/* Scrim. Click anywhere off the panel to close. */}
      <div aria-hidden="true" onClick={onClose} className="fixed inset-0 z-40 bg-black/10" />
      <aside
        role="dialog"
        aria-modal="true"
        aria-label="Client record"
        className="fixed right-0 top-0 z-50 flex h-screen w-[560px] max-w-[94vw] flex-col border-l border-[#E5E8EC] bg-white shadow-2xl"
      >
        <header className="border-b border-[#E5E8EC] px-5 py-4">
          <div className="flex items-start gap-3">
            <div className="min-w-0 flex-1">
              <div className="text-[11px] uppercase tracking-wider text-[#9AA1AD]">Client</div>
              {/* The COMPANY is the headline. */}
              <h2 className="line-clamp-2 text-[17px] font-semibold text-[#1A2233]">
                {record?.name ?? (loading ? "Loading…" : "Client")}
              </h2>
              {record && (
                <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                  {record.is_test && <TestBadge />}
                  <RecordEditBar origin={record.origin} onEdit={onEdit} />
                  {record.ticker_symbol && (
                    <Pill bg={STATUS_PILL_LIGHT.new.bg} text={STATUS_PILL_LIGHT.new.text}>
                      {record.ticker_symbol}
                    </Pill>
                  )}
                  {record.sector_label && (
                    <Pill bg={STATUS_PILL_LIGHT.neutral.bg} text={STATUS_PILL_LIGHT.neutral.text}>
                      {record.sector_label}
                    </Pill>
                  )}
                  {record.region_label && (
                    <Pill bg={STATUS_PILL_LIGHT.neutral.bg} text={STATUS_PILL_LIGHT.neutral.text}>
                      {record.region_label}
                    </Pill>
                  )}
                  <Pill bg={statePill.bg} text={statePill.text}>
                    {record.state_label ?? "No state"}
                  </Pill>
                </div>
              )}
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="cursor-pointer text-muted-foreground hover:text-foreground"
            >
              <X className="size-4" />
            </button>
          </div>
        </header>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          {error && (
            <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
              {error}
            </div>
          )}
          {loading && !record && (
            <div className="py-10 text-center text-sm text-muted-foreground">Loading record…</div>
          )}
          {record &&
            ACCOUNT_SECTIONS.map((section) => (
              <section key={section.key} className="mb-6">
                <SectionHeader title={section.title} />
                <div className="grid grid-cols-2 gap-x-3 gap-y-2">
                  {section.fields.map((f) => (
                    <Field
                      key={String(f.sourceKey)}
                      def={f}
                      record={record}
                      accountId={record.account_id}
                    />
                  ))}
                </div>
                {section.key === "team" && (
                  <p className="mt-2 text-[11px] text-muted-foreground">
                    Read-only, and shown as Dynamics holds it. The dashboard&apos;s own
                    account-team table is separate and is not read here.
                  </p>
                )}
                {section.key === "engagement" && (
                  <p className="mt-2 text-[11px] text-muted-foreground">
                    These are the CRM&apos;s own rollup dates, passed through unchanged. They can
                    lag what the Meetings and Events tables actually contain — use them as what the
                    CRM believes, not as reporting figures.
                  </p>
                )}
              </section>
            ))}

          {record && (
            <p className="pb-4 text-[11px] text-muted-foreground">
              View only — Dynamics is the system of record. This is the client RECORD, not the
              Portfolio analytics view: meeting counts, retainers and open slots live there, and
              the fields still held only in the raw CRM payload are a separate flatten pass.
            </p>
          )}
        </div>
      </aside>
    </>
  )
}
