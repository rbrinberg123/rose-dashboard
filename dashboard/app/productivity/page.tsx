import type { Metadata } from "next"
import { PageShell } from "@/components/page-shell"
import { getSupabaseServer } from "@/lib/supabase"
import type {
  ProductivityAggregateRow,
  ProductivityPersonMeetingRow,
} from "@/lib/types"
import { ProductivityView } from "./productivity-view"

export const dynamic = "force-dynamic"

export const metadata: Metadata = { title: "Productivity" }

const YMD = /^\d{4}-\d{2}-\d{2}$/

function isValidYmd(s: string): boolean {
  if (!YMD.test(s)) return false
  const d = new Date(`${s}T00:00:00Z`)
  return !Number.isNaN(d.getTime()) && s === d.toISOString().slice(0, 10)
}

function ymdUtc(d: Date): string {
  return d.toISOString().slice(0, 10)
}

function defaultRange(): { from: string; to: string } {
  const today = new Date()
  const start = new Date(today)
  start.setUTCDate(start.getUTCDate() - 365)
  return { from: ymdUtc(start), to: ymdUtc(today) }
}

function aggregate(rows: ProductivityPersonMeetingRow[]): ProductivityAggregateRow[] {
  type HostFlags = { in_person: boolean; feedback: boolean }
  type Acc = {
    user_id: string
    display_name: string | null
    booked: number
    laborCost: number
    hostKeyed: Map<string, HostFlags>
  }

  const byUser = new Map<string, Acc>()

  for (const r of rows) {
    let acc = byUser.get(r.user_id)
    if (!acc) {
      acc = {
        user_id: r.user_id,
        display_name: r.display_name,
        booked: 0,
        laborCost: 0,
        hostKeyed: new Map(),
      }
      byUser.set(r.user_id, acc)
    }
    if (acc.display_name == null && r.display_name != null) {
      acc.display_name = r.display_name
    }
    acc.laborCost += Number(r.attributed_cost ?? 0)

    if (r.role === "booker") {
      acc.booked += 1
      continue
    }

    if (r.meeting_status_label !== "Confirmed") continue

    const key = r.group_meeting
      ? `g|${r.client_account_id ?? "NULL"}|${r.meeting_date}`
      : `m|${r.meeting_id}`
    const existing = acc.hostKeyed.get(key)
    const isFeedback = r.feedback_status_label === "Closed - All in"
    if (existing) {
      // Collapse: keep first row's in_person, OR feedback (any closed counts).
      if (isFeedback) existing.feedback = true
    } else {
      acc.hostKeyed.set(key, { in_person: r.is_in_person, feedback: isFeedback })
    }
  }

  const out: ProductivityAggregateRow[] = []
  for (const acc of byUser.values()) {
    let inPerson = 0
    let virtual = 0
    let feedback = 0
    for (const v of acc.hostKeyed.values()) {
      if (v.in_person) inPerson += 1
      else virtual += 1
      if (v.feedback) feedback += 1
    }
    const hosted = acc.hostKeyed.size
    out.push({
      user_id: acc.user_id,
      display_name: acc.display_name,
      booked: acc.booked,
      hosted,
      in_person_hosted: inPerson,
      virtual_hosted: virtual,
      feedback,
      feedback_rate: hosted > 0 ? feedback / hosted : null,
      labor_cost: acc.laborCost,
    })
  }
  return out
}

export default async function ProductivityPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string }>
}) {
  const sp = await searchParams
  const def = defaultRange()
  const rawFrom = typeof sp.from === "string" ? sp.from : ""
  const rawTo = typeof sp.to === "string" ? sp.to : ""
  let from = isValidYmd(rawFrom) ? rawFrom : def.from
  let to = isValidYmd(rawTo) ? rawTo : def.to
  if (from > to) {
    // Reorder rather than discard so a shared link with swapped dates still works.
    const tmp = from
    from = to
    to = tmp
  }

  const sb = getSupabaseServer()
  // Supabase / PostgREST caps a single response at db-max-rows (1,000 by
  // default on Supabase Cloud). v_productivity_person_meeting returns up to
  // ~2 rows per meeting, so a year's range easily exceeds the cap. Paginate
  // to make sure we get every row regardless of the project's setting.
  const PAGE_SIZE = 1000
  const personMeetingRows: ProductivityPersonMeetingRow[] = []
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const { data, error } = await sb
      .from("v_productivity_person_meeting")
      .select("*")
      .gte("meeting_date", from)
      .lte("meeting_date", to)
      .order("meeting_id", { ascending: true })
      .range(offset, offset + PAGE_SIZE - 1)

    if (error) {
      return (
        <PageShell title="Productivity" description="Activity by person over a date range">
          <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm">
            <div className="font-medium text-destructive">
              Could not load v_productivity_person_meeting
            </div>
            <div className="mt-1 text-muted-foreground">{error.message}</div>
          </div>
        </PageShell>
      )
    }

    const page = (data ?? []) as ProductivityPersonMeetingRow[]
    personMeetingRows.push(...page)
    if (page.length < PAGE_SIZE) break
  }

  // Temporary diagnostic — shows up in the dev-server terminal. Lets us
  // confirm pagination is doing its job and that the data shape matches
  // what aggregate() expects. Remove once the page is verified working.
  if (process.env.NODE_ENV !== "production") {
    let bookerRows = 0
    let hostRows = 0
    let hostConfirmed = 0
    for (const r of personMeetingRows) {
      if (r.role === "booker") bookerRows += 1
      else if (r.role === "host") {
        hostRows += 1
        if (r.meeting_status_label === "Confirmed") hostConfirmed += 1
      }
    }
    // eslint-disable-next-line no-console
    console.log(
      `[productivity] ${from}..${to} total=${personMeetingRows.length} booker=${bookerRows} host=${hostRows} host_confirmed=${hostConfirmed} sample=${JSON.stringify(personMeetingRows[0] ?? null)}`,
    )
  }

  const rows = aggregate(personMeetingRows)

  return (
    <PageShell title="Productivity" description="Activity by person over a date range">
      <ProductivityView from={from} to={to} rows={rows} />
    </PageShell>
  )
}
