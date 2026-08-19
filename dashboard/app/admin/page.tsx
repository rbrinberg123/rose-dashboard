import type { Metadata } from "next"
import Link from "next/link"
import {
  Activity,
  AlertTriangle,
  Database,
  Mail,
  Trash2,
  GitCommit,
  ExternalLink,
  RefreshCw,
  ArrowRight,
  BookOpen,
  Eye,
  EyeOff,
  Users,
  ShieldCheck,
} from "lucide-react"

import { PageShell } from "@/components/page-shell"
import { ListTitleCard } from "@/components/page-masthead"
import { getSupabaseServer } from "@/lib/supabase"
import { formatRelative, formatDate } from "@/lib/format"
import { KPI_CARD_CLASS, CARD_CLASS, TEXT_MUTED, TEXT_PRIMARY } from "@/lib/design"
import { VIEW_AS_ROLE_OPTIONS } from "@/lib/access-control"
import { setViewAsAction } from "@/app/view-as-actions"
import { RefreshSummariesCard } from "./refresh-summaries-card"

export const dynamic = "force-dynamic"

export const metadata: Metadata = { title: "Admin" }

/*
 * ENV VARS this page reads (set in Vercel → Project → Settings → Environment
 * Variables). All are OPTIONAL — each external card renders only when its URL
 * resolves, and the two with defaults always render:
 *
 *   NEXT_PUBLIC_VERCEL_DASHBOARD_URL   Vercel project overview URL (card hidden if unset)
 *   NEXT_PUBLIC_SUPABASE_DASHBOARD_URL Supabase project dashboard URL
 *                                      (default: this project's dashboard)
 *   NEXT_PUBLIC_DYNAMICS_URL           Dynamics/Dataverse base URL
 *                                      (default: https://clientcrm.crm.dynamics.com)
 *   NEXT_PUBLIC_GITHUB_REPO_URL        GitHub repo URL (card hidden if unset)
 *   NEXT_PUBLIC_STATUS_URL             Uptime / status / DNS page (card hidden if unset)
 *
 * Build/environment tile reads the Vercel-injected system vars:
 *   VERCEL_ENV, VERCEL_GIT_COMMIT_SHA, VERCEL_REGION (undefined when local).
 */

// --- External dashboard URLs (resolved once) -------------------------------
const SUPABASE_BASE =
  process.env.NEXT_PUBLIC_SUPABASE_DASHBOARD_URL?.replace(/\/$/, "") ||
  "https://supabase.com/dashboard/project/uegfmuvkavexmxxaxnwe"
const DYNAMICS_BASE =
  process.env.NEXT_PUBLIC_DYNAMICS_URL?.replace(/\/$/, "") ||
  "https://clientcrm.crm.dynamics.com"
const VERCEL_BASE = process.env.NEXT_PUBLIC_VERCEL_DASHBOARD_URL?.replace(/\/$/, "")
const GITHUB_URL = process.env.NEXT_PUBLIC_GITHUB_REPO_URL
const STATUS_URL = process.env.NEXT_PUBLIC_STATUS_URL

// Key mirror tables + views to size on the hub (detail lives on /admin/database).
const MIRROR_TABLES = [
  "accounts",
  "meetings",
  "events",
  "contracts",
  "client_notes",
  "tasks",
] as const
const KEY_VIEWS = ["v_client_portfolio", "v_scheduler_meetings", "v_feedback_pipeline"] as const

// The two scheduled digest emails, keyed by cron_send_log.job_key.
const EMAIL_JOBS = [
  { key: "feedback_digest", label: "Feedback digest" },
  { key: "live_outreach_digest", label: "Live Outreach digest" },
] as const

// Pages parked off the main nav but kept reachable here (Admin is super-user-
// gated, so these stay super-user-only). To park another page later, add ONE
// line — { href, label } — to this array; the Hidden Pages section renders it.
const HIDDEN_PAGES = [
  { href: "/pipeline", label: "Upcoming Meetings" },
  { href: "/relationships", label: "Relationships" },
  { href: "/conference-rooms", label: "Conference Rooms" },
] as const

type Health = "ok" | "warn" | "bad" | "muted"

// ---------------------------------------------------------------------------
// Server-side data loaders — every one fails soft (returns null on any error)
// so a single broken query shows "unavailable" instead of crashing the page.
// ---------------------------------------------------------------------------

type SyncRun = {
  entity_name: string
  last_synced_at: string | null
  last_status: string | null
  error_count: number | null
}

async function loadSyncHealth() {
  try {
    const sb = getSupabaseServer()
    const { data, error } = await sb
      .from("sync_runs")
      .select("entity_name, last_synced_at, last_status, error_count")
      .order("entity_name", { ascending: true })
    if (error) return null
    const runs = (data ?? []) as SyncRun[]
    const times = runs
      .map((r) => (r.last_synced_at ? new Date(r.last_synced_at).getTime() : NaN))
      .filter((t) => !Number.isNaN(t))
    const newest = times.length ? Math.max(...times) : null
    const ageHours = newest == null ? null : (Date.now() - newest) / 3_600_000
    const anyErrored = runs.some((r) => r.last_status === "error")
    const stale = ageHours != null && ageHours > 25
    return { runs, newest, anyErrored, stale }
  } catch {
    return null
  }
}

async function loadSyncErrors() {
  try {
    const sb = getSupabaseServer()
    const [{ count, error: cErr }, { data, error: dErr }] = await Promise.all([
      sb.from("sync_errors").select("*", { count: "exact", head: true }),
      sb
        .from("sync_errors")
        .select("id, entity_name, error_message, created_at")
        .order("created_at", { ascending: false })
        .limit(3),
    ])
    if (cErr || dErr) return null
    return {
      count: count ?? 0,
      latest: (data ?? []) as {
        id: number
        entity_name: string
        error_message: string
        created_at: string
      }[],
    }
  } catch {
    return null
  }
}

async function loadReconciliation() {
  // Guarded: the deletion_candidates table may not exist yet in some
  // environments. Any error (including "relation does not exist") → null.
  try {
    const sb = getSupabaseServer()
    const { count, error } = await sb
      .from("deletion_candidates")
      .select("*", { count: "exact", head: true })
      .eq("status", "pending")
    if (error) return null
    return { pending: count ?? 0 }
  } catch {
    return null
  }
}

/** Current wall-clock in US Eastern: weekday (0=Sun…6=Sat) + YYYY-MM-DD date. */
function easternToday(): { weekday: number; date: string } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    weekday: "short",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date())
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? ""
  const map: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }
  return {
    weekday: map[get("weekday")] ?? -1,
    date: `${get("year")}-${get("month")}-${get("day")}`,
  }
}

async function loadEmailJobs() {
  try {
    const sb = getSupabaseServer()
    const { date: todayET, weekday } = easternToday()
    const isWeekday = weekday >= 1 && weekday <= 5
    const results = await Promise.all(
      EMAIL_JOBS.map(async (job) => {
        const { data, error } = await sb
          .from("cron_send_log")
          .select("sent_on, sent_at")
          .eq("job_key", job.key)
          .order("sent_on", { ascending: false })
          .limit(1)
          .maybeSingle()
        if (error) return { ...job, lastSentOn: null, sentToday: false, unavailable: true }
        const lastSentOn = (data?.sent_on as string | undefined) ?? null
        return {
          ...job,
          lastSentOn,
          sentToday: lastSentOn === todayET,
          unavailable: false,
        }
      }),
    )
    return { jobs: results, isWeekday, todayET }
  } catch {
    return null
  }
}

/**
 * How many active clients a full AI-summary refresh would regenerate — shown in
 * the confirmation dialog so the cost is explicit before the click. Same active
 * set the batch itself uses (listActiveClientIds → v_client_detail_summary).
 * Fails soft to null, which the dialog renders as "all".
 */
async function loadActiveClientCount(): Promise<number | null> {
  try {
    const sb = getSupabaseServer()
    const { count, error } = await sb
      .from("v_client_detail_summary")
      .select("*", { count: "exact", head: true })
    if (error) return null
    return count ?? 0
  } catch {
    return null
  }
}

async function tableCount(name: string): Promise<number | null> {
  try {
    const sb = getSupabaseServer()
    const { count, error } = await sb.from(name).select("*", { count: "exact", head: true })
    if (error) return null
    return count ?? 0
  } catch {
    return null
  }
}

async function loadDatabase() {
  const tableEntries = await Promise.all(
    MIRROR_TABLES.map(async (t) => [t, await tableCount(t)] as const),
  )
  const viewEntries = await Promise.all(
    KEY_VIEWS.map(async (v) => [v, await tableCount(v)] as const),
  )
  // Connectivity: if every probe failed, the DB is unreachable.
  const allNull = [...tableEntries, ...viewEntries].every(([, c]) => c === null)
  if (allNull) return null
  return { tables: tableEntries, views: viewEntries }
}

// ---------------------------------------------------------------------------
// Presentation helpers
// ---------------------------------------------------------------------------

const DOT: Record<Health, string> = {
  ok: "#0E7C56",
  warn: "#B7791F",
  bad: "#C53030",
  muted: "#9AA1AD",
}

function StatusDot({ health }: { health: Health }) {
  return (
    <span
      aria-hidden="true"
      className="inline-block size-2.5 shrink-0 rounded-full"
      style={{ background: DOT[health] }}
    />
  )
}

function Tile({
  icon: Icon,
  label,
  health = "muted",
  children,
  footer,
}: {
  icon: React.ComponentType<{ className?: string; style?: React.CSSProperties }>
  label: string
  health?: Health
  children: React.ReactNode
  footer?: React.ReactNode
}) {
  return (
    <div className={`flex flex-col p-4 ${KPI_CARD_CLASS}`}>
      <div className="mb-2 flex items-center gap-2">
        <Icon className="size-4 shrink-0" style={{ color: TEXT_MUTED }} />
        <span className="text-xs font-medium uppercase tracking-wider" style={{ color: TEXT_MUTED }}>
          {label}
        </span>
        <span className="ml-auto">
          <StatusDot health={health} />
        </span>
      </div>
      <div className="flex-1">{children}</div>
      {footer ? <div className="mt-3 border-t border-[rgba(16,24,40,0.06)] pt-2 text-xs">{footer}</div> : null}
    </div>
  )
}

/** Shown inside a tile when its query failed — never crashes the page. */
function Unavailable() {
  return <div className="text-sm text-muted-foreground">Unavailable</div>
}

function BigValue({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-[26px] font-semibold leading-none tabular-nums" style={{ color: TEXT_PRIMARY }}>
      {children}
    </div>
  )
}

function TileLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link href={href} className="inline-flex items-center gap-1 font-medium text-[#0355A7] hover:underline">
      {children}
      <ArrowRight className="size-3" />
    </Link>
  )
}

// ---------------------------------------------------------------------------
// Link cards (in-app + external)
// ---------------------------------------------------------------------------

function InternalCard({
  icon: Icon,
  title,
  description,
  href,
}: {
  icon: React.ComponentType<{ className?: string }>
  title: string
  description: string
  href: string
}) {
  return (
    <Link href={href} className={`group flex items-start gap-3 p-4 ${CARD_CLASS} transition hover:-translate-y-0.5`}>
      <span className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-lg bg-[#EEF2FB] text-[#1E2858]">
        <Icon className="size-[18px]" />
      </span>
      <div className="min-w-0">
        <div className="flex items-center gap-1.5 font-medium" style={{ color: TEXT_PRIMARY }}>
          {title}
          <ArrowRight className="size-3.5 opacity-0 transition group-hover:opacity-100" />
        </div>
        <p className="mt-0.5 text-xs" style={{ color: TEXT_MUTED }}>
          {description}
        </p>
      </div>
    </Link>
  )
}

function ExternalCard({
  icon: Icon,
  title,
  description,
  href,
  links,
}: {
  icon: React.ComponentType<{ className?: string }>
  title: string
  description: string
  href: string
  links?: { label: string; href: string }[]
}) {
  return (
    <div className={`flex flex-col gap-3 p-4 ${CARD_CLASS}`}>
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className="group flex items-start gap-3"
      >
        <span className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-lg bg-[#F1F3F7] text-[#5B6472]">
          <Icon className="size-[18px]" />
        </span>
        <div className="min-w-0">
          <div className="flex items-center gap-1.5 font-medium" style={{ color: TEXT_PRIMARY }}>
            {title}
            <ExternalLink className="size-3.5 opacity-40 transition group-hover:opacity-100" />
          </div>
          <p className="mt-0.5 text-xs" style={{ color: TEXT_MUTED }}>
            {description}
          </p>
        </div>
      </a>
      {links && links.length > 0 ? (
        <div className="flex flex-wrap gap-x-3 gap-y-1 border-t border-[rgba(16,24,40,0.06)] pl-12 pt-2 text-xs">
          {links.map((l) => (
            <a
              key={l.href}
              href={l.href}
              target="_blank"
              rel="noopener noreferrer"
              className="text-[#0355A7] hover:underline"
            >
              {l.label}
            </a>
          ))}
        </div>
      ) : null}
    </div>
  )
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider" style={{ color: TEXT_MUTED }}>
      {children}
    </h2>
  )
}

/**
 * Super-user "View as role" control — a compact dropdown + Apply that starts
 * impersonation. Deliberately kept OFF the main nav and only here on the Admin
 * hub (itself super-user-only). Applying posts to setViewAsAction (which
 * re-checks the REAL role) and redirects into the impersonated view; the slim
 * top banner is then the always-present way back. Selecting "Super User" clears
 * impersonation. It is a plain server-action form — no client JS needed.
 */
function ViewAsControl() {
  return (
    <div className={`flex flex-wrap items-center gap-x-3 gap-y-2 p-4 ${CARD_CLASS}`}>
      <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-[#EEF2FB] text-[#1E2858]">
        <Eye className="size-[18px]" />
      </span>
      <div className="min-w-0">
        <div className="font-medium" style={{ color: TEXT_PRIMARY }}>
          View as role
        </div>
        <p className="text-xs" style={{ color: TEXT_MUTED }}>
          Preview the app as another role. A banner keeps an exit always in reach.
        </p>
      </div>
      <form action={setViewAsAction} className="ml-auto flex items-center gap-2">
        <label htmlFor="view-as-role" className="sr-only">
          Role to view as
        </label>
        <select
          id="view-as-role"
          name="role"
          defaultValue="super_user"
          className="rounded-md border border-[rgba(16,24,40,0.15)] bg-white px-2.5 py-1.5 text-sm text-[#1E2858] focus:outline-none focus:ring-2 focus:ring-[#0355A7]/30"
        >
          {VIEW_AS_ROLE_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        <button
          type="submit"
          className="rounded-md bg-[#1E2858] px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-[#0355A7]"
        >
          Apply
        </button>
      </form>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default async function AdminHubPage() {
  const [sync, syncErrors, recon, emails, db, activeClients] = await Promise.all([
    loadSyncHealth(),
    loadSyncErrors(),
    loadReconciliation(),
    loadEmailJobs(),
    loadDatabase(),
    loadActiveClientCount(),
  ])

  const env = process.env.VERCEL_ENV ?? "local"
  const sha = process.env.VERCEL_GIT_COMMIT_SHA
  const region = process.env.VERCEL_REGION

  // Sync tile health.
  const syncHealth: Health = !sync
    ? "muted"
    : sync.stale || sync.anyErrored
      ? "bad"
      : sync.newest == null
        ? "warn"
        : "ok"

  const errHealth: Health = !syncErrors ? "muted" : syncErrors.count > 0 ? "warn" : "ok"
  const reconHealth: Health = !recon ? "muted" : recon.pending > 0 ? "warn" : "ok"
  const emailHealth: Health = !emails
    ? "muted"
    : emails.isWeekday && emails.jobs.some((j) => !j.unavailable && !j.sentToday)
      ? "warn"
      : "ok"
  const dbHealth: Health = !db ? "bad" : "ok"

  return (
    <PageShell title="Admin" hideHeader canvas>
      <div className="space-y-6">
        <ListTitleCard
          title="Admin"
          subtitle="System health — website, sync, reconciliation, email jobs, and database"
        />

        {/* ---- Super-user "View as role" testing control ---- */}
        <ViewAsControl />

        {/* ---- Live health tiles ---- */}
        <section>
          <SectionTitle>Live health</SectionTitle>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {/* Sync */}
            <Tile
              icon={RefreshCw}
              label="Sync"
              health={syncHealth}
              footer={<TileLink href="/admin/sync">Sync status &amp; manual run</TileLink>}
            >
              {!sync ? (
                <Unavailable />
              ) : (
                <>
                  <BigValue>
                    {sync.newest ? formatRelative(new Date(sync.newest).toISOString()) : "never"}
                  </BigValue>
                  <div className="mt-1 text-xs" style={{ color: TEXT_MUTED }}>
                    Newest run across {sync.runs.length} entit{sync.runs.length === 1 ? "y" : "ies"}
                    {sync.stale ? " · over 25h old" : ""}
                    {sync.anyErrored ? " · an entity errored" : ""}
                  </div>
                  <ul className="mt-2 max-h-28 space-y-0.5 overflow-y-auto text-xs">
                    {sync.runs.map((r) => (
                      <li key={r.entity_name} className="flex items-center justify-between gap-2">
                        <span className="flex items-center gap-1.5 truncate">
                          <StatusDot health={r.last_status === "error" ? "bad" : "ok"} />
                          <span className="truncate" style={{ color: TEXT_PRIMARY }}>
                            {r.entity_name}
                          </span>
                        </span>
                        <span className="shrink-0 tabular-nums" style={{ color: TEXT_MUTED }}>
                          {r.last_synced_at ? formatRelative(r.last_synced_at) : "—"}
                        </span>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </Tile>

            {/* Sync errors */}
            <Tile
              icon={AlertTriangle}
              label="Sync errors"
              health={errHealth}
              footer={<TileLink href="/admin/sync">View errors</TileLink>}
            >
              {!syncErrors ? (
                <Unavailable />
              ) : (
                <>
                  <BigValue>{syncErrors.count.toLocaleString()}</BigValue>
                  <div className="mt-1 text-xs" style={{ color: TEXT_MUTED }}>
                    total logged
                  </div>
                  <ul className="mt-2 space-y-1 text-xs">
                    {syncErrors.latest.length === 0 ? (
                      <li style={{ color: TEXT_MUTED }}>No errors logged 🎉</li>
                    ) : (
                      syncErrors.latest.map((e) => (
                        <li key={e.id} className="truncate" title={e.error_message}>
                          <span className="font-medium" style={{ color: TEXT_PRIMARY }}>
                            {e.entity_name}
                          </span>{" "}
                          <span className="text-[#C53030]">{e.error_message}</span>
                        </li>
                      ))
                    )}
                  </ul>
                </>
              )}
            </Tile>

            {/* Reconciliation */}
            <Tile
              icon={Trash2}
              label="Reconciliation"
              health={reconHealth}
              footer={<TileLink href="/admin/reconciliation">Review queue</TileLink>}
            >
              {!recon ? (
                <Unavailable />
              ) : (
                <>
                  <BigValue>{recon.pending.toLocaleString()}</BigValue>
                  <div className="mt-1 text-xs" style={{ color: TEXT_MUTED }}>
                    deletions pending review
                  </div>
                </>
              )}
            </Tile>

            {/* Scheduled emails */}
            <Tile icon={Mail} label="Scheduled emails" health={emailHealth}>
              {!emails ? (
                <Unavailable />
              ) : (
                <ul className="space-y-2 text-xs">
                  {emails.jobs.map((j) => {
                    const missing = emails.isWeekday && !j.unavailable && !j.sentToday
                    return (
                      <li key={j.key} className="flex items-center justify-between gap-2">
                        <span className="flex items-center gap-1.5 truncate">
                          <StatusDot health={j.unavailable ? "muted" : missing ? "warn" : "ok"} />
                          <span className="truncate" style={{ color: TEXT_PRIMARY }}>
                            {j.label}
                          </span>
                        </span>
                        <span className="shrink-0 tabular-nums" style={{ color: TEXT_MUTED }}>
                          {j.unavailable
                            ? "unavailable"
                            : j.lastSentOn
                              ? formatDate(j.lastSentOn)
                              : "never sent"}
                        </span>
                      </li>
                    )
                  })}
                  <li className="pt-1 text-[11px]" style={{ color: TEXT_MUTED }}>
                    {emails.isWeekday
                      ? "Weekday sends expected. Amber = today's send not yet recorded."
                      : "Weekend — no send expected today."}
                  </li>
                </ul>
              )}
            </Tile>

            {/* Database */}
            <Tile
              icon={Database}
              label="Database"
              health={dbHealth}
              footer={<TileLink href="/admin/database">Database health</TileLink>}
            >
              {!db ? (
                <Unavailable />
              ) : (
                <>
                  <BigValue>connected</BigValue>
                  <ul className="mt-2 grid grid-cols-2 gap-x-3 gap-y-0.5 text-xs">
                    {db.tables.map(([name, count]) => (
                      <li key={name} className="flex items-center justify-between gap-2">
                        <span className="truncate" style={{ color: TEXT_MUTED }}>
                          {name}
                        </span>
                        <span className="shrink-0 tabular-nums" style={{ color: TEXT_PRIMARY }}>
                          {count == null ? "—" : count.toLocaleString()}
                        </span>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </Tile>

            {/* Build / environment */}
            <Tile icon={GitCommit} label="Build" health={env === "production" ? "ok" : "muted"}>
              <BigValue>{env}</BigValue>
              <div className="mt-2 space-y-0.5 text-xs">
                <div className="flex items-center justify-between gap-2">
                  <span style={{ color: TEXT_MUTED }}>commit</span>
                  <span className="font-mono tabular-nums" style={{ color: TEXT_PRIMARY }}>
                    {sha ? sha.slice(0, 7) : "—"}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <span style={{ color: TEXT_MUTED }}>region</span>
                  <span className="tabular-nums" style={{ color: TEXT_PRIMARY }}>
                    {region ?? "—"}
                  </span>
                </div>
              </div>
            </Tile>
          </div>
        </section>

        {/* ---- In-app tools ---- */}
        <section>
          <SectionTitle>In-app tools</SectionTitle>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <InternalCard
              icon={RefreshCw}
              title="Sync status &amp; manual run"
              description="Per-entity nightly sync status; trigger a run on demand."
              href="/admin/sync"
            />
            <InternalCard
              icon={Trash2}
              title="Deletion reconciliation"
              description="Review records deleted in Dynamics before they drop out."
              href="/admin/reconciliation"
            />
            <InternalCard
              icon={Database}
              title="Database health"
              description="Row counts, sync watermarks, and recent errors per table."
              href="/admin/database"
            />
            <InternalCard
              icon={Users}
              title="Users"
              description="Set each staff member's role — live, controls what they can access."
              href="/admin/users"
            />
            <InternalCard
              icon={ShieldCheck}
              title="Roles"
              description="Pages × roles matrix — live, controls which pages each role can reach."
              href="/admin/roles"
            />
            <InternalCard
              icon={BookOpen}
              title="Documentation"
              description="Guides for every page, view, and job — plus live system reference."
              href="/admin/docs"
            />
          </div>
        </section>

        {/* ---- Maintenance ---- */}
        <section>
          <SectionTitle>Maintenance</SectionTitle>
          <p className="-mt-2 mb-3 text-xs" style={{ color: TEXT_MUTED }}>
            On-demand jobs. Each runs only when you click it — the scheduled crons are unaffected.
          </p>
          <RefreshSummariesCard clientCount={activeClients} />
        </section>

        {/* ---- Hidden Pages ---- */}
        <section>
          <SectionTitle>Hidden Pages</SectionTitle>
          <p className="-mt-2 mb-3 text-xs" style={{ color: TEXT_MUTED }}>
            Parked pages — off the main nav, kept reachable here.
          </p>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {HIDDEN_PAGES.map((p) => (
              <Link
                key={p.href}
                href={p.href}
                className={`group flex items-center gap-3 p-4 ${CARD_CLASS} transition hover:-translate-y-0.5`}
              >
                <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-[#EEF2FB] text-[#1E2858]">
                  <EyeOff className="size-[18px]" />
                </span>
                <div className="flex min-w-0 items-center gap-1.5 font-medium" style={{ color: TEXT_PRIMARY }}>
                  <span className="truncate">{p.label}</span>
                  <ArrowRight className="size-3.5 shrink-0 opacity-0 transition group-hover:opacity-100" />
                </div>
              </Link>
            ))}
          </div>
        </section>

        {/* ---- External dashboards ---- */}
        <section>
          <SectionTitle>External dashboards</SectionTitle>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {VERCEL_BASE ? (
              <ExternalCard
                icon={Activity}
                title="Vercel"
                description="Deployments, function logs, and observability."
                href={VERCEL_BASE}
                links={[
                  { label: "Deployments", href: `${VERCEL_BASE}/deployments` },
                  { label: "Logs", href: `${VERCEL_BASE}/logs` },
                  { label: "Observability", href: `${VERCEL_BASE}/observability` },
                ]}
              />
            ) : null}

            <ExternalCard
              icon={Database}
              title="Supabase"
              description="Project dashboard — data, logs, auth, and usage."
              href={SUPABASE_BASE}
              links={[
                { label: "Logs", href: `${SUPABASE_BASE}/logs/explorer` },
                { label: "Table editor", href: `${SUPABASE_BASE}/editor` },
                { label: "SQL editor", href: `${SUPABASE_BASE}/sql/new` },
                { label: "Auth users", href: `${SUPABASE_BASE}/auth/users` },
                { label: "Reports", href: `${SUPABASE_BASE}/reports/usage` },
              ]}
            />

            <ExternalCard
              icon={ExternalLink}
              title="Dynamics / Dataverse"
              description="The CRM environment records sync from."
              href={`${DYNAMICS_BASE}/main.aspx`}
            />

            {GITHUB_URL ? (
              <ExternalCard
                icon={GitCommit}
                title="GitHub repo"
                description="Source, commits, and pull requests."
                href={GITHUB_URL}
              />
            ) : null}

            {STATUS_URL ? (
              <ExternalCard
                icon={Activity}
                title="Uptime / status"
                description="External status, uptime, or DNS monitoring."
                href={STATUS_URL}
              />
            ) : null}
          </div>
        </section>
      </div>
    </PageShell>
  )
}
