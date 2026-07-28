import type { Metadata } from "next"
import Link from "next/link"
import { promises as fs } from "fs"
import path from "path"
import {
  Database,
  Table2,
  CalendarClock,
  RefreshCw,
  KeyRound,
  BookOpen,
} from "lucide-react"

import { PageShell } from "@/components/page-shell"
import { ListTitleCard } from "@/components/page-masthead"
import { buttonVariants } from "@/components/ui/button"
import { getSupabaseServer } from "@/lib/supabase"
import { formatRelative } from "@/lib/format"
import { CARD_CLASS, KPI_CARD_CLASS, TEXT_MUTED, TEXT_PRIMARY } from "@/lib/design"
import { DocContent } from "./doc-content"

export const dynamic = "force-dynamic"

export const metadata: Metadata = { title: "Docs" }

const DOCS_DIR = path.join(process.cwd(), "content", "docs")
const DEFAULT_DOC = "README"

// ---------------------------------------------------------------------------
// Authored markdown docs (read from content/docs at request time)
// ---------------------------------------------------------------------------

async function listDocs(): Promise<string[]> {
  try {
    const files = await fs.readdir(DOCS_DIR)
    const slugs = files.filter((f) => f.endsWith(".md")).map((f) => f.replace(/\.md$/, ""))
    // README/Overview first, then everything else in natural (numeric) order.
    return slugs.sort((a, b) => {
      if (a === "README") return -1
      if (b === "README") return 1
      return a.localeCompare(b, undefined, { numeric: true })
    })
  } catch {
    return []
  }
}

async function readDoc(slug: string): Promise<string | null> {
  // Guard against path traversal — only a bare slug is allowed.
  if (!/^[0-9A-Za-z_-]+$/.test(slug)) return null
  try {
    return await fs.readFile(path.join(DOCS_DIR, `${slug}.md`), "utf8")
  } catch {
    return null
  }
}

function docLabel(slug: string): string {
  if (slug === "README") return "Overview"
  const m = slug.match(/^(\d+)-(.+)$/)
  if (m) {
    const title = m[2].replace(/-/g, " ")
    return `${m[1]} · ${title.charAt(0).toUpperCase()}${title.slice(1)}`
  }
  return slug
}

// ---------------------------------------------------------------------------
// Live reference panels — generated from the running system, each fails soft
// ---------------------------------------------------------------------------

async function loadLiveViews(): Promise<string[] | null> {
  try {
    const sb = getSupabaseServer()
    const { data, error } = await sb.rpc("admin_catalog_views")
    if (error) return null
    return ((data ?? []) as { view_name: string }[]).map((r) => r.view_name)
  } catch {
    return null
  }
}

type TableInfo = { name: string; estRows: number | null; columns: { name: string; type: string }[] }

async function loadLiveTables(): Promise<TableInfo[] | null> {
  try {
    const sb = getSupabaseServer()
    const [tablesRes, colsRes] = await Promise.all([
      sb.rpc("admin_catalog_tables"),
      sb.rpc("admin_catalog_columns"),
    ])
    if (tablesRes.error || colsRes.error) return null
    const cols = (colsRes.data ?? []) as {
      table_name: string
      column_name: string
      data_type: string
    }[]
    const byTable = new Map<string, { name: string; type: string }[]>()
    for (const c of cols) {
      if (!byTable.has(c.table_name)) byTable.set(c.table_name, [])
      byTable.get(c.table_name)!.push({ name: c.column_name, type: c.data_type })
    }
    return ((tablesRes.data ?? []) as { table_name: string; est_rows: number | null }[]).map((t) => ({
      name: t.table_name,
      estRows: t.est_rows,
      columns: byTable.get(t.table_name) ?? [],
    }))
  } catch {
    return null
  }
}

type CronInfo = { path: string; schedule: string; utc: string; eastern: string }

const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]

function expandHours(field: string): number[] {
  if (field === "*") return Array.from({ length: 24 }, (_, i) => i)
  const out = new Set<number>()
  for (const part of field.split(",")) {
    const range = part.match(/^(\d+)-(\d+)$/)
    if (range) {
      for (let h = +range[1]; h <= +range[2]; h++) out.add(h)
    } else if (/^\d+$/.test(part)) {
      out.add(+part)
    }
  }
  return [...out].sort((a, b) => a - b)
}

function dowText(field: string): string {
  if (field === "*") return "daily"
  const m = field.match(/^(\d)-(\d)$/)
  if (m) return `${DOW[+m[1]]}–${DOW[+m[2]]}`
  if (/^\d$/.test(field)) return DOW[+field] ?? field
  return field
}

function hhmm(h: number, min: number): string {
  const hh = ((h % 24) + 24) % 24
  return `${String(hh).padStart(2, "0")}:${String(min).padStart(2, "0")}`
}

/** Best-effort plain-English UTC + Eastern (both DST offsets) for a cron line. */
function describeCron(schedule: string): { utc: string; eastern: string } {
  const [minField, hourField, , , dowField] = schedule.split(/\s+/)
  const dow = dowText(dowField ?? "*")
  const minStep = minField?.match(/^\*\/(\d+)$/)
  const minute = /^\d+$/.test(minField ?? "") ? +minField! : 0
  const hours = expandHours(hourField ?? "*")

  if (minStep) {
    const lo = hours[0]
    const hi = hours[hours.length - 1]
    return {
      utc: `Every ${minStep[1]} min, UTC ${hhmm(lo, 0)}–${hhmm(hi, 50)}, ${dow}`,
      eastern: `≈ ET ${hhmm(lo - 4, 0)}–${hhmm(hi - 4, 50)} (EDT) / ${hhmm(lo - 5, 0)}–${hhmm(hi - 5, 50)} (EST), ${dow}`,
    }
  }

  const utcTimes = hours.map((h) => hhmm(h, minute)).join(", ")
  const edt = hours.map((h) => hhmm(h - 4, minute)).join(", ")
  const est = hours.map((h) => hhmm(h - 5, minute)).join(", ")
  return {
    utc: `UTC ${utcTimes}, ${dow}`,
    eastern: `≈ ET ${edt} (EDT) / ${est} (EST), ${dow}`,
  }
}

async function loadSchedules(): Promise<CronInfo[] | null> {
  try {
    const raw = await fs.readFile(path.join(process.cwd(), "vercel.json"), "utf8")
    const parsed = JSON.parse(raw) as { crons?: { path: string; schedule: string }[] }
    const crons = parsed.crons ?? []
    if (crons.length === 0) return null
    return crons.map((c) => {
      const d = describeCron(c.schedule)
      return { path: c.path, schedule: c.schedule, utc: d.utc, eastern: d.eastern }
    })
  } catch {
    return null
  }
}

async function loadSyncStatus() {
  try {
    const sb = getSupabaseServer()
    const [runsRes, errRes] = await Promise.all([
      sb.from("sync_runs").select("entity_name, last_synced_at").order("entity_name"),
      sb.from("sync_errors").select("*", { count: "exact", head: true }),
    ])
    if (runsRes.error) return null
    const runs = (runsRes.data ?? []) as { entity_name: string; last_synced_at: string | null }[]
    const times = runs
      .map((r) => (r.last_synced_at ? new Date(r.last_synced_at).getTime() : NaN))
      .filter((t) => !Number.isNaN(t))
    const newest = times.length ? Math.max(...times) : null
    return { runs, newest, errorCount: errRes.error ? null : (errRes.count ?? 0) }
  } catch {
    return null
  }
}

async function loadEnvInventory(): Promise<{ name: string; set: boolean }[] | null> {
  try {
    const raw = await fs.readFile(path.join(process.cwd(), ".env.example"), "utf8")
    const names: string[] = []
    for (const line of raw.split(/\r?\n/)) {
      const m = line.match(/^([A-Z][A-Z0-9_]*)\s*=/)
      if (m && !names.includes(m[1])) names.push(m[1])
    }
    if (names.length === 0) return null
    return names.map((name) => ({ name, set: process.env[name] != null && process.env[name] !== "" }))
  } catch {
    return null
  }
}

// ---------------------------------------------------------------------------
// Small presentation helpers
// ---------------------------------------------------------------------------

function LivePanel({
  icon: Icon,
  title,
  children,
}: {
  icon: React.ComponentType<{ className?: string }>
  title: string
  children: React.ReactNode
}) {
  return (
    <div className={`flex flex-col p-4 ${KPI_CARD_CLASS}`}>
      <div className="mb-2 flex items-center gap-2">
        <Icon className="size-4 shrink-0 text-[#5B6472]" />
        <span className="text-sm font-medium" style={{ color: TEXT_PRIMARY }}>
          {title}
        </span>
        <span className="ml-auto rounded-full bg-[#E7F5EE] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-[#0E7C56]">
          Live
        </span>
      </div>
      <div className="min-h-0 flex-1 text-xs">{children}</div>
    </div>
  )
}

function Unavailable() {
  return <div className="text-sm text-muted-foreground">Unavailable</div>
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default async function DocsPage({
  searchParams,
}: {
  searchParams: Promise<{ doc?: string }>
}) {
  const sp = await searchParams
  const slugs = await listDocs()
  const selected = sp.doc && slugs.includes(sp.doc) ? sp.doc : slugs.includes(DEFAULT_DOC) ? DEFAULT_DOC : (slugs[0] ?? "")
  const markdown = selected ? await readDoc(selected) : null

  const [views, tables, schedules, sync, env] = await Promise.all([
    loadLiveViews(),
    loadLiveTables(),
    loadSchedules(),
    loadSyncStatus(),
    loadEnvInventory(),
  ])

  return (
    <PageShell title="Docs" hideHeader canvas>
      <div className="space-y-6">
        <ListTitleCard
          title="Documentation"
          subtitle="Authored guides for the dashboard, plus live reference panels generated from the running system"
          rightSlot={
            <Link href="/admin" className={buttonVariants({ variant: "outline", size: "sm" })}>
              ← Admin
            </Link>
          }
        />

        {/* ---- Rendered docs: left list + reading pane ---- */}
        <div className="grid gap-4 lg:grid-cols-[220px_minmax(0,1fr)]">
          {/* Left rail */}
          <nav className={`h-max p-2 lg:sticky lg:top-4 ${CARD_CLASS}`}>
            <div className="px-2 py-1.5 text-[11px] font-semibold uppercase tracking-wider" style={{ color: TEXT_MUTED }}>
              Documents
            </div>
            <ul className="space-y-0.5">
              {slugs.length === 0 ? (
                <li className="px-2 py-1.5 text-xs text-muted-foreground">No docs found.</li>
              ) : (
                slugs.map((slug) => {
                  const active = slug === selected
                  return (
                    <li key={slug}>
                      <Link
                        href={`/admin/docs?doc=${slug}`}
                        aria-current={active ? "page" : undefined}
                        className={`block rounded-md px-2 py-1.5 text-[13px] transition-colors ${
                          active
                            ? "bg-[#EEF2FB] font-medium text-[#1E2858]"
                            : "text-[#5B6472] hover:bg-[#F4F6F9] hover:text-[#1E2858]"
                        }`}
                      >
                        {docLabel(slug)}
                      </Link>
                    </li>
                  )
                })
              )}
            </ul>
          </nav>

          {/* Reading pane */}
          <article className={`min-w-0 px-6 py-5 ${CARD_CLASS}`}>
            {markdown ? (
              <DocContent markdown={markdown} />
            ) : (
              <div className="text-sm text-muted-foreground">
                {slugs.length === 0
                  ? "Documentation files could not be read from content/docs."
                  : "Select a document from the list."}
              </div>
            )}
          </article>
        </div>

        {/* ---- Live reference panels ---- */}
        <section>
          <div className="mb-1 flex items-center gap-2">
            <h2 className="text-xs font-semibold uppercase tracking-wider" style={{ color: TEXT_MUTED }}>
              Live reference
            </h2>
          </div>
          <p className="mb-3 text-xs" style={{ color: TEXT_MUTED }}>
            Generated from the current system at page load — always accurate, never authored by hand.
            A panel that can&apos;t load shows &quot;unavailable.&quot;
          </p>

          <div className="grid gap-3 md:grid-cols-2">
            {/* Views */}
            <LivePanel icon={Database} title={`Views${views ? ` (${views.length})` : ""}`}>
              {!views ? (
                <Unavailable />
              ) : (
                <div className="max-h-56 overflow-y-auto">
                  <ul className="grid grid-cols-1 gap-x-4 sm:grid-cols-2">
                    {views.map((v) => (
                      <li key={v} className="truncate font-mono text-[11.5px] text-[#26303F]" title={v}>
                        {v}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </LivePanel>

            {/* Tables & schema */}
            <LivePanel icon={Table2} title={`Tables & schema${tables ? ` (${tables.length})` : ""}`}>
              {!tables ? (
                <Unavailable />
              ) : (
                <div className="max-h-56 overflow-y-auto">
                  <ul className="space-y-0.5">
                    {tables.map((t) => (
                      <li key={t.name}>
                        <details>
                          <summary className="flex cursor-pointer items-center justify-between gap-2 rounded px-1 py-0.5 hover:bg-[#F4F6F9]">
                            <span className="truncate font-mono text-[11.5px] text-[#26303F]">{t.name}</span>
                            <span className="shrink-0 tabular-nums text-[11px]" style={{ color: TEXT_MUTED }}>
                              {t.estRows == null ? "≈ ?" : `≈ ${t.estRows.toLocaleString()}`} · {t.columns.length} cols
                            </span>
                          </summary>
                          <ul className="ml-3 mt-0.5 border-l border-[#EDEFF3] pl-3">
                            {t.columns.map((c) => (
                              <li key={c.name} className="flex items-center justify-between gap-2 py-px">
                                <span className="truncate font-mono text-[11px] text-[#3A4658]">{c.name}</span>
                                <span className="shrink-0 text-[10.5px]" style={{ color: TEXT_MUTED }}>
                                  {c.type}
                                </span>
                              </li>
                            ))}
                          </ul>
                        </details>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </LivePanel>

            {/* Schedules */}
            <LivePanel icon={CalendarClock} title={`Schedules${schedules ? ` (${schedules.length})` : ""}`}>
              {!schedules ? (
                <Unavailable />
              ) : (
                <div className="max-h-56 space-y-2 overflow-y-auto">
                  {schedules.map((c, i) => (
                    <div key={`${c.path}-${i}`} className="rounded border border-[#F1F3F7] p-2">
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate font-mono text-[11.5px] text-[#1E2858]">{c.path}</span>
                        <code className="shrink-0 rounded bg-[#F1F3F7] px-1 text-[10.5px] text-[#5B6472]">
                          {c.schedule}
                        </code>
                      </div>
                      <div className="mt-0.5 text-[11px]" style={{ color: TEXT_MUTED }}>
                        {c.utc}
                      </div>
                      <div className="text-[11px]" style={{ color: TEXT_MUTED }}>
                        {c.eastern}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </LivePanel>

            {/* Sync status */}
            <LivePanel icon={RefreshCw} title="Sync status">
              {!sync ? (
                <Unavailable />
              ) : (
                <>
                  <div className="mb-1 flex items-center justify-between gap-2">
                    <span style={{ color: TEXT_MUTED }}>Newest run</span>
                    <span className="font-medium" style={{ color: TEXT_PRIMARY }}>
                      {sync.newest ? formatRelative(new Date(sync.newest).toISOString()) : "never"}
                    </span>
                  </div>
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <span style={{ color: TEXT_MUTED }}>Sync errors logged</span>
                    <span className="font-medium tabular-nums" style={{ color: TEXT_PRIMARY }}>
                      {sync.errorCount == null ? "—" : sync.errorCount.toLocaleString()}
                    </span>
                  </div>
                  <div className="max-h-36 overflow-y-auto border-t border-[#F1F3F7] pt-1.5">
                    <ul className="space-y-0.5">
                      {sync.runs.map((r) => (
                        <li key={r.entity_name} className="flex items-center justify-between gap-2">
                          <span className="truncate font-mono text-[11px] text-[#26303F]">{r.entity_name}</span>
                          <span className="shrink-0 tabular-nums text-[11px]" style={{ color: TEXT_MUTED }}>
                            {r.last_synced_at ? formatRelative(r.last_synced_at) : "—"}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                </>
              )}
            </LivePanel>

            {/* Env inventory */}
            <LivePanel icon={KeyRound} title="Env inventory">
              {!env ? (
                <Unavailable />
              ) : (
                <div className="max-h-56 overflow-y-auto">
                  <ul className="space-y-0.5">
                    {env.map((e) => (
                      <li key={e.name} className="flex items-center justify-between gap-2">
                        <span className="truncate font-mono text-[11px] text-[#26303F]" title={e.name}>
                          {e.name}
                        </span>
                        <span
                          className={`shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${
                            e.set ? "bg-[#E7F5EE] text-[#0E7C56]" : "bg-[#F1F3F7] text-[#9AA1AD]"
                          }`}
                        >
                          {e.set ? "set" : "unset"}
                        </span>
                      </li>
                    ))}
                  </ul>
                  <p className="mt-2 text-[10.5px]" style={{ color: TEXT_MUTED }}>
                    Shows only whether each variable is set — never any value.
                  </p>
                </div>
              )}
            </LivePanel>

            {/* About panel */}
            <LivePanel icon={BookOpen} title="About these docs">
              <p style={{ color: TEXT_MUTED }}>
                The prose above is authored and version-controlled in{" "}
                <code className="rounded bg-[#F1F3F7] px-1 text-[11px]">dashboard/content/docs/</code>. The panels
                in this row are queried live from Postgres, <code className="rounded bg-[#F1F3F7] px-1 text-[11px]">vercel.json</code>, and the
                running environment. When prose and a live panel disagree, trust the panel and update the prose.
              </p>
            </LivePanel>
          </div>
        </section>
      </div>
    </PageShell>
  )
}
