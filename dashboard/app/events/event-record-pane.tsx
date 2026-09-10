"use client"

/**
 * The event-record drawer — the Events twin of app/meetings/meeting-record-pane.
 *
 * Slides in from the right as a SIBLING of the list, never wrapping it, so
 * opening a record cannot remount the table — which is what keeps the list's
 * scroll position and virtualisation window intact.
 *
 * ── RENDERED FROM FIELD DEFINITIONS, NOT JSX ───────────────────────────────
 * Every field comes from `EVENT_SECTIONS` in lib/events/record.ts —
 * `{ label, sourceKey, type }` — rather than hand-written markup per field. That
 * is what makes turning this into a real editor a localised change: swap the
 * read-only renderer below for an input keyed off `type`, add form state, add a
 * save action. The sections, labels and ordering do not move.
 *
 * VIEW ONLY. Nothing here is editable and nothing writes back — Dynamics is the
 * system of record.
 */

import * as React from "react"
import Link from "next/link"
import { ExternalLink, X } from "lucide-react"

import { AccountTeamAvatars as TeamAvatars } from "@/components/account-team-avatars"
import { BRAND_BLUE, KPI_CARD_CLASS, STATUS_PILL_LIGHT } from "@/lib/design"
import {
  EVENT_HEADER_FIELDS,
  EVENT_SECTIONS,
  type EventFieldDef,
  type EventRecord,
} from "@/lib/events/record"
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
 * Event-state pill colours, mapped onto the app's shared STATUS_PILL_LIGHT
 * buckets so a state reads the same here as it does anywhere else. The live
 * values are Pre-Launch, Live Outreach, Meetings Ongoing, Schedule Closed,
 * Preparing Feedback, Pause and Complete.
 */
export function eventStatePill(state: string | null): { bg: string; text: string } {
  const s = (state ?? "").trim().toLowerCase()
  if (s === "live outreach" || s === "meetings ongoing") return STATUS_PILL_LIGHT.positive
  if (s === "pre-launch") return STATUS_PILL_LIGHT.new
  if (s === "preparing feedback" || s === "schedule closed") return STATUS_PILL_LIGHT.watch
  if (s === "pause") return STATUS_PILL_LIGHT.atRisk
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

/**
 * The capacity stat row — Meetings / Meeting Slots / Slots Remaining.
 *
 * ── WHERE THE NUMBERS COME FROM ────────────────────────────────────────────
 * All three are computed in v_admin_events_all, not here and not over any
 * client-side dataset:
 *
 *   Meetings        count of Confirmed rows in public.meetings for this event
 *   Meeting Slots   events.of_slots (the CRM's "# of Slots")
 *   Slots Remaining slots − meetings
 *
 * That confirmed count is the SAME one Portfolio's "Open Slots" column and
 * v_client_todo use, so the numbers reconcile. Deliberately NOT the Dynamics
 * events.confirmed_meetings rollup, which is stale on 29 of 968 live events.
 *
 * Two display rules:
 *   - No slot count => Slots and Remaining show an em dash, never 0. Capacity
 *     unknown is not capacity zero, and "0 remaining" would read as "full".
 *   - A NEGATIVE remaining means overbooked and is shown as-is, tinted red. 92
 *     of the 419 events with a slot count are currently overbooked, so hiding it
 *     would be hiding the common case. Portfolio floors this at 0 because it
 *     SUMS across events; a single event does not need that floor.
 */
function StatRow({ record }: { record: EventRecord }) {
  const meetings = record.confirmed_meetings ?? 0
  const slots = record.of_slots
  const remaining = record.slots_remaining
  const overbooked = remaining !== null && remaining !== undefined && remaining < 0

  return (
    <div className="mb-5 grid grid-cols-3 gap-2">
      <Stat label="Meetings" value={meetings} hint="Confirmed meetings on this event" />
      <Stat
        label="Meeting Slots"
        value={slots ?? null}
        hint={slots === null ? "No slot count on this event" : "The event's # of Slots"}
      />
      <Stat
        label="Slots Remaining"
        value={remaining ?? null}
        tone={overbooked ? "bad" : undefined}
        hint={
          slots === null
            ? "Needs a slot count"
            : overbooked
              ? "Overbooked — more confirmed meetings than slots"
              : "Slots minus confirmed meetings"
        }
      />
    </div>
  )
}

function Stat({
  label,
  value,
  hint,
  tone,
}: {
  label: string
  /** null renders an em dash — see StatRow's note on unknown vs zero. */
  value: number | null
  hint?: string
  tone?: "bad"
}) {
  return (
    <div
      className={cn(KPI_CARD_CLASS, "px-3 py-2")}
      title={hint}
    >
      <div className="text-[10px] font-semibold uppercase tracking-wider text-[#9AA1AD]">
        {label}
      </div>
      <div
        className="mt-0.5 text-[20px] font-semibold tabular-nums leading-none"
        style={{ color: tone === "bad" ? STATUS_PILL_LIGHT.atRisk.text : "#1A2233" }}
      >
        {value === null ? <span className="text-muted-foreground">—</span> : value.toLocaleString()}
      </div>
    </div>
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
  clientAccountId,
}: {
  def: EventFieldDef
  record: EventRecord
  clientAccountId: string | null
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
      case "person":
        // The shared initials-circle avatar plus the full name, the same object
        // the tables and the Portfolio account-team clusters use.
        body = (
          <span className="inline-flex items-center gap-2">
            <TeamAvatars
              members={[{ role: def.label, name: String(raw), bg: "#1E2858", fg: "#FFFFFF" }]}
            />
            <span>{String(raw)}</span>
          </span>
        )
        break
      case "link":
        if (def.sourceKey === "client_account_name" && clientAccountId) {
          body = (
            <Link
              href={`/client-detail?account_id=${clientAccountId}`}
              className="font-medium hover:underline"
              style={{ color: BRAND_BLUE }}
            >
              {String(raw)}
            </Link>
          )
        } else if (String(raw).startsWith("http")) {
          body = (
            <a
              href={String(raw)}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 hover:underline"
              style={{ color: BRAND_BLUE }}
              title={String(raw)}
            >
              Open <ExternalLink className="size-3" />
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
          fullWidth && "whitespace-pre-wrap",
        )}
      >
        {body}
      </div>
    </div>
  )
}

export function EventRecordPane({
  record,
  loading,
  error,
  onClose,
}: {
  record: EventRecord | null
  loading: boolean
  error: string | null
  onClose: () => void
}) {
  const open = loading || !!record || !!error
  if (!open) return null

  const statePill = eventStatePill(record?.event_state_label ?? null)

  return (
    <>
      {/* Scrim. Click anywhere off the panel to close. */}
      <div
        aria-hidden="true"
        onClick={onClose}
        className="fixed inset-0 z-40 bg-black/10"
      />
      <aside
        role="dialog"
        aria-modal="true"
        aria-label="Event record"
        className="fixed right-0 top-0 z-50 flex h-screen w-[560px] max-w-[94vw] flex-col border-l border-[#E5E8EC] bg-white shadow-2xl"
      >
        <header className="border-b border-[#E5E8EC] px-5 py-4">
          <div className="flex items-start gap-3">
            <div className="min-w-0 flex-1">
              <div className="text-[11px] uppercase tracking-wider text-[#9AA1AD]">Event</div>
              <h2 className="truncate text-[17px] font-semibold text-[#1A2233]">
                {record?.event_title ?? (loading ? "Loading…" : "Event")}
              </h2>
              {record && (
                <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                  <Pill bg={statePill.bg} text={statePill.text}>
                    {record.event_state_label ?? "No state"}
                  </Pill>
                  {EVENT_HEADER_FIELDS.filter((f) => f.sourceKey === "marketing_state_label").map(
                    (f) =>
                      record.marketing_state_label ? (
                        <Pill
                          key={f.sourceKey}
                          bg={STATUS_PILL_LIGHT.neutral.bg}
                          text={STATUS_PILL_LIGHT.neutral.text}
                        >
                          {record.marketing_state_label}
                        </Pill>
                      ) : null,
                  )}
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
          {/* Capacity first — it is the question people open an event to answer,
              and it sits above General as a compact three-tile row. */}
          {record && <StatRow record={record} />}
          {record &&
            EVENT_SECTIONS.map((section) => (
              <section key={section.key} className="mb-6">
                <SectionHeader title={section.title} />
                <div className="grid grid-cols-2 gap-x-3 gap-y-2">
                  {section.fields.map((f) => (
                    <Field
                      key={String(f.sourceKey)}
                      def={f}
                      record={record}
                      clientAccountId={record.client_account_id}
                    />
                  ))}
                </div>
              </section>
            ))}

          {record && (
            <p className="pb-4 text-[11px] text-muted-foreground">
              View only — Dynamics is the system of record. Company Representatives and Company
              Preferences are not shown yet; they are related contact records and contacts are not
              confirmed synced.
            </p>
          )}
        </div>
      </aside>
    </>
  )
}
