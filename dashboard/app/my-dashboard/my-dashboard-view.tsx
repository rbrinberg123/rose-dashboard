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

/**
 * The My Dashboard surface — a SERVER component; only the two drawer hosts
 * (task, meeting) are client islands.
 *
 * STYLING: built from the app's own pieces so it reads as native — the
 * ListTitleCard masthead and floating StatCards (as on Alerts), CARD_CLASS
 * surfaces and the app's type scale. NO decorative colour: colour appears only
 * for the two semantic states, overdue (red) and due soon (amber).
 *
 * Layout (approved mockup my-dashboard-v5): every Alerts-style workflow is its
 * own compact card (≤ ROW_LIMIT rows + "All →"), in an EXPLICIT three-column
 * grid under light group labels — every card has a fixed home:
 *   Feedback       Feedback to Collect → Reports · Pending Review → Reports · Open / Claimed
 *   My Work               Other Open Tasks → Hosting · Next 7 Days → Profiles to Review → Onboarding
 *   Administrative & Other Time Off Approvals → Active Marketing → Contracts Expiring
 * A card's count takes the same colour as its KPI tile (cardTone).
 */

const RED = STATUS_PILL_LIGHT.atRisk
const AMBER = STATUS_PILL_LIGHT.watch
const NEUTRAL = STATUS_PILL_LIGHT.neutral
const RULE = "rgba(16,24,40,0.07)"

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

/** One compact row: optional lead (dot) or critical flag, title + sub, right-hand meta. */
function Line({
  lead,
  critical = false,
  title,
  sub,
  right,
}: {
  lead?: React.ReactNode
  /** Severely overdue — shows the red flag (in place of any lead dot). */
  critical?: boolean
  title: React.ReactNode
  sub?: React.ReactNode
  right?: React.ReactNode
}) {
  return (
    <div className="flex items-center gap-2 px-3 py-1.5" style={{ borderBottom: "1px solid " + RULE }}>
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

function Card({
  id,
  title,
  count,
  tone,
  moreHref,
  feed,
  empty,
  children,
}: {
  id: string
  title: string
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
      <div className="flex items-center gap-2 px-3 py-2" style={{ borderBottom: "1px solid " + RULE }}>
        <h2 className="truncate font-bold" style={{ fontSize: 14, color: TEXT_PRIMARY }}>
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

/** Cluster header above a column — a real section header, with a thin rule. */
function GroupLabel({ label }: { label: string }) {
  return (
    <div className="mt-1 flex items-center gap-2 px-1">
      <span className="shrink-0 font-bold" style={{ fontSize: 16, color: TEXT_PRIMARY }}>
        {label}
      </span>
      <span className="h-px flex-1" style={{ background: "rgba(16,24,40,0.14)" }} />
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
      title="Feedback to Collect"
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
        <ItemTarget key={r.key} data={data} href={r.href}>
          <Line
            critical={isCritical(r.due, data.today)}
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
  feed,
  tone,
  empty,
}: {
  data: MyDashboardData
  id: string
  title: string
  feed: Feed<TodoItem>
  tone: Tone
  empty: string
}) {
  return (
    <Card id={id} title={title} count={total(feed)} tone={tone} moreHref={data.links.reports} feed={feed} empty={empty}>
      {feed.rows.slice(0, ROW_LIMIT).map((r) => (
        <ItemTarget key={r.key} data={data} taskId={r.taskId} href={r.href}>
          <Line
            critical={isCritical(r.due, data.today)}
            title={r.subject}
            sub={withReason(r)}
            right={r.due ? <DueText day={r.due} label={r.dueLabel} today={data.today} /> : <span>No date</span>}
          />
        </ItemTarget>
      ))}
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
      count={total(f)}
      moreHref={data.links.liveOutreach}
      feed={f}
      empty="None of your clients are in Live Outreach."
    >
      {f.rows.map((m) => {
        const pct = m.required > 0 ? Math.min(100, Math.round((m.booked / m.required) * 100)) : 0
        return (
          <RowLink key={m.key} href={m.href}>
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
          </RowLink>
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
      count={total(f)}
      tone={tone}
      moreHref={data.links.contracts}
      feed={f}
      empty="No contracts expire in the next 90 days."
    >
      {f.rows.slice(0, CONTRACT_LIMIT).map((c) => {
        const cTone = contractTone(c.daysLeft)
        return (
          <RowLink key={c.key} href={c.href}>
            <Line
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
          </RowLink>
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
      count={total(f)}
      moreHref={data.links.onboarding}
      feed={f}
      empty="None of your clients are onboarding."
    >
      {f.rows.slice(0, ROW_LIMIT).map((o) => {
        const done = o.steps.filter((s) => s.done).length
        return (
          <RowLink key={o.accountId} href={o.href}>
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
          </RowLink>
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
    <nav aria-label="Jump to page" className="mb-4 flex flex-col gap-1 sm:flex-row sm:items-center sm:gap-3">
      <span
        className="shrink-0 font-semibold uppercase"
        style={{ fontSize: 10.5, letterSpacing: "0.06em", color: TEXT_TERTIARY }}
      >
        Jump to
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
 * over label — the original look), wrapped as a jump link to its card. Restored
 * 2026-10-08 after a brief condensed inline version; it now sits inside the top
 * banner, above My Book.
 */
function Kpi({ href, value, label, tone }: { href: string; value: number; label: string; tone?: Tone }) {
  const color = value > 0 ? toneColor(tone) : undefined
  return (
    <a
      href={href}
      className="block rounded-[13px] focus:outline-none focus-visible:ring-2 focus-visible:ring-[rgba(16,24,40,0.12)]"
    >
      <StatCard floating label={label} value={value} valueColor={color} />
    </a>
  )
}

/** My Book role tags, as in the mockup (full role name on hover). */
const BOOK_ROLE_TAG: Record<string, string> = {
  account_manager: "PRI",
  secondary_manager: "SEC",
  associate: "ASSOC",
  logistics: "LOG",
}

/**
 * @param criticalCount — the nav badge's own number (loadMyDashboardCriticalCount):
 *   every row the page flags critical. The pill headline shows exactly this, so
 *   the headline, the red flags and the badge share ONE definition (isCritical +
 *   always-critical approvals) and can never diverge.
 */
export function MyDashboardView({ data, criticalCount }: { data: MyDashboardData; criticalCount: number }) {
  const { today } = data
  const t = tones(data)
  const isOver = (day: string | null) => dueTone(day, today) === "over"
  const overdue =
    [data.collect, data.review, data.claimed, data.profiles].reduce(
      (n, f) => n + f.rows.filter((r) => isOver(r.due)).length,
      0,
    ) +
    data.tasks.rows.filter((r) => r.mine && isOver(r.due)).length +
    data.approvals.rows.filter((a) => isOver(a.start)).length

  // HEADLINE: the critical count (= red flags = nav badge; approvals are inside
  // it, so they are not listed again). Then hosting soon. "N overdue" (any
  // past-due own item, 1+ days) stays only as a muted secondary figure.
  const urgent: React.ReactNode[] = []
  if (criticalCount > 0)
    urgent.push(
      <b key="c" className="font-semibold" style={{ color: RED.text }}>
        {criticalCount} critical
      </b>,
    )
  if (data.hostSoon > 0)
    urgent.push(
      <span key="h">
        <b className="font-semibold">{data.hostSoon} to host</b> today/tomorrow
      </span>,
    )
  if (urgent.length > 0 && overdue > 0)
    urgent.push(
      <span key="o" style={{ color: TEXT_MUTED }}>
        {overdue} overdue
      </span>,
    )

  // "Needs you now" — only when something is critical or hosting is imminent.
  const needsYou =
    urgent.length > 0 ? (
      <div
        className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-full"
        style={{
          background: RED.bg,
          padding: "5px 12px",
          fontSize: 12,
          color: TEXT_PRIMARY,
        }}
      >
        <span className="font-semibold" style={{ color: RED.text }}>
          Needs you now
        </span>
        <span>
          {urgent.map((u, i) => (
            <React.Fragment key={i}>
              {i > 0 && " · "}
              {u}
            </React.Fragment>
          ))}
        </span>
      </div>
    ) : undefined

  return (
    <TaskDrawerHost>
      <TimeOffDrawerHost>
        <MeetingDrawerHost crmBase={data.crmBase} canEdit={data.canOpenMeetings}>
          <div className="mx-auto max-w-[1500px]">
            <div className="mb-4">
              <ListTitleCard
                compact
                title={greeting() + (data.firstName ? ", " + data.firstName : "")}
                subtitle={LONG_DATE.format(new Date(data.today + "T00:00:00Z"))}
                rightSlot={needsYou}
              >
                {/* ONE top banner (2026-10-08, mockup my-dashboard-topbanner): greeting + pill
                    (above), the KPI tiles (original white StatCards), then My Book under a thin rule. */}
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
                  <Kpi href="#collect" value={overdue} label="Overdue" tone="over" />
                  <Kpi href="#collect" value={total(data.collect)} label="To collect" tone={t.collect} />
                  <Kpi href="#review" value={total(data.review)} label="Pending review" tone={t.review} />
                  <Kpi href="#hosting" value={total(data.hosting)} label="Host · 7d" tone={t.hosting} />
                  <Kpi href="#contracts" value={total(data.contracts)} label="Contracts ≤90d" tone={t.contracts} />
                  <Kpi href="#time-off" value={total(data.approvals)} label="Approvals" tone={t.approvals} />
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
                  <span
                    className="mr-1.5 shrink-0 font-bold uppercase"
                    style={{ fontSize: 10.5, letterSpacing: "0.05em", color: TEXT_MUTED }}
                  >
                    My Book · {data.book.count}
                  </span>
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

            {/* Explicit grid: one cluster per column, fixed homes, no masonry.
          Three columns from lg up; one stacked column below. */}
            <div className="mb-3 px-1">
              <h2 className="font-bold" style={{ fontSize: 20, color: TEXT_PRIMARY }}>
                My To-Dos &amp; Activity
              </h2>
              <p style={{ fontSize: 12.5, color: TEXT_MUTED }}>
                What needs your action, and what&apos;s moving on your clients.
              </p>
            </div>
            <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-3">
              <div className="flex min-w-0 flex-col gap-3">
                <GroupLabel label="Feedback" />
                <CollectCard data={data} tone={t.collect} />
                <ReportCard
                  data={data}
                  id="review"
                  title="Reports · Pending Review"
                  feed={data.review}
                  tone={t.review}
                  empty="No reports pending review on your clients."
                />
                <ReportCard
                  data={data}
                  id="claimed"
                  title="Reports · Open / Claimed"
                  feed={data.claimed}
                  tone={t.claimed}
                  empty="You haven't claimed any open reports."
                />
              </div>
              <div className="flex min-w-0 flex-col gap-3">
                <GroupLabel label="My Work" />
                <TasksCard data={data} tone={t.tasks} />
                <HostingCard data={data} tone={t.hosting} />
                <ProfilesCard data={data} tone={t.profiles} />
                <OnboardingCard data={data} />
              </div>
              <div className="flex min-w-0 flex-col gap-3">
                <GroupLabel label="Administrative & Other" />
                <TimeOffCard data={data} tone={t.approvals} />
                <MarketingCard data={data} />
                <ContractsCard data={data} tone={t.contracts} />
              </div>
            </div>
          </div>
        </MeetingDrawerHost>
      </TimeOffDrawerHost>
    </TaskDrawerHost>
  )
}
