import * as React from "react"
import Link from "next/link"

import { ListTitleCard } from "@/components/page-masthead"
import { StatCard } from "@/components/stat-card"
import {
  CANVAS,
  CARD_CLASS,
  STATUS_PILL_LIGHT,
  TEXT_MUTED,
  TEXT_PRIMARY,
  TEXT_SECONDARY,
  TEXT_TERTIARY,
} from "@/lib/design"
import { contractTone, daysUntil, dueTone, isCritical, type DueTone } from "./policy"
import { fmtDay, type Feed, type MyDashboardData, type TodoItem } from "./load"
import { OpenTaskRow, TaskDrawerHost } from "./task-drawer"
import { MeetingDrawerHost, OpenMeetingRow } from "./meeting-drawer"
import { TimeOffApprovalRow, TimeOffDrawerHost } from "./time-off-drawer"
import { EventDrawerHost, OpenEventReportRow, OpenEventRow } from "./event-drawer"
import { OnboardingDrawerHost, OpenOnboardingRow } from "./onboarding-drawer"

/**
 * The My Dashboard surface — a SERVER component; only the two drawer hosts
 * (task, meeting) are client islands.
 *
 * STYLING: built from the app's own pieces so it reads as native — the
 * ListTitleCard masthead and floating StatCards (as on Alerts), CARD_CLASS
 * surfaces and the app's type scale. NO decorative colour: colour appears only
 * for the two semantic states, overdue (red) and due soon (amber).
 *
 * Layout (2026-10-17, was three columns per mockup my-dashboard-v5): every
 * Alerts-style workflow is its own compact card (≤ ROW_LIMIT rows + "All →"), in
 * an EXPLICIT two-column grid under light group labels (each with a one-line
 * description) — every card has a fixed home:
 *   left   Things To Do: Feedback Collection → Feedback Reports Pending Review → Feedback Reports In Process
 *          → Profiles to Review → Other Open Tasks → Hosting · Next 7 Days
 *   right  Administrative & More: Time Off Approvals → Onboarding → Contracts Expiring
 *          → Active Marketing
 * A card's count takes the same colour as its KPI tile (cardTone).
 *
 * FLAGS (2026-10-17, borrowed from the first My Dashboard and the retired Alerts
 * page): a red/amber left edge on overdue / due-soon rows, a faint red wash on
 * critical rows (no per-card "N critical" total — removed 2026-10-17), a days-left pill on
 * contracts, and a one-line legend at the top right of the banner.
 */

const RED = STATUS_PILL_LIGHT.atRisk
const AMBER = STATUS_PILL_LIGHT.watch
const NEUTRAL = STATUS_PILL_LIGHT.neutral
const RULE = "rgba(16,24,40,0.07)"
// IQ palette (2026-10-17 flag treatments): graphite text, sand / stone fills, rule lines.
const IQ_GRAPHITE = "#3a4655"
const IQ_SAND = "#f1f4f8"
const IQ_RULE = "#c8d4e3"

/** Rows shown per card; the header count and "All →" cover the rest. */
const ROW_LIMIT = 5
/** Contracts Expiring shows a few more (soonest first); "View all →" covers the rest. */
const CONTRACT_LIMIT = 8

/** "Dec 1, 2026" — the contract expiry date, with its year. */
const EXPIRY_FMT = new Intl.DateTimeFormat("en-US", {
  timeZone: "UTC",
  month: "short",
  day: "numeric",
  year: "numeric",
})
const fmtExpiry = (day: string) => EXPIRY_FMT.format(new Date(day + "T00:00:00Z"))

type Tone = "over" | "soon" | undefined

const toneColor = (t: Tone | DueTone) => (t === "over" ? RED.text : t === "soon" ? AMBER.text : undefined)

/** A card's (and its KPI's) tone: red if any row is overdue, else amber if any is due soon. */
function cardTone(tones: (Tone | DueTone)[]): Tone {
  if (tones.includes("over")) return "over"
  if (tones.includes("soon")) return "soon"
  return undefined
}

const total = (f: Feed<unknown>) => f.rows.length + f.truncated

// ---------------------------------------------------------------------------
// Small pieces
// ---------------------------------------------------------------------------

/** Neutral chip. `strong` = the Mine variant, `outline` = the Team variant. */
function Chip({ label, outline = false, strong = false }: { label: string; outline?: boolean; strong?: boolean }) {
  return (
    <span
      className="inline-flex shrink-0 items-center whitespace-nowrap rounded-full"
      style={{
        padding: "0 7px",
        fontSize: 10.5,
        background: outline ? "#FFFFFF" : NEUTRAL.bg,
        color: strong ? TEXT_PRIMARY : NEUTRAL.text,
        border: "1px solid " + (outline ? "#E2E6EC" : "transparent"),
        fontWeight: strong ? 600 : 500,
      }}
    >
      {label}
    </span>
  )
}

function RowLink({ href, children }: { href: string | null; children: React.ReactNode }) {
  return href ? (
    <Link
      prefetch={false}
      href={href}
      className="block transition-colors hover:bg-[rgba(16,24,40,0.02)] focus:outline-none focus-visible:bg-[rgba(16,24,40,0.04)]"
    >
      {children}
    </Link>
  ) : (
    <div>{children}</div>
  )
}

/**
 * A row's click target: the task drawer (task-backed rows) or the meeting
 * drawer (meeting rows) in place when the viewer may open that record;
 * otherwise the row's link.
 */
function ItemTarget({
  data,
  taskId = null,
  meetingId = null,
  href,
  children,
}: {
  data: MyDashboardData
  taskId?: string | null
  meetingId?: string | null
  href: string | null
  children: React.ReactNode
}) {
  if (taskId && data.canOpenTasks) return <OpenTaskRow taskId={taskId}>{children}</OpenTaskRow>
  // Meeting rows open for every viewer: the drawer's loader only returns a
  // meeting the viewer hosts (loadHostedMeetingRecord).
  if (meetingId) return <OpenMeetingRow meetingId={meetingId}>{children}</OpenMeetingRow>
  return <RowLink href={href}>{children}</RowLink>
}

/**
 * The critical flag: a bold filled red circle, clearly bigger than the status
 * dot — for rows SEVERELY overdue (isCritical: 7+ days past due) and every
 * pending time-off approval (it blocks the requester).
 */
function CriticalFlag() {
  return (
    <span
      className="inline-flex shrink-0 items-center justify-center rounded-full font-bold text-white"
      style={{
        width: 16,
        height: 16,
        fontSize: 11,
        lineHeight: 1,
        background: RED.text,
      }}
      title="Critical — needs action now"
      aria-label="Critical"
    >
      !
    </span>
  )
}

/**
 * Urgency edge + tint, borrowed from the first My Dashboard (2026-10-07: a 3px
 * left edge per urgency bucket) and the retired Alerts page (critical rows get a
 * faint red wash). Red = overdue / critical, amber = due soon; plain rows none.
 */
function rowAccent(edge: Tone | DueTone, critical: boolean): React.CSSProperties | undefined {
  if (critical) return { background: "rgba(180,35,24,0.035)", boxShadow: "inset 3px 0 0 " + RED.text }
  const color = toneColor(edge)
  return color ? { boxShadow: "inset 3px 0 0 " + color } : undefined
}

/** One compact row: optional lead (dot) or critical flag, title + sub, right-hand meta. */
function Line({
  lead,
  critical = false,
  edge,
  title,
  sub,
  right,
}: {
  lead?: React.ReactNode
  /** Severely overdue — shows the red flag (in place of any lead dot). */
  critical?: boolean
  /** Urgency of the row — draws the coloured left edge (see rowAccent). */
  edge?: Tone | DueTone
  title: React.ReactNode
  sub?: React.ReactNode
  right?: React.ReactNode
}) {
  return (
    <div
      className="flex items-center gap-2 px-3 py-1.5"
      style={{ borderBottom: "1px solid " + RULE, ...rowAccent(edge, critical) }}
    >
      {critical ? <CriticalFlag /> : lead}
      <div className="min-w-0 flex-1">
        <div className="truncate font-medium" style={{ fontSize: 12.5, color: TEXT_PRIMARY }}>
          {title}
        </div>
        {sub && (
          <div
            className="truncate"
            style={{ fontSize: 11.5, color: TEXT_MUTED }}
            title={typeof sub === "string" ? sub : undefined}
          >
            {sub}
          </div>
        )}
      </div>
      {right && (
        <div className="shrink-0 whitespace-nowrap text-right" style={{ fontSize: 11.5, color: TEXT_SECONDARY }}>
          {right}
        </div>
      )}
    </div>
  )
}

/**
 * A feedback row's secondary line: its detail, then WHY it is on your card (the
 * Alerts page's own wording — see TodoItem.reason). Full text on hover.
 */
function withReason(r: TodoItem): string | null {
  return [r.sub, r.reason].filter(Boolean).join(" · ") || null
}

/** A due date coloured by the shared rule: past → red, within 7 days → amber. */
function DueText({
  day,
  label,
  today,
  tone,
}: {
  day: string | null
  label?: string | null
  today: string
  tone?: Tone | DueTone
}) {
  const t = tone ?? dueTone(day, today)
  const text = label ?? fmtDay(day) ?? "—"
  return (
    <span className={t === "over" || t === "soon" ? "font-semibold" : undefined} style={{ color: toneColor(t) }}>
      {t === "over" && day ? "Overdue " + text : text}
    </span>
  )
}

function Dot({ tone }: { tone: Tone | DueTone }) {
  return (
    <span
      className="inline-block shrink-0 rounded-full"
      style={{
        width: 7,
        height: 7,
        background: toneColor(tone) ?? TEXT_TERTIARY,
      }}
    />
  )
}

/**
 * Days-left pill on a contract row — from the first My Dashboard ("42d"): red
 * within 7 days, amber within 30, otherwise a quiet IQ sand pill.
 */
function DaysLeft({ days, tone }: { days: number; tone: DueTone }) {
  const tint = tone === "over" ? RED : tone === "soon" ? AMBER : null
  return (
    <span
      className="inline-flex w-[38px] shrink-0 justify-center rounded-full font-semibold tabular-nums"
      style={{
        fontSize: 10.5,
        padding: "1px 0",
        background: tint?.bg ?? IQ_SAND,
        color: tint?.text ?? IQ_GRAPHITE,
        border: "1px solid " + (tint ? "transparent" : IQ_RULE),
      }}
      title={days + " day" + (days === 1 ? "" : "s") + " to expiry"}
    >
      {days}d
    </span>
  )
}

function Card({
  id,
  title,
  description,
  count,
  tone,
  moreHref,
  feed,
  empty,
  children,
}: {
  id: string
  title: string
  /** One line under the title saying what the card is. */
  description: string
  count: number
  tone?: Tone
  moreHref?: string | null
  feed: Pick<Feed<unknown>, "error">
  empty: string
  children: React.ReactNode
}) {
  const shown = React.Children.count(children)
  const color = count > 0 ? toneColor(tone) : undefined
  return (
    <section id={id} className={CARD_CLASS + " scroll-mt-4 overflow-hidden"}>
      <div className="px-3 py-2" style={{ borderBottom: "1px solid " + RULE }}>
      <div className="flex items-center gap-2">
        {/* Semibold (2026-10-17): reads clearly, but the bold category headings above lead. */}
        <h2 className="truncate font-semibold" style={{ fontSize: 14, color: TEXT_PRIMARY }}>
          {title}
        </h2>
        <span
          className="shrink-0 rounded-full font-semibold tabular-nums"
          style={{
            fontSize: 11,
            padding: "0 7px",
            color: color ?? NEUTRAL.text,
            background: tone === "over" && color ? RED.bg : tone === "soon" && color ? AMBER.bg : NEUTRAL.bg,
          }}
        >
          {count}
        </span>
        {moreHref && (
          <Link
            href={moreHref}
            className="ml-auto shrink-0 hover:underline"
            style={{ fontSize: 11.5, color: TEXT_MUTED }}
          >
            All →
          </Link>
        )}
      </div>
      <p className="truncate" style={{ fontSize: 11.5, color: TEXT_MUTED }} title={description}>
        {description}
      </p>
      </div>
      {feed.error ? (
        <div className="px-3 py-2" style={{ fontSize: 12, color: RED.text, background: RED.bg }}>
          Could not load this card — {feed.error}
        </div>
      ) : count === 0 ? (
        <div className="px-3 py-2.5" style={{ fontSize: 12, color: TEXT_MUTED }}>
          {empty}
        </div>
      ) : (
        <>
          {children}
          {count > shown && (
            <div className="flex items-center px-3 py-1" style={{ fontSize: 11, color: TEXT_MUTED }}>
              + {count - shown} more
              {moreHref && (
                <Link href={moreHref} className="ml-auto hover:underline">
                  View all →
                </Link>
              )}
            </div>
          )}
        </>
      )}
    </section>
  )
}

/**
 * What the flags mean — the retired Alerts page's severity legend, said once
 * at the top right of the banner (in place of the removed "Needs you now" pill).
 */
function FlagLegend() {
  const edge = (color: string) => (
    <span aria-hidden="true" className="inline-block shrink-0 rounded-[1px]" style={{ width: 3, height: 12, background: color }} />
  )
  const items: { mark: React.ReactNode; text: string }[] = [
    { mark: <CriticalFlag />, text: "Critical — 7+ days overdue, or awaiting your approval" },
    { mark: edge(AMBER.text), text: "Due soon (next 7 days)" },
  ]
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1" style={{ fontSize: 11.5, color: IQ_GRAPHITE }}>
      {items.map((i) => (
        <span key={i.text} className="inline-flex items-center gap-1.5">
          {i.mark}
          {i.text}
        </span>
      ))}
    </div>
  )
}

/**
 * Category header above a group of cards (style A, 2026-10-17): a small
 * uppercase overline, a large bold title, and the one-line description. Plain
 * text, no colour accent, no rule under it.
 */
function GroupLabel({ overline, label, description }: { overline: string; label: string; description: string }) {
  return (
    <div className="mt-1 px-1">
      <div
        className="font-semibold uppercase"
        style={{ fontSize: 11, letterSpacing: "0.08em", color: TEXT_MUTED }}
      >
        {overline}
      </div>
      <h2 className="font-bold" style={{ fontSize: 20, lineHeight: 1.2, color: TEXT_PRIMARY }}>
        {label}
      </h2>
      <p style={{ fontSize: 12, color: IQ_GRAPHITE }}>{description}</p>
    </div>
  )
}

function ClientName({ name, ticker }: { name: string; ticker: string | null }) {
  return (
    <>
      {name}
      {ticker && (
        <span className="font-normal" style={{ color: TEXT_MUTED }}>
          {" "}
          ({ticker})
        </span>
      )}
    </>
  )
}

// ---------------------------------------------------------------------------
// Tones — one per card, shared by the card count and its KPI tile
// ---------------------------------------------------------------------------

function tones(data: MyDashboardData) {
  const { today } = data
  const due = (rows: TodoItem[]) => cardTone(rows.map((r) => dueTone(r.due, today)))
  return {
    collect: due(data.collect.rows),
    review: due(data.review.rows),
    claimed: due(data.claimed.rows),
    profiles: due(data.profiles.rows),
    tasks: cardTone(data.tasks.rows.map((t) => dueTone(t.due, today))),
    // Hosting is always upcoming: amber only for today / tomorrow (the pill's rule).
    hosting: (data.hostSoon > 0 ? "soon" : undefined) as Tone,
    contracts: cardTone(data.contracts.rows.map((c) => contractTone(c.daysLeft))),
    // Every pending approval is critical, so any at all → red.
    approvals: (data.approvals.rows.length > 0 ? "over" : undefined) as Tone,
  }
}

// ---------------------------------------------------------------------------
// Feedback
// ---------------------------------------------------------------------------

function CollectCard({ data, tone }: { data: MyDashboardData; tone: Tone }) {
  const f = data.collect
  return (
    <Card
      id="collect"
      title="Feedback Collection"
      description="Meetings that have happened where investor feedback still needs collecting."
      count={total(f)}
      tone={tone}
      moreHref={data.links.collect}
      feed={f}
      empty={
        data.viewerUnresolved
          ? "Your sign-in isn't matched to a CRM record, so this can't be shown."
          : "No feedback waiting on you."
      }
    >
      {f.rows.slice(0, ROW_LIMIT).map((r) => (
        // Row → the meeting drawer in place (not Feedback Collection).
        <ItemTarget key={r.key} data={data} meetingId={r.meetingId} href={r.href}>
          <Line
            critical={isCritical(r.due, data.today)}
            edge={dueTone(r.due, data.today)}
            title={r.subject}
            sub={withReason(r)}
            right={<DueText day={r.due} label={r.dueLabel} today={data.today} />}
          />
        </ItemTarget>
      ))}
    </Card>
  )
}

function ReportCard({
  data,
  id,
  title,
  description,
  feed,
  tone,
  empty,
}: {
  data: MyDashboardData
  id: string
  title: string
  description: string
  feed: Feed<TodoItem>
  tone: Tone
  empty: string
}) {
  return (
    <Card
      id={id}
      title={title}
      description={description}
      count={total(feed)}
      tone={tone}
      moreHref={data.links.reports}
      feed={feed}
      empty={empty}
    >
      {feed.rows.slice(0, ROW_LIMIT).map((r) => {
        const line = (
          <Line
            critical={isCritical(r.due, data.today)}
            edge={dueTone(r.due, data.today)}
            title={r.subject}
            sub={withReason(r)}
            right={r.due ? <DueText day={r.due} label={r.dueLabel} today={data.today} /> : <span>No date</span>}
          />
        )
        // Row → the event on Meetings & Reports, focused on this report (the
        // Feedback Reports page's deep link), for viewers who may open events;
        // otherwise the task drawer / link as before.
        return r.eventId && data.canOpenEventsPage ? (
          <OpenEventReportRow key={r.key} eventId={r.eventId} reportTaskId={r.reportTaskId ?? null}>
            {line}
          </OpenEventReportRow>
        ) : (
          <ItemTarget key={r.key} data={data} taskId={r.taskId} href={r.href}>
            {line}
          </ItemTarget>
        )
      })}
    </Card>
  )
}

// ---------------------------------------------------------------------------
// My work
// ---------------------------------------------------------------------------

function TasksCard({ data, tone }: { data: MyDashboardData; tone: Tone }) {
  const f = data.tasks
  return (
    <Card
      id="tasks"
      title="Other Open Tasks"
      description="Open CRM tasks assigned to you or your account teams."
      count={total(f)}
      tone={tone}
      moreHref={data.links.tasks}
      feed={f}
      empty="No open tasks for you or your account teams."
    >
      {f.rows.slice(0, ROW_LIMIT).map((t) => {
        const tTone = dueTone(t.due, data.today)
        const due = t.due ? <DueText day={t.due} today={data.today} /> : "No date"
        return (
          <ItemTarget key={t.key} data={data} taskId={t.taskId} href={t.href}>
            <Line
              critical={isCritical(t.due, data.today)}
              edge={tTone}
              lead={<Dot tone={tTone} />}
              title={t.subject + (t.client ? " — " + t.client : "")}
              sub={
                <>
                  {!t.mine && [t.assignee, t.role].filter(Boolean).join(" · ") + " · "}
                  {due}
                </>
              }
              right={t.mine ? <Chip label="Mine" strong /> : <Chip label="Team" outline />}
            />
          </ItemTarget>
        )
      })}
    </Card>
  )
}

function HostingCard({ data, tone }: { data: MyDashboardData; tone: Tone }) {
  const f = data.hosting
  return (
    <Card
      id="hosting"
      title="Hosting · Next 7 Days"
      description="Client meetings you are hosting in the coming week."
      count={total(f)}
      tone={tone}
      moreHref={data.links.hosting}
      feed={f}
      empty="You aren't hosting any meetings in the next 7 days."
    >
      {f.rows.slice(0, ROW_LIMIT).map((r) => {
        const d = daysUntil(r.due, data.today)
        return (
          <ItemTarget key={r.key} data={data} meetingId={r.meetingId} href={r.href}>
            <Line
              edge={d != null && d <= 1 ? "soon" : "plain"}
              title={r.subject}
              sub={r.sub}
              right={
                <DueText
                  day={r.due}
                  label={r.dueLabel}
                  today={data.today}
                  tone={d != null && d <= 1 ? "soon" : "plain"}
                />
              }
            />
          </ItemTarget>
        )
      })}
    </Card>
  )
}

function ProfilesCard({ data, tone }: { data: MyDashboardData; tone: Tone }) {
  const f = data.profiles
  return (
    <Card
      id="profiles"
      title="Profiles to Review"
      description="Investor profiles for upcoming meetings, waiting on your review."
      count={total(f)}
      tone={tone}
      moreHref={data.links.profiles}
      feed={f}
      empty="No investor profiles waiting on your review."
    >
      {f.rows.slice(0, ROW_LIMIT).map((r) => (
        <ItemTarget key={r.key} data={data} href={r.href}>
          <Line
            critical={isCritical(r.due, data.today)}
            edge={dueTone(r.due, data.today)}
            title={r.subject}
            sub={r.lead.replace(/ — $/, "")}
            right={<DueText day={r.due} label={r.dueLabel} today={data.today} />}
          />
        </ItemTarget>
      ))}
    </Card>
  )
}

// ---------------------------------------------------------------------------
// Clients & ops
// ---------------------------------------------------------------------------

function MarketingCard({ data }: { data: MyDashboardData }) {
  const f = data.marketing
  return (
    <Card
      id="marketing"
      title="Active Marketing"
      description="Your clients in Live Outreach, with meetings booked against the target."
      count={total(f)}
      moreHref={data.links.liveOutreach}
      feed={f}
      empty="None of your clients are in Live Outreach."
    >
      {f.rows.map((m) => {
        const pct = m.required > 0 ? Math.min(100, Math.round((m.booked / m.required) * 100)) : 0
        const body = (
          <div className="px-3 py-1.5" style={{ borderBottom: "1px solid " + RULE }}>
            <div className="truncate font-medium" style={{ fontSize: 12.5, color: TEXT_PRIMARY }}>
              {m.ticker ?? m.client}
              {m.eventName && (
                <span className="font-normal" style={{ color: TEXT_MUTED }}>
                  {" "}
                  · {m.eventName}
                </span>
              )}
            </div>
            <div className="mt-1 h-[5px] overflow-hidden rounded-full" style={{ background: NEUTRAL.bg }}>
              <span className="block h-full rounded-full" style={{ width: pct + "%", background: TEXT_TERTIARY }} />
            </div>
            <div className="mt-0.5 truncate tabular-nums" style={{ fontSize: 11.5, color: TEXT_MUTED }}>
              {m.booked} of {m.required} booked · {m.open > 0 ? `${m.open} open` : "fully booked"}
              {m.dates && <> · {m.dates}</>}
            </div>
          </div>
        )
        // Row → the event drawer for the Live Outreach event this row is built
        // from, in place (not the Live Outreach page). No id → plain row.
        return m.eventId ? (
          <OpenEventRow key={m.key} eventId={m.eventId}>
            {body}
          </OpenEventRow>
        ) : (
          <div key={m.key}>{body}</div>
        )
      })}
    </Card>
  )
}

function ContractsCard({ data, tone }: { data: MyDashboardData; tone: Tone }) {
  const f = data.contracts
  return (
    <Card
      id="contracts"
      title="Contracts Expiring"
      description="Client contracts whose term ends in the next 60 days."
      count={total(f)}
      tone={tone}
      moreHref={data.links.contracts}
      feed={f}
      empty="No contracts expire in the next 60 days."
    >
      {f.rows.slice(0, CONTRACT_LIMIT).map((c) => {
        const cTone = contractTone(c.daysLeft)
        return (
          // Non-interactive for now (2026-10-17): no link, no hover — display only.
          <div key={c.key}>
            <Line
              edge={cTone}
              lead={<DaysLeft days={c.daysLeft} tone={cTone} />}
              title={<ClientName name={c.client} ticker={c.ticker} />}
              sub={
                // Every date is labelled; the notice date only while still ahead.
                [
                  c.noticeDay ? "Notice by " + fmtDay(c.noticeDay) : null,
                  c.autoRenew == null ? null : c.autoRenew ? "Auto-renew" : "No auto-renew",
                ]
                  .filter(Boolean)
                  .join(" · ") || undefined
              }
              right={
                // Red within 7 days, amber within 30, otherwise neutral.
                <span className={cTone !== "plain" ? "font-semibold" : undefined} style={{ color: toneColor(cTone) }}>
                  Expires {fmtExpiry(c.termEndDay)}
                </span>
              }
            />
          </div>
        )
      })}
    </Card>
  )
}

function OnboardingCard({ data }: { data: MyDashboardData }) {
  const f = data.onboarding
  return (
    <Card
      id="onboarding"
      title="Onboarding"
      description="New clients working through their onboarding checklist."
      count={total(f)}
      moreHref={data.links.onboarding}
      feed={f}
      empty="None of your clients are onboarding."
    >
      {f.rows.slice(0, ROW_LIMIT).map((o) => {
        const done = o.steps.filter((s) => s.done).length
        return (
          // Row → the onboarding card in place (not the Onboarding page).
          <OpenOnboardingRow key={o.accountId} accountId={o.accountId}>
            <Line
              title={<ClientName name={o.name} ticker={o.ticker} />}
              sub={
                <span className="inline-flex items-center gap-[3px]">
                  {/* Filled = done, hollow = not yet — shape, not colour. */}
                  {o.steps.map((s) => (
                    <span
                      key={s.label}
                      title={s.label + (s.done ? " — done" : "")}
                      className="inline-block shrink-0 rounded-full"
                      style={{
                        width: 7,
                        height: 7,
                        background: s.done ? TEXT_SECONDARY : "transparent",
                        border: "1px solid " + (s.done ? TEXT_SECONDARY : TEXT_TERTIARY),
                      }}
                    />
                  ))}
                  <span className="ml-1 tabular-nums">
                    {done} of {o.steps.length} steps
                  </span>
                </span>
              }
              right={o.days != null ? "Day " + o.days : undefined}
            />
          </OpenOnboardingRow>
        )
      })}
    </Card>
  )
}

/** Time Off — APPROVALS ONLY: requests waiting on the viewer. */
function TimeOffCard({ data, tone }: { data: MyDashboardData; tone: Tone }) {
  const f = data.approvals
  return (
    <Card
      id="time-off"
      title="Time Off Approvals"
      description="Time-off requests waiting on your approval — approve or deny inline."
      count={total(f)}
      tone={tone}
      moreHref={data.links.timeOff}
      feed={f}
      empty="No time-off requests are waiting on your approval."
    >
      {f.rows.slice(0, ROW_LIMIT).map((a) => (
        // Row → the full approval drawer in place; inline Approve / Deny = fast path.
        <TimeOffApprovalRow key={a.key} id={a.key} requester={a.requester} canAct={data.canReviewTimeOff}>
          <Line
            // Always critical: a pending approval blocks the requester.
            critical
            title={a.requester}
            sub={[
              a.start === a.end ? fmtDay(a.start) : `${fmtDay(a.start)} – ${fmtDay(a.end)}`,
              a.totalDays != null ? `${a.totalDays} day${a.totalDays === 1 ? "" : "s"}` : null,
              a.requestType,
            ]
              .filter(Boolean)
              .join(" · ")}
          />
        </TimeOffApprovalRow>
      ))}
    </Card>
  )
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

const LONG_DATE = new Intl.DateTimeFormat("en-US", {
  timeZone: "UTC",
  weekday: "long",
  month: "long",
  day: "numeric",
  year: "numeric",
})

function greeting(): string {
  const hour = Number(
    new Intl.DateTimeFormat("en-US", {
      timeZone: "America/New_York",
      hour: "numeric",
      hourCycle: "h23",
    }).format(new Date()),
  )
  return hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening"
}

/**
 * "Jump to" — the quick-link bar (approved mockup quicklinks-v3, variant D·),
 * low-key (2026-10-08): a light-gray bar (a shade off the page canvas) with a
 * light 1px border and rounded corners,
 * muted text, thin dividers between segments; a light brand-blue tint + blue
 * text only on hover. Equal, slim segments (a quiet row of shortcuts, not a
 * primary control). Only the pages the viewer may open are passed in, so the
 * rest share the width evenly. Dividers are 1px box-shadows on each segment's
 * left and top; the container clips those on its outer edge, so they stay right when
 * the bar wraps on a narrow screen or links are hidden.
 */
function JumpBar({ links }: { links: { href: string; label: string }[] }) {
  if (links.length === 0) return null
  return (
    // Bottom divider (2026-10-17): a 1px muted slate-grey (#9fb0c4) line underneath.
    <nav aria-label="Jump to page" className="mb-4 flex flex-col gap-1 border-b border-[#9fb0c4] pb-3 sm:flex-row sm:items-center sm:gap-3">
      <span
        className="shrink-0 font-semibold uppercase"
        style={{ fontSize: 10.5, letterSpacing: "0.06em", color: TEXT_TERTIARY }}
      >
        Jump to page
      </span>
      {/* A defined but low-key container: a light-gray fill one shade off the page
          canvas (CANVAS #F4F6F9 → #EEF1F5), light 1px border, rounded. */}
      <div className="flex min-w-0 flex-1 flex-wrap overflow-hidden rounded-[10px] border border-[#E2E6EC] bg-[#EEF1F5]">
        {links.map((l) => (
          <Link
            key={l.href}
            href={l.href}
            className="flex min-w-[140px] flex-1 items-center justify-center px-2.5 py-1.5 text-center font-medium transition-colors hover:bg-[rgba(3,85,167,0.07)] hover:text-[#0355A7] focus:outline-none focus-visible:bg-[rgba(3,85,167,0.07)] focus-visible:text-[#0355A7]"
            // Muted at rest; thin divider only between segments (edges clipped).
            style={{ fontSize: 12.5, color: TEXT_SECONDARY, boxShadow: "-1px 0 0 #DDE2E9, 0 -1px 0 #DDE2E9" }}
          >
            {l.label}
          </Link>
        ))}
      </div>
    </nav>
  )
}

/**
 * KPI tile = the shared floating StatCard (white, subtle border + shadow, number
 * over label — the original look). Restored 2026-10-08 after a brief condensed
 * inline version; it sits inside the top banner, above My Book. Display-only
 * since 2026-10-17 (was a jump link to its card).
 */
function Kpi({ value, label, tone }: { value: number; label: string; tone?: Tone }) {
  const color = value > 0 ? toneColor(tone) : undefined
  return <StatCard floating compact label={label} value={value} valueColor={color} />
}

/** My Book role tags, as in the mockup (full role name on hover). */
const BOOK_ROLE_TAG: Record<string, string> = {
  account_manager: "PRI",
  secondary_manager: "SEC",
  associate: "ASSOC",
  logistics: "LOG",
}

/**
 * @param criticalCount — the nav badge's own number (loadMyDashboardCriticalCount,
 *   memoised with the badge per request): every row the page flags critical.
 *   Shown as the "Items Requiring Attention" KPI (2026-10-17), so the tile and
 *   the Home badge are ONE number and can never disagree.
 */
export function MyDashboardView({ data, criticalCount }: { data: MyDashboardData; criticalCount: number }) {
  const t = tones(data)
  return (
    <TaskDrawerHost>
      <TimeOffDrawerHost>
        <MeetingDrawerHost crmBase={data.crmBase} canEdit={data.canOpenMeetings}>
          <EventDrawerHost showAdminPanels={data.canOpenEvents}>
          <OnboardingDrawerHost allHref={data.links.onboarding}>
          <div className="mx-auto max-w-[1500px]">
            <div className="mb-4">
              <ListTitleCard
                compact
                title={greeting() + (data.firstName ? ", " + data.firstName : "")}
                subtitle={LONG_DATE.format(new Date(data.today + "T00:00:00Z"))}
                // Flag legend top-right of the banner (2026-10-17), where the removed pill sat.
                rightSlot={<FlagLegend />}
              >
                {/* ONE top banner (2026-10-08, mockup my-dashboard-topbanner): greeting
                    (above; the "Needs you now" pill was removed 2026-10-17), the KPI tiles (original white StatCards), then My Book under a thin rule. */}
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
                  {/* The six KPIs (2026-10-17), display-only. "Items Requiring Attention" is
                      the Home nav badge's number (criticalCount — every "!" row; replaced
                      the "Overdue Items" count); "Feedback Reports" = Pending Review + In Process. */}
                  <Kpi value={criticalCount} label="Items Requiring Attention" tone="over" />
                  <Kpi value={total(data.collect)} label="Feedback Collection" tone={t.collect} />
                  <Kpi
                    value={total(data.review) + total(data.claimed)}
                    label="Feedback Reports"
                    tone={cardTone([t.review, t.claimed])}
                  />
                  <Kpi value={total(data.hosting)} label="Hosting (Next 7 Days)" tone={t.hosting} />
                  <Kpi value={total(data.contracts)} label="Contracts Expiring (≤ 60 days)" tone={t.contracts} />
                  <Kpi value={total(data.approvals)} label="Approvals" tone={t.approvals} />
                </div>

                {/* My Book — inside the banner, under a thin rule. Same data and links as
                    before (CORE_TEAM_ROLES groups; tickers open Client Detail). */}
                {/* ONE continuous wrapping flow (2026-10-08): the label, every role tag,
                    ticker and separator are direct children of this row, so lines break
                    wherever the width runs out — never per role group. */}
                <div
                  className="mt-3 flex flex-wrap items-center gap-x-1 gap-y-1.5 pt-2.5"
                  style={{ borderTop: "1px solid #E6EAF0" }}
                >
                  {data.book.groups.length === 0 && (
                    <span style={{ fontSize: 12, color: TEXT_MUTED }}>
                      You are not on any active client&apos;s account team.
                    </span>
                  )}
                  {data.book.groups.map((g, i) => (
                    <React.Fragment key={g.role}>
                      {i > 0 && (
                        <span
                          aria-hidden="true"
                          className="mx-1.5 inline-block size-1 shrink-0 rounded-full"
                          style={{ background: "#C8D4E3" }}
                        />
                      )}
                      <>
                        <span
                          className="font-bold"
                          style={{ fontSize: 9.5, letterSpacing: "0.03em", color: TEXT_MUTED }}
                          title={g.label}
                        >
                          {BOOK_ROLE_TAG[g.role] ?? g.label}
                        </span>
                        {g.clients.map((c) => {
                          const tick = (
                            <span
                              className="inline-block rounded-[5px] border border-[#E6EAF0] font-semibold tabular-nums transition-colors"
                              style={{ fontSize: 10.5, padding: "1px 6px", color: TEXT_SECONDARY, background: CANVAS }}
                              title={c.name}
                            >
                              {c.ticker ?? c.name}
                            </span>
                          )
                          return c.href ? (
                            <Link
                              key={c.accountId}
                              prefetch={false}
                              href={c.href}
                              className="[&>span]:hover:border-[#0355A7] [&>span]:hover:text-[#0355A7]"
                            >
                              {tick}
                            </Link>
                          ) : (
                            <React.Fragment key={c.accountId}>{tick}</React.Fragment>
                          )
                        })}
                      </>
                    </React.Fragment>
                  ))}
                  {data.book.portfolioHref && data.book.count > 0 && (
                    <Link
                      href={data.book.portfolioHref}
                      className="ml-auto shrink-0 pl-2 font-semibold hover:underline"
                      style={{ fontSize: 11, color: "#0355A7" }}
                    >
                      Open all in Portfolio →
                    </Link>
                  )}
                </div>
              </ListTitleCard>
            </div>

            {/* Jump to page — quick links, directly below the top banner
                (only pages the viewer can open). */}
            <JumpBar links={data.jumpLinks} />

            {data.viewerUnresolved && (
              <div
                className={CARD_CLASS + " mb-4 px-3.5 py-3"}
                style={{
                  fontSize: 12.5,
                  color: AMBER.text,
                  background: AMBER.bg,
                }}
              >
                <strong>Your sign-in could not be matched to a CRM record</strong>, so your personal items are showing
                nothing rather than nothing-outstanding. Ask an admin to check your user record in Dynamics.
              </div>
            )}

            {/* Explicit grid, fixed homes, no masonry (2026-10-17: two columns, was
          three). Left = Things To Do; right = Administrative & More. Two columns from lg up; one stacked column below. */}
            {/* Vertical divider (2026-10-17): a 1px stone (#e6eaf0) hairline down the centre of
                the column gap, drawn as a ::before so it spans the taller column;
                lg only — gone when the grid stacks to one column. */}
            <div className="relative grid grid-cols-1 items-start gap-4 lg:grid-cols-2 lg:gap-x-8 lg:before:absolute lg:before:inset-y-0 lg:before:left-1/2 lg:before:w-px lg:before:-translate-x-1/2 lg:before:bg-[#e6eaf0] lg:before:content-['']">
              <div className="flex min-w-0 flex-col gap-3">
                <GroupLabel
                  overline="Action items"
                  label="Things To Do"
                  description="Feedback to collect, reports to write or review, profiles, open tasks, and meetings you host."
                />
                <CollectCard data={data} tone={t.collect} />
                <ReportCard
                  data={data}
                  id="review"
                  title="Feedback Reports Pending Review"
                  description="Feedback reports on your clients that are written and waiting for review."
                  feed={data.review}
                  tone={t.review}
                  empty="No reports pending review on your clients."
                />
                <ReportCard
                  data={data}
                  id="claimed"
                  title="Feedback Reports In Process"
                  description="Feedback reports you have claimed and still need to finish."
                  feed={data.claimed}
                  tone={t.claimed}
                  empty="You haven't claimed any open reports."
                />
                <ProfilesCard data={data} tone={t.profiles} />
                <TasksCard data={data} tone={t.tasks} />
                <HostingCard data={data} tone={t.hosting} />
              </div>
              <div className="flex min-w-0 flex-col gap-3">
                <GroupLabel
                  overline="Informational"
                  label="Administrative & More"
                  description="Time-off approvals, client onboarding, expiring contracts, and live marketing."
                />
                <TimeOffCard data={data} tone={t.approvals} />
                <OnboardingCard data={data} />
                <ContractsCard data={data} tone={t.contracts} />
                <MarketingCard data={data} />
              </div>
            </div>
          </div>
          </OnboardingDrawerHost>
          </EventDrawerHost>
        </MeetingDrawerHost>
      </TimeOffDrawerHost>
    </TaskDrawerHost>
  )
}
