"use client"

import * as React from "react"
import Link from "next/link"
import { ExternalLink, Pencil } from "lucide-react"

import { AccountTeamAvatars as TeamAvatars } from "@/components/account-team-avatars"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { BRAND_BLUE, BRAND_NAVY, DEEP_TEAL, STATUS_PILL_LIGHT } from "@/lib/design"
import {
  MEETING_SECTIONS,
  type MeetingFieldDef,
  type MeetingRecord,
  type MeetingSectionDef,
} from "@/lib/meeting-record"

/**
 * The meeting-record drawer: one meeting, read-only, in a right-side Sheet.
 *
 * Slide-in, dimmed backdrop, close on ✕ / backdrop / Esc all come from the
 * shared <Sheet> (components/ui/sheet.tsx) — the same primitive
 * EventMeetingsPane wraps — so this drawer behaves like every other one in the
 * app. Because the list behind it is never unmounted, its scroll position and
 * virtualization window survive opening, swapping and closing a record.
 *
 * ── VIEW ONLY, BUT EDIT-READY ──────────────────────────────────────────────
 * Every field is rendered from the field-definition list in
 * lib/meeting-record.ts, not hand-written per field. Nothing here is editable:
 * no inputs, no form state, no save. To make it editable later, swap `FieldBox`
 * for an input chosen by `def.type` and add form state — the sections, labels
 * and ordering do not move. See the note at the top of lib/meeting-record.ts.
 */

// Read-only value box. Tinted rather than white so it reads as a form field
// that could become editable, without pretending to be one today.
const BOX_BG = "#F4F6FB"
const BOX_BORDER = "#E4E9F4"

/** Full, unambiguous meeting time for the header pill: "Mon, Nov 3 2026 · 9:30 AM ET". */
const HEADER_DATE = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  weekday: "short",
  month: "short",
  day: "numeric",
  year: "numeric",
})
const HEADER_TIME = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  hour: "numeric",
  minute: "2-digit",
})
function formatFull(iso: string | null): string | null {
  if (!iso) return null
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return null
  return `${HEADER_DATE.format(d)} · ${HEADER_TIME.format(d)} ET`
}

/**
 * Status pill colours. Confirmed uses the approved teal; the rest map onto the
 * app's shared STATUS_PILL_LIGHT buckets so a status reads the same here as a
 * status does anywhere else. An unrecognised value falls back to neutral grey
 * rather than vanishing.
 */
function statusPill(status: string | null): { bg: string; text: string } {
  const s = (status ?? "").trim().toLowerCase()
  if (s === "confirmed") return { bg: "#E3F3EF", text: "#0F7E72" }
  if (s.startsWith("cancel")) return STATUS_PILL_LIGHT.atRisk
  if (s.startsWith("pending")) return STATUS_PILL_LIGHT.watch
  if (!s) return STATUS_PILL_LIGHT.neutral
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
      <div
        className="text-[11px] font-semibold uppercase tracking-wider"
        style={{ color: BRAND_NAVY }}
      >
        {title}
      </div>
      <div
        className="mt-1 h-[2.5px] w-full rounded-full"
        style={{ backgroundImage: `linear-gradient(90deg, ${BRAND_BLUE}, ${DEEP_TEAL})` }}
      />
    </div>
  )
}

/** A read-only switch. Rendered off/on from the boolean; never interactive. */
function Toggle({ on }: { on: boolean | null }) {
  if (on == null) return <span className="text-muted-foreground">—</span>
  return (
    <span className="inline-flex items-center gap-2">
      <span
        aria-hidden="true"
        className="relative inline-flex h-[14px] w-[26px] shrink-0 rounded-full transition-colors"
        style={{ backgroundColor: on ? DEEP_TEAL : "#CBD2E0" }}
      >
        <span
          className="absolute top-[2px] size-[10px] rounded-full bg-white"
          style={{ left: on ? 14 : 2 }}
        />
      </span>
      <span className="text-[13px]">{on ? "Yes" : "No"}</span>
    </span>
  )
}

/** One or more people as the shared avatar circles plus their full names. */
function People({ value, role }: { value: string | null; role: string }) {
  const names = (value ?? "")
    .split(",")
    .map((n) => n.trim())
    .filter(Boolean)
  if (names.length === 0) return <span className="text-muted-foreground">—</span>
  return (
    <span className="flex items-center gap-2">
      <TeamAvatars
        members={names.map((name) => ({ role, name, bg: BRAND_NAVY, fg: "#FFFFFF" }))}
      />
      <span className="truncate text-[13px]">{names.join(", ")}</span>
    </span>
  )
}

/**
 * The read-only value box. THIS is the single place a future editor swaps for an
 * input keyed off `def.type` — every field in every section goes through here.
 */
function FieldBox({
  def,
  record,
  clientHref,
}: {
  def: MeetingFieldDef
  record: MeetingRecord
  clientHref: string | null
}) {
  const value = record[def.sourceKey]

  let content: React.ReactNode
  if (def.type === "toggle") {
    content = <Toggle on={typeof value === "boolean" ? value : null} />
  } else if (def.type === "person") {
    content = <People value={typeof value === "string" ? value : null} role={def.label} />
  } else if (def.type === "date") {
    const full = formatFull(typeof value === "string" ? value : null)
    content = full ?? <span className="text-muted-foreground">—</span>
  } else if (def.type === "link" && typeof value === "string" && value && clientHref) {
    content = (
      <Link href={clientHref} className="hover:underline" style={{ color: BRAND_BLUE }}>
        {value}
      </Link>
    )
  } else if (typeof value === "string" && value.trim()) {
    content = value
  } else {
    // Never a blank box: an absent value reads as "nothing recorded".
    content = <span className="text-muted-foreground">—</span>
  }

  return (
    <div className={def.type === "notes" ? "col-span-2" : undefined}>
      <div className="mb-1 text-[11px] font-medium text-muted-foreground">{def.label}</div>
      <div
        className={
          "rounded-md border px-2.5 py-1.5 text-[13px] " +
          (def.type === "notes" ? "min-h-[52px] whitespace-pre-wrap" : "truncate")
        }
        style={{ backgroundColor: BOX_BG, borderColor: BOX_BORDER }}
        title={typeof value === "string" && value ? value : undefined}
      >
        {content}
      </div>
    </div>
  )
}

function Section({
  section,
  record,
  clientHref,
}: {
  section: MeetingSectionDef
  record: MeetingRecord
  clientHref: string | null
}) {
  const applies = section.appliesTo ? section.appliesTo(record) : true
  return (
    <section className="mb-5">
      <SectionHeader title={section.title} />
      {applies ? (
        <div className="grid grid-cols-2 gap-x-3 gap-y-2.5">
          {section.fields.map((def) => (
            <FieldBox key={def.sourceKey} def={def} record={record} clientHref={clientHref} />
          ))}
        </div>
      ) : (
        <div className="rounded-md border border-dashed px-2.5 py-2 text-[12px] text-muted-foreground">
          {section.emptyNote}
        </div>
      )}
    </section>
  )
}

export function MeetingRecordPane({
  record,
  loading,
  error,
  eventName,
  crmBase,
  onClose,
}: {
  /** The open record, or null when the drawer is closed. */
  record: MeetingRecord | null
  loading: boolean
  error: string | null
  /** Event name comes from the LIST row — it is not on public.meetings. */
  eventName: string | null
  crmBase: string | null
  onClose: () => void
}) {
  const open = loading || error !== null || record !== null
  const clientHref = record?.client_account_id
    ? `/client-detail?account_id=${record.client_account_id}`
    : null
  const pill = statusPill(record?.status ?? null)
  const when = formatFull(record?.date_time ?? null)

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose()
      }}
    >
      <SheetContent className="flex w-full flex-col gap-0 p-0 sm:max-w-xl">
        {/* Header band, with the app's navy→blue→teal accent down its left edge. */}
        <SheetHeader
          className="gap-1 border-b p-4 pr-12"
          style={{ borderLeft: `4px solid transparent`, borderImage: "none" }}
        >
          <div
            aria-hidden="true"
            className="absolute left-0 top-0 h-[76px] w-1"
            style={{
              backgroundImage: `linear-gradient(180deg, ${BRAND_NAVY}, ${BRAND_BLUE}, ${DEEP_TEAL})`,
            }}
          />
          <div
            className="text-[11px] font-medium uppercase tracking-wide"
            style={{ color: DEEP_TEAL }}
          >
            Meeting Record
          </div>
          <SheetTitle className="text-base" style={{ color: BRAND_NAVY }}>
            {clientHref && record?.client ? (
              <Link href={clientHref} className="hover:underline">
                {record.client}
              </Link>
            ) : (
              (record?.client ?? "Meeting")
            )}
          </SheetTitle>
          <SheetDescription className="truncate">{eventName ?? "—"}</SheetDescription>

          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            {record?.meeting_type && (
              <Pill bg="#EEF2FB" text="#2D4A8A">
                {record.meeting_type}
              </Pill>
            )}
            {record?.status && (
              <Pill bg={pill.bg} text={pill.text}>
                {record.status}
              </Pill>
            )}
            {when && (
              <Pill bg="#F1F3F7" text="#5B6472">
                {when}
              </Pill>
            )}
          </div>
        </SheetHeader>

        {/* Action bar. Edit is deliberately inert — Dynamics is still the system
            of record, and nothing in this app writes back. */}
        <div className="flex items-center gap-2 border-b px-4 py-2">
          {crmBase && record && (
            <a
              href={`${crmBase}/main.aspx?etn=bcs_meeting&pagetype=entityrecord&id=${record.meeting_id}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-[12px] hover:underline"
              style={{ color: BRAND_BLUE }}
            >
              <ExternalLink className="size-3.5" />
              Open in CRM
            </a>
          )}
          <button
            type="button"
            disabled
            title="Editing arrives when this becomes the system of record."
            className="inline-flex cursor-not-allowed items-center gap-1 rounded-md border px-2 py-1 text-[12px] text-muted-foreground opacity-60"
          >
            <Pencil className="size-3.5" />
            Edit
          </button>
          <span className="ml-auto rounded-full bg-[#F1F3F7] px-2 py-0.5 text-[11px] font-medium text-[#5B6472]">
            View only
          </span>
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          {loading && <div className="py-10 text-center text-sm text-muted-foreground">Loading…</div>}
          {error && (
            <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm">
              <div className="font-medium text-destructive">Could not load this meeting</div>
              <div className="mt-1 text-muted-foreground">{error}</div>
            </div>
          )}
          {record &&
            !loading &&
            !error &&
            MEETING_SECTIONS.map((section) => (
              <Section
                key={section.key}
                section={section}
                record={record}
                clientHref={clientHref}
              />
            ))}
        </div>
      </SheetContent>
    </Sheet>
  )
}
