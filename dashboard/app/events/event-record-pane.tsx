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
 * VIEW ONLY for Dynamics rows. A dashboard-created row (origin='dashboard')
 * shows an Edit button (RecordEditBar) that opens the entity's form in edit
 * mode; the server-side update refuses any Dynamics row.
 */

import * as React from "react"
import { TestBadge } from "@/components/test-badge"
import { RecordEditBar } from "@/components/record-edit-bar"
import Link from "next/link"
import { Check, ExternalLink, Lock, Pause, UserRound, X } from "lucide-react"

import { AccountTeamAvatars as TeamAvatars } from "@/components/account-team-avatars"
import { FeedbackReportsPanel } from "./feedback-reports-panel"
import { AddMeetingFromEventButton } from "./add-meeting-button"
import { loadEventRepresentatives } from "./actions"
import type { EventRepresentative } from "@/lib/events/create"
import { isAutomationOrigin } from "@/lib/feedback-reports/policy"
import { BRAND_BLUE, KPI_CARD_CLASS, STATUS_PILL_LIGHT } from "@/lib/design"
import { ACCOUNT_TEAM_ROLE_META } from "@/lib/account-teams/roles"
import {
  EVENT_LIFECYCLE_HINTS,
  EVENT_LIFECYCLE_STEPS,
  isPausedStage,
  lifecycleIndex,
  stepFromToggles,
} from "@/lib/events/lifecycle"
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

/**
 * The LIFECYCLE STEPPER — Pre-Launch → … → Complete, in the events table's own
 * stage colours (eventStatePill), so a step reads the same as its table pill.
 * Done steps carry a check, the current step is ringed and labelled in its
 * colour, steps ahead are grey.
 *
 * Dashboard-origin events: the stage is COMPUTED by the database from the
 * Launch / Outreach Complete / Pause toggles plus the event's meetings and
 * feedback reports (lib/events/lifecycle.ts). Dynamics-origin events show their
 * synced stage on the same track, read-only.
 *
 * PAUSE overrides the track: a red banner replaces the "current" treatment, and
 * the step the toggles reach is marked with a pause glyph. Resuming = clearing
 * Pause in the edit form.
 */
export function LifecycleStepper({
  record,
  onEdit,
}: {
  /** Only the stored stage + toggles — the edit form passes just these. */
  record: Pick<EventRecord, "event_state_label" | "launch" | "outreach_complete" | "origin">
  onEdit?: () => void
}) {
  const stage = record.event_state_label
  const paused = isPausedStage(stage)
  const computed = record.origin === "dashboard"
  const current = paused
    ? lifecycleIndex(stepFromToggles(record.launch, record.outreach_complete))
    : lifecycleIndex(stage)
  const pausePill = eventStatePill("Pause")

  return (
    <div className="mt-3">
      <div className="mb-2 flex items-center justify-between">
        <div className="text-[10px] font-semibold uppercase tracking-wider text-[#9AA1AD]">Lifecycle</div>
        <div className="text-[10px] text-[#9AA1AD]">
          {computed ? "Computed automatically" : "Stage from Dynamics"}
        </div>
      </div>

      {paused && (
        <div
          className="mb-2.5 flex items-center gap-2 rounded-md px-2.5 py-1.5 text-[12px]"
          style={{ backgroundColor: pausePill.bg, color: pausePill.text }}
        >
          <Pause className="size-3.5 shrink-0" fill="currentColor" />
          <span className="flex-1">
            <span className="font-semibold">Pause</span>
            {" — lifecycle on hold. "}
            {computed ? "Clearing Pause resumes the computed stage." : null}
          </span>
          {computed && onEdit && (
            <button
              type="button"
              onClick={onEdit}
              className="cursor-pointer rounded px-1.5 py-0.5 text-[11px] font-medium underline-offset-2 hover:underline"
            >
              Resume…
            </button>
          )}
        </div>
      )}

      <ol className="grid grid-cols-6">
        {EVENT_LIFECYCLE_STEPS.map((step, i) => {
          const tone = eventStatePill(step)
          const done = current >= 0 && i < current
          const isCurrent = i === current
          const ahead = !done && !isCurrent
          const hereButPaused = isCurrent && paused
          return (
            <li key={step} className="relative flex flex-col items-center" title={EVENT_LIFECYCLE_HINTS[step]}>
              {/* Connector to the previous step — coloured once that step is reached. */}
              {i > 0 && (
                <span
                  aria-hidden="true"
                  className="absolute right-1/2 top-[11px] h-[2px] w-full"
                  style={{ backgroundColor: done || isCurrent ? eventStatePill(EVENT_LIFECYCLE_STEPS[i - 1]).text : "#E4E9F4", opacity: done || isCurrent ? 0.45 : 1 }}
                />
              )}
              <span
                className={cn(
                  "relative z-10 flex size-6 items-center justify-center rounded-full text-[10px] font-semibold",
                  isCurrent && !paused && "ring-4",
                )}
                style={{
                  backgroundColor: hereButPaused
                    ? pausePill.bg
                    : ahead
                      ? "#FFFFFF"
                      : isCurrent
                        ? tone.text
                        : tone.bg,
                  color: hereButPaused ? pausePill.text : ahead ? "#9AA1AD" : isCurrent ? "#FFFFFF" : tone.text,
                  border: ahead ? "1.5px solid #D5DBE7" : hereButPaused ? `1.5px solid ${pausePill.text}` : "none",
                  // The ring is the current step's own pale tint.
                  ["--tw-ring-color" as string]: tone.bg,
                }}
                aria-current={isCurrent ? "step" : undefined}
              >
                {hereButPaused ? (
                  <Pause className="size-3" fill="currentColor" />
                ) : done ? (
                  <Check className="size-3.5" strokeWidth={3} />
                ) : (
                  i + 1
                )}
              </span>
              <span
                className={cn(
                  "mt-1.5 px-0.5 text-center text-[10px] leading-tight",
                  isCurrent ? "font-semibold" : "font-medium",
                )}
                style={{ color: ahead ? "#9AA1AD" : isCurrent && !paused ? tone.text : "#5B6472" }}
              >
                {step}
              </span>
            </li>
          )
        })}
      </ol>
      {!paused && current < 0 && (
        <div className="mt-2 text-[11px] text-muted-foreground">
          Stage: {stage?.trim() || "not set"}
        </div>
      )}
    </div>
  )
}

/** Account-team role → avatar colours (the shared navy→teal role palette). */
const TEAM_ROLE_COLOURS: Record<string, { bg: string; fg: string }> = {
  "Account Manager": ACCOUNT_TEAM_ROLE_META.account_manager,
  "Secondary Manager": ACCOUNT_TEAM_ROLE_META.secondary_manager,
  Associate: ACCOUNT_TEAM_ROLE_META.associate,
  "Logistics Coordinator": ACCOUNT_TEAM_ROLE_META.logistics,
  "Feedback Report": ACCOUNT_TEAM_ROLE_META.feedback_report,
}

/**
 * The client's CURRENT account team as initials avatars, one per role. Replaces
 * the form's old role dropdowns; the event's own Account Manager / Logistics /
 * Feedback Report fields below are the snapshot taken when it was created.
 */
function CompanyRepresentatives({ eventId }: { eventId: string }) {
  const [reps, setReps] = React.useState<EventRepresentative[] | null>(null)
  React.useEffect(() => {
    let live = true
    loadEventRepresentatives(eventId).then((r) => {
      if (live) setReps(r.ok ? (r.data ?? []) : [])
    })
    return () => {
      live = false
    }
  }, [eventId])
  if (!reps || reps.length === 0) return null
  return (
    <section className="mb-5">
      <SectionHeader title="Company representatives" />
      <ul className="grid gap-1.5">
        {reps.map((r) => (
          <li key={r.contactId} className="flex items-center gap-2">
            <UserRound className="size-4 shrink-0 text-[#5B6472]" />
            <span className="leading-tight">
              <span className="block text-[13px] text-[#1A2233]">{r.name}</span>
              {r.detail && <span className="block text-[11px] text-muted-foreground">{r.detail}</span>}
            </span>
          </li>
        ))}
      </ul>
    </section>
  )
}

function AccountTeamStrip({ team }: { team: NonNullable<EventRecord["client_team"]> }) {
  const shown = team.filter((m) => m.name && m.name.trim())
  return (
    <section className="mb-5">
      <SectionHeader title="Account team" />
      {shown.length === 0 ? (
        <div className="text-[12px] text-muted-foreground">No account team on this client.</div>
      ) : (
        <div className="flex flex-wrap gap-x-4 gap-y-2">
          {shown.map((m) => {
            const c = TEAM_ROLE_COLOURS[m.role] ?? { bg: "#1E2858", fg: "#FFFFFF" }
            return (
              <div key={m.role} className="flex items-center gap-2">
                <TeamAvatars members={[{ role: m.role, name: m.name, bg: c.bg, fg: c.fg }]} />
                <div className="leading-tight">
                  <div className="text-[10px] uppercase tracking-wider text-[#9AA1AD]">{m.role}</div>
                  <div className="text-[12px] text-[#1A2233]">{m.name}</div>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </section>
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
  onEdit,
}: {
  record: EventRecord | null
  loading: boolean
  error: string | null
  onClose: () => void
  /** Opens the edit form — shown only for origin='dashboard' records. */
  onEdit?: () => void
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
              <h2 className="flex items-center gap-1.5 text-[17px] font-semibold text-[#1A2233]">
                <span className="truncate">{record?.event_title ?? (loading ? "Loading…" : "Event")}</span>
                {record?.origin === "dashboard" && (
                  // Generated name — read-only, like the form's greyed field.
                  <span
                    className="inline-flex shrink-0 items-center gap-1 rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground"
                    title="Generated automatically: TICKER - Location - Dates"
                  >
                    <Lock className="size-2.5" /> Auto
                  </span>
                )}
              </h2>
              {record && (
                <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                  {record?.is_test && <TestBadge />}
                  <RecordEditBar origin={record?.origin} onEdit={onEdit} />
                  {/* Offered where the host offers Edit (a write-capable page). */}
                  {onEdit && (
                    <AddMeetingFromEventButton
                      key={record.event_id}
                      origin={record.origin}
                      eventId={record.event_id}
                      eventName={record.event_title}
                      clientAccountId={record.client_account_id}
                      location={record.event_location}
                    />
                  )}
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
              {record && <LifecycleStepper record={record} onEdit={onEdit} />}
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
          {record?.client_team && <AccountTeamStrip team={record.client_team} />}
          {/* Dashboard-added company representatives (event_contacts). Keyed per
              event so it reloads on switch — prefixed, because it is a SIBLING of
              the feedback panel below and sibling keys must differ. */}
          {record && <CompanyRepresentatives key={`reps-${record.event_id}`} eventId={record.event_id} />}
          {/* Feedback reports — the automation's 1–3 report tasks and their
              meetings (dashboard-origin events; see feedback-reports-panel). */}
          {record && isAutomationOrigin(record.origin) && (
            <FeedbackReportsPanel key={record.event_id} eventId={record.event_id} />
          )}
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
              View only — Dynamics is the system of record. Company Representatives added in the
              dashboard are listed above; Dynamics-side representatives and Company Preferences
              are not synced.
            </p>
          )}
        </div>
      </aside>
    </>
  )
}
