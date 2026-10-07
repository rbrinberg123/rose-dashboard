import * as React from "react"
import Link from "next/link"

import { ListTitleCard } from "@/components/page-masthead"
import { StatCard } from "@/components/stat-card"
import {
  CARD_CLASS,
  STATUS_PILL_LIGHT,
  TEXT_MUTED,
  TEXT_PRIMARY,
  TEXT_SECONDARY,
  TEXT_TERTIARY,
} from "@/lib/design"
import { URGENCY_ORDER, dueTone, type Urgency } from "./policy"
import {
  fmtDay,
  type Feed,
  type MyDashboardData,
  type TaskItem,
  type TodoItem,
  type TodoKind,
} from "./load"
import { OpenTaskRow, TaskDrawerHost } from "./task-drawer"

/**
 * The My Dashboard surface — a SERVER component (read-only, nothing to hydrate).
 *
 * STYLING: built from the app's own pieces so it reads as native — the
 * ListTitleCard masthead and floating StatCards (as on Alerts), CARD_CLASS
 * surfaces, and the same type scale as the Alerts rows (14 / 12.5 / 11.5).
 * NO decorative colour: colour appears only for the two semantic states,
 * overdue (red) and due soon (amber). Everything else is neutral.
 *
 * Layout: an EXPLICIT three-column grid (not masonry) so every card has a
 * fixed home —
 *   left    My To-Do
 *   middle  Open Tasks → Contracts Expiring Soon
 *   right   Onboarding (pinned top) → Active Marketing → Time Off approvals
 */

const RED = STATUS_PILL_LIGHT.atRisk
const AMBER = STATUS_PILL_LIGHT.watch
const NEUTRAL = STATUS_PILL_LIGHT.neutral
const RULE = "rgba(16,24,40,0.07)"

const URGENCY_LABEL: Record<Urgency, string> = {
  overdue: "Overdue",
  week: "This week",
  later: "Later / no date",
}
const URGENCY_EDGE: Record<Urgency, string> = {
  overdue: RED.text,
  week: AMBER.text,
  later: "transparent",
}

const KIND_LABEL: Record<TodoKind, string> = {
  collect: "Collect",
  review: "Review",
  report: "Report",
  profiles: "Profiles",
  host: "Host",
  approve: "Approve",
}

// ---------------------------------------------------------------------------
// Small pieces
// ---------------------------------------------------------------------------

/** Neutral pill, same shape as the Alerts page pills. `outline` = the Team variant. */
function Pill({ label, outline = false, strong = false }: { label: string; outline?: boolean; strong?: boolean }) {
  return (
    <span
      className="mt-px inline-flex shrink-0 items-center whitespace-nowrap rounded-full font-medium"
      style={{
        padding: "1px 8px",
        fontSize: 11,
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

/** Wraps a row in a link when there is somewhere to go; the ↗ shows only then. */
/**
 * A row's click target: the CRM task drawer (in place, no navigation) when the
 * item is backed by a task AND the viewer may open tasks; otherwise its link.
 */
function ItemTarget({
  taskId,
  href,
  canOpenTasks,
  children,
}: {
  taskId: string | null
  href: string | null
  canOpenTasks: boolean
  children: React.ReactNode
}) {
  if (taskId && canOpenTasks) return <OpenTaskRow taskId={taskId}>{children}</OpenTaskRow>
  return <RowLink href={href}>{children}</RowLink>
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

function Open({ href }: { href: string | null }) {
  if (!href) return null
  return (
    <span style={{ fontSize: 11.5, color: TEXT_TERTIARY }} aria-hidden="true">
      open ↗
    </span>
  )
}

function DueText({ day, label, today }: { day: string | null; label?: string | null; today: string }) {
  const tone = dueTone(day, today)
  const text = label ?? fmtDay(day) ?? "—"
  return (
    <span
      className="font-medium"
      style={{ color: tone === "over" ? RED.text : tone === "soon" ? AMBER.text : TEXT_SECONDARY }}
    >
      {tone === "over" && day ? "Overdue " + text : text}
    </span>
  )
}

function Card({
  id,
  title,
  count,
  moreHref,
  moreLabel,
  feed,
  empty,
  children,
}: {
  id: string
  title: string
  count: number
  moreHref?: string | null
  moreLabel?: string
  feed: Pick<Feed<unknown>, "error" | "truncated">
  empty: string
  children: React.ReactNode
}) {
  return (
    <section id={id} className={CARD_CLASS + " scroll-mt-4 overflow-hidden"}>
      <div className="flex items-center gap-2 px-3.5 py-2.5" style={{ borderBottom: "1px solid " + RULE }}>
        <h2 className="font-semibold" style={{ fontSize: 14, color: TEXT_PRIMARY }}>
          {title}
        </h2>
        <span className="tabular-nums" style={{ fontSize: 11.5, color: TEXT_MUTED }}>
          {count}
        </span>
        {moreHref && (
          <Link href={moreHref} className="ml-auto hover:underline" style={{ fontSize: 11.5, color: TEXT_MUTED }}>
            {moreLabel ?? "view all"} →
          </Link>
        )}
      </div>
      {feed.error ? (
        <div className="px-3.5 py-2.5" style={{ fontSize: 12, color: RED.text, background: RED.bg }}>
          Could not load this card — {feed.error}
        </div>
      ) : count === 0 ? (
        <div className="px-3.5 py-4" style={{ fontSize: 12.5, color: TEXT_MUTED }}>
          {empty}
        </div>
      ) : (
        <>
          {children}
          {feed.truncated > 0 && (
            <div className="px-3.5 py-1.5" style={{ fontSize: 11.5, color: TEXT_MUTED }}>
              + {feed.truncated} more not shown
            </div>
          )}
        </>
      )}
    </section>
  )
}

function GroupLabel({ label, tone }: { label: string; tone?: "over" | "soon" }) {
  return (
    <div
      className="flex items-center gap-2 px-3.5 pb-0.5 pt-2 font-semibold"
      style={{ fontSize: 11.5, color: tone === "over" ? RED.text : tone === "soon" ? AMBER.text : TEXT_MUTED }}
    >
      {label}
      <span className="h-px flex-1" style={{ background: RULE }} />
    </div>
  )
}

function RowShell({ edge, children }: { edge?: string; children: React.ReactNode }) {
  return (
    <div
      className="flex items-start gap-2.5 px-3.5 py-2"
      style={{ borderBottom: "1px solid " + RULE, boxShadow: edge ? "inset 3px 0 0 " + edge : undefined }}
    >
      {children}
    </div>
  )
}

function RText({ lead, subject, sub }: { lead?: string; subject: React.ReactNode; sub?: string | null }) {
  return (
    <div className="min-w-0 flex-1">
      <div style={{ fontSize: 12.5, color: TEXT_PRIMARY }}>
        {lead}
        <span className="font-medium">{subject}</span>
      </div>
      {sub && (
        <div className="truncate" style={{ fontSize: 11.5, color: TEXT_MUTED }}>
          {sub}
        </div>
      )}
    </div>
  )
}

function RMeta({ children }: { children: React.ReactNode }) {
  return (
    <div className="shrink-0 whitespace-nowrap text-right" style={{ fontSize: 11.5, color: TEXT_MUTED }}>
      {children}
    </div>
  )
}

function ClientName({ name, ticker }: { name: string; ticker: string | null }) {
  return (
    <>
      {name}
      {ticker && <span className="font-normal" style={{ color: TEXT_MUTED }}> ({ticker})</span>}
    </>
  )
}

// ---------------------------------------------------------------------------
// Cards
// ---------------------------------------------------------------------------

function TodoCard({ data }: { data: MyDashboardData }) {
  const { todo, today } = data
  return (
    <Card
      id="todo"
      title="My To-Do"
      count={todo.rows.length}
      feed={todo}
      empty={
        data.viewerUnresolved
          ? "We couldn't match your sign-in to a CRM record, so your personal items can't be shown."
          : "Nothing on your plate right now."
      }
    >
      {URGENCY_ORDER.map((u) => {
        const rows = todo.rows.filter((r) => r.urgency === u)
        if (rows.length === 0) return null
        return (
          <div key={u}>
            <GroupLabel label={URGENCY_LABEL[u]} tone={u === "overdue" ? "over" : u === "week" ? "soon" : undefined} />
            {rows.map((r) => (
              <TodoLine key={r.key} row={r} today={today} canOpenTasks={data.canOpenTasks} />
            ))}
          </div>
        )
      })}
    </Card>
  )
}

function TodoLine({ row, today, canOpenTasks }: { row: TodoItem; today: string; canOpenTasks: boolean }) {
  const opensTask = !!row.taskId && canOpenTasks
  return (
    <ItemTarget taskId={row.taskId} href={row.href} canOpenTasks={canOpenTasks}>
      <RowShell edge={URGENCY_EDGE[row.urgency]}>
        <Pill label={KIND_LABEL[row.kind]} />
        <RText lead={row.lead} subject={row.subject} sub={row.sub} />
        <RMeta>
          <DueText day={row.due} label={row.dueLabel} today={today} />
          <br />
          {/* The ↗ shows whenever the row goes somewhere — a link or the drawer. */}
          <Open href={opensTask ? "task" : row.href} />
        </RMeta>
      </RowShell>
    </ItemTarget>
  )
}

function TaskLine({ t, today, canOpenTasks }: { t: TaskItem; today: string; canOpenTasks: boolean }) {
  const opensTask = canOpenTasks
  return (
    <ItemTarget taskId={t.taskId} href={t.href} canOpenTasks={canOpenTasks}>
      <RowShell>
        {t.mine ? <Pill label="Mine" strong /> : <Pill label="Team" outline />}
        <RText
          lead={t.subject + (t.client ? " — " : "")}
          subject={t.client ?? ""}
          sub={t.mine ? null : [t.assignee, t.role ? "(" + t.role + ")" : null].filter(Boolean).join(" ")}
        />
        <RMeta>
          {t.due ? <DueText day={t.due} today={today} /> : <span>No date</span>}
          <br />
          <Open href={opensTask ? "task" : t.href} />
        </RMeta>
      </RowShell>
    </ItemTarget>
  )
}

function TasksCard({ data }: { data: MyDashboardData }) {
  const { tasks, today } = data
  const mine = tasks.rows.filter((t) => t.mine)
  const team = tasks.rows.filter((t) => !t.mine)
  return (
    <Card
      id="tasks"
      title="Open Tasks"
      count={tasks.rows.length}
      moreHref={data.links.tasks}
      moreLabel="all tasks"
      feed={tasks}
      empty="No open tasks for you or your account teams."
    >
      {mine.length > 0 && <GroupLabel label={"Mine · " + mine.length} />}
      {mine.map((t) => (
        <TaskLine key={t.key} t={t} today={today} canOpenTasks={data.canOpenTasks} />
      ))}
      {team.length > 0 && <GroupLabel label={"Team · " + team.length} />}
      {team.map((t) => (
        <TaskLine key={t.key} t={t} today={today} canOpenTasks={data.canOpenTasks} />
      ))}
    </Card>
  )
}

function OnboardingCard({ data }: { data: MyDashboardData }) {
  const { onboarding } = data
  return (
    <Card
      id="onboarding"
      title="Onboarding"
      count={onboarding.rows.length}
      moreHref={data.links.onboarding}
      moreLabel="view"
      feed={onboarding}
      empty="None of your clients are onboarding."
    >
      {onboarding.rows.map((o) => {
        const done = o.steps.filter((s) => s.done).length
        return (
          <RowLink key={o.accountId} href={o.href}>
            <div className="px-3.5 py-2" style={{ borderBottom: "1px solid " + RULE }}>
              <div className="mb-1 flex items-baseline justify-between gap-2">
                <span className="font-medium" style={{ fontSize: 12.5, color: TEXT_PRIMARY }}>
                  <ClientName name={o.name} ticker={o.ticker} />
                </span>
                <span className="whitespace-nowrap tabular-nums" style={{ fontSize: 11.5, color: TEXT_MUTED }}>
                  {done}/{o.steps.length} done{o.days != null ? " · day " + o.days : ""} <Open href={o.href} />
                </span>
              </div>
              <div className="flex flex-wrap gap-x-2.5 gap-y-0.5">
                {o.steps.map((s) => (
                  <span
                    key={s.label}
                    className="inline-flex items-center gap-1"
                    style={{ fontSize: 11, color: s.done ? TEXT_SECONDARY : TEXT_TERTIARY }}
                  >
                    {/* Filled = done, hollow = not yet — shape, not colour. */}
                    <span
                      className="inline-block shrink-0 rounded-full"
                      style={{
                        width: 7,
                        height: 7,
                        background: s.done ? TEXT_SECONDARY : "transparent",
                        border: "1px solid " + (s.done ? TEXT_SECONDARY : TEXT_TERTIARY),
                      }}
                    />
                    {s.label}
                  </span>
                ))}
              </div>
            </div>
          </RowLink>
        )
      })}
    </Card>
  )
}

function MarketingCard({ data }: { data: MyDashboardData }) {
  const { marketing } = data
  return (
    <Card
      id="marketing"
      title="Active Marketing"
      count={marketing.rows.length}
      moreHref={data.links.liveOutreach}
      moreLabel="live outreach"
      feed={marketing}
      empty="None of your clients are in Live Outreach."
    >
      {marketing.rows.map((m) => {
        const pct = m.required > 0 ? Math.min(100, Math.round((m.booked / m.required) * 100)) : 0
        return (
          <RowLink key={m.key} href={m.href}>
            <div className="px-3.5 py-2" style={{ borderBottom: "1px solid " + RULE }}>
              <div className="flex items-baseline justify-between gap-2">
                <span className="min-w-0 truncate font-medium" style={{ fontSize: 12.5, color: TEXT_PRIMARY }}>
                  {m.client}
                  {m.eventName && <span className="font-normal" style={{ color: TEXT_MUTED }}> · {m.eventName}</span>}
                </span>
                <span className="whitespace-nowrap tabular-nums" style={{ fontSize: 11.5, color: TEXT_MUTED }}>
                  {m.booked} / {m.required} booked
                </span>
              </div>
              <div className="mt-1.5 h-[6px] overflow-hidden rounded-full" style={{ background: NEUTRAL.bg }}>
                <span className="block h-full rounded-full" style={{ width: pct + "%", background: TEXT_TERTIARY }} />
              </div>
              <div className="mt-1 flex justify-between gap-2" style={{ fontSize: 11.5, color: TEXT_MUTED }}>
                <span>
                  {m.open > 0 ? `${m.open} open slot${m.open === 1 ? "" : "s"}` : "Fully booked"}
                  {m.dates && <> · {m.dates}</>}
                </span>
                <Open href={m.href} />
              </div>
            </div>
          </RowLink>
        )
      })}
    </Card>
  )
}

function ContractsCard({ data }: { data: MyDashboardData }) {
  const { contracts } = data
  return (
    <Card
      id="contracts"
      title="Contracts Expiring Soon"
      count={contracts.rows.length}
      moreHref={data.links.contracts}
      moreLabel="contracts"
      feed={contracts}
      empty="No contracts reach a notice date or term end in the next 90 days."
    >
      {contracts.rows.map((c) => (
        <RowLink key={c.key} href={c.href}>
          <RowShell>
            {/* Amber only when genuinely due soon (≤30 days); otherwise neutral. */}
            <span
              className="mt-px shrink-0 rounded-full font-medium tabular-nums"
              style={{
                fontSize: 11,
                padding: "1px 8px",
                background: c.daysLeft <= 30 ? AMBER.bg : NEUTRAL.bg,
                color: c.daysLeft <= 30 ? AMBER.text : NEUTRAL.text,
              }}
            >
              {c.daysLeft}d
            </span>
            <RText
              subject={<ClientName name={c.client} ticker={c.ticker} />}
              sub={[
                "Notice " + (fmtDay(c.noticeDay) ?? "—"),
                "term ends " + (fmtDay(c.termEndDay) ?? "—"),
                "auto-renew: " + (c.autoRenew == null ? "—" : c.autoRenew ? "Yes" : "No"),
              ].join(" · ")}
            />
            <RMeta>
              <Open href={c.href} />
            </RMeta>
          </RowShell>
        </RowLink>
      ))}
    </Card>
  )
}

/** Time Off — APPROVALS ONLY: requests waiting on the viewer. */
function TimeOffCard({ data }: { data: MyDashboardData }) {
  const { approvals, today } = data
  return (
    <Card
      id="time-off"
      title="Time Off Approvals"
      count={approvals.rows.length}
      moreHref={data.links.timeOff}
      moreLabel="time off"
      feed={approvals}
      empty="No time-off requests are waiting on your approval."
    >
      {approvals.rows.map((a) => (
        <RowLink key={a.key} href={a.href}>
          <RowShell>
            <RText
              subject={a.requester}
              sub={[a.requestType, a.totalDays != null ? `${a.totalDays} day${a.totalDays === 1 ? "" : "s"}` : null]
                .filter(Boolean)
                .join(" · ")}
            />
            <RMeta>
              <DueText
                day={a.start}
                label={a.start === a.end ? fmtDay(a.start) : `${fmtDay(a.start)} – ${fmtDay(a.end)}`}
                today={today}
              />
              <br />
              <Open href={a.href} />
            </RMeta>
          </RowShell>
        </RowLink>
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
    new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "numeric", hourCycle: "h23" }).format(new Date()),
  )
  return hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening"
}

/** KPI tile = the shared floating StatCard, wrapped as a jump link to its card. */
function Kpi({ href, value, label, tone }: { href: string; value: number; label: string; tone?: "over" | "soon" }) {
  const color = value > 0 && tone === "over" ? RED.text : value > 0 && tone === "soon" ? AMBER.text : undefined
  return (
    <a href={href} className="block rounded-[13px] focus:outline-none focus-visible:ring-2 focus-visible:ring-[rgba(16,24,40,0.12)]">
      <StatCard floating label={label} value={value} valueColor={color} />
    </a>
  )
}

export function MyDashboardView({ data }: { data: MyDashboardData }) {
  const overdueTodo = data.todo.rows.filter((r) => r.urgency === "overdue").length
  const overdueTasks = data.tasks.rows.filter((t) => t.mine && dueTone(t.due, data.today) === "over").length
  const overdue = overdueTodo + overdueTasks
  const approvals = data.approvals.rows.length
  const hostWeek = data.todo.rows.filter((r) => r.kind === "host").length

  const urgent: React.ReactNode[] = []
  if (overdue > 0) urgent.push(<b key="o" className="font-semibold">{overdue} overdue</b>)
  if (data.hostSoon > 0)
    urgent.push(
      <span key="h">
        <b className="font-semibold">{data.hostSoon} to host</b> today/tomorrow
      </span>,
    )
  if (approvals > 0)
    urgent.push(
      <b key="a" className="font-semibold">
        {approvals} approval{approvals === 1 ? "" : "s"}
      </b>,
    )

  // "Needs you now" — overdue is the semantic red state, so the pill keeps it.
  const needsYou =
    urgent.length > 0 ? (
      <div
        className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-full"
        style={{ background: RED.bg, padding: "5px 12px", fontSize: 12, color: TEXT_PRIMARY }}
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
    <div className="mx-auto max-w-[1500px]">
      <div className="mb-4">
        <ListTitleCard
          compact
          title={greeting() + (data.firstName ? ", " + data.firstName : "")}
          subtitle={LONG_DATE.format(new Date(data.today + "T00:00:00Z"))}
          rightSlot={needsYou}
        >
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5">
            <Kpi href="#todo" value={overdue} label="Overdue" tone="over" />
            <Kpi href="#todo" value={data.todo.rows.length} label="My To-Do" />
            <Kpi href="#tasks" value={data.tasks.rows.length} label="Open Tasks" />
            <Kpi href="#contracts" value={data.contracts.rows.length} label="Contracts ≤90d" />
            <Kpi href="#todo" value={hostWeek} label="Host · Next 7d" />
          </div>
        </ListTitleCard>
      </div>

      {data.viewerUnresolved && (
        <div className={CARD_CLASS + " mb-4 px-3.5 py-3"} style={{ fontSize: 12.5, color: AMBER.text, background: AMBER.bg }}>
          <strong>Your sign-in could not be matched to a CRM record</strong>, so your personal items are
          showing nothing rather than nothing-outstanding. Ask an admin to check your user record in Dynamics.
        </div>
      )}

      {/* My Book strip */}
      <div className={CARD_CLASS + " mb-4 flex flex-wrap items-center gap-x-4 gap-y-2 px-3.5 py-2.5"}>
        <span className="shrink-0 font-semibold" style={{ fontSize: 12.5, color: TEXT_PRIMARY }}>
          My Book · {data.book.count}
        </span>
        {data.book.groups.length === 0 && (
          <span style={{ fontSize: 12.5, color: TEXT_MUTED }}>You are not on any active client&apos;s account team.</span>
        )}
        {data.book.groups.map((g, i) => (
          <React.Fragment key={g.role}>
            {i > 0 && <span className="hidden w-px self-stretch sm:block" style={{ background: RULE }} />}
            <div className="flex flex-wrap items-center gap-1.5">
              <span style={{ fontSize: 11.5, color: TEXT_MUTED }}>{g.label}</span>
              {g.clients.map((c) => {
                const tick = (
                  <span
                    className="inline-block rounded-full font-medium tabular-nums"
                    style={{ fontSize: 11, padding: "1px 8px", color: NEUTRAL.text, background: NEUTRAL.bg }}
                    title={c.name}
                  >
                    {c.ticker ?? c.name}
                  </span>
                )
                return c.href ? (
                  <Link key={c.accountId} href={c.href} className="hover:opacity-80">
                    {tick}
                  </Link>
                ) : (
                  <React.Fragment key={c.accountId}>{tick}</React.Fragment>
                )
              })}
            </div>
          </React.Fragment>
        ))}
        {data.book.portfolioHref && data.book.count > 0 && (
          <Link href={data.book.portfolioHref} className="ml-auto shrink-0 hover:underline" style={{ fontSize: 11.5, color: TEXT_MUTED }}>
            Open all in Portfolio →
          </Link>
        )}
      </div>

      {/* Explicit grid: fixed homes, no masonry. 3 cols ≥xl, 2 cols ≥md
          (right column drops below, spanning both), 1 col on phones. */}
      <div className="grid grid-cols-1 items-start gap-4 md:grid-cols-2 xl:grid-cols-3">
        <div className="flex min-w-0 flex-col gap-4">
          <TodoCard data={data} />
        </div>
        <div className="flex min-w-0 flex-col gap-4">
          <TasksCard data={data} />
          <ContractsCard data={data} />
        </div>
        <div className="grid min-w-0 grid-cols-1 items-start gap-4 md:col-span-2 md:grid-cols-2 xl:col-span-1 xl:grid-cols-1">
          <OnboardingCard data={data} />
          <MarketingCard data={data} />
          <TimeOffCard data={data} />
        </div>
      </div>
    </div>
    </TaskDrawerHost>
  )
}
