import "server-only"

import type { SupabaseClient } from "@supabase/supabase-js"

import {
  computeClientHours,
  resolveWindow,
  type ClientIn,
  type HoursResult,
  type MeetingIn,
  type ReportIn,
  type WindowKey,
} from "./hours"

/**
 * Client Margin loader (Phase 1 — known hours). Read-only, server-side; the
 * page gates before calling it. Field mappings are in
 * content/docs/30-client-margin.md:
 *   - ACTIVE clients  = v_client_detail_summary (the app-wide active set),
 *                       minus accounts.is_test.
 *   - START DATE      = accounts.original_start_date (bcs_originalstartdate)
 *                       → earliest contracts.contract_start_date
 *                       → first meeting (v_client_detail_summary.client_since).
 *   - MEETINGS        = public.meetings by its DIRECT client_account_id,
 *                       meeting_date inside the window, is_test excluded.
 *   - FEEDBACK REPORTS = tasks with bcs_task_subtype_label 'Feedback' and
 *                       state 'Completed', client = bcs_account_id, dated by
 *                       actual_end (fallback modified_on) inside the window.
 */

const PAGE = 1000

async function pageAll<T>(
  build: (from: number, to: number) => PromiseLike<{ data: unknown[] | null; error: { message: string } | null }>,
): Promise<T[]> {
  const out: T[] = []
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await build(from, from + PAGE - 1)
    if (error) throw new Error(error.message)
    const page = (data ?? []) as T[]
    out.push(...page)
    if (page.length < PAGE) break
  }
  return out
}

export type ClientMarginData = HoursResult & {
  windowKey: WindowKey
  windowStart: string
  windowEnd: string
}

export async function loadClientMarginHours(
  sb: SupabaseClient,
  windowKey: WindowKey,
  now: Date = new Date(),
): Promise<ClientMarginData> {
  const window = resolveWindow(windowKey, now)
  const startIso = window.start.toISOString()
  const endIso = window.end.toISOString()

  const active = await pageAll<{ account_id: string; client_name: string; client_since: string | null }>(
    (a, b) =>
      sb
        .from("v_client_detail_summary")
        .select("account_id, client_name, client_since")
        .order("client_name", { ascending: true })
        .range(a, b),
  )
  const ids = active.map((c) => c.account_id)

  const [accounts, contracts, meetings, tasks] = await Promise.all([
    pageAll<{ account_id: string; original_start_date: string | null; is_test: boolean | null }>((a, b) =>
      sb.from("accounts").select("account_id, original_start_date, is_test").in("account_id", ids).range(a, b),
    ),
    pageAll<{ client_account_id: string; contract_start_date: string | null }>((a, b) =>
      sb
        .from("contracts")
        .select("client_account_id, contract_start_date")
        .in("client_account_id", ids)
        .not("contract_start_date", "is", null)
        .range(a, b),
    ),
    pageAll<MeetingIn>((a, b) =>
      sb
        .from("meetings")
        .select("client_account_id, meeting_date, meeting_type_label, is_in_person, meeting_status_label")
        .gte("meeting_date", startIso)
        .lt("meeting_date", endIso)
        .or("is_test.is.null,is_test.eq.false")
        .order("meeting_id", { ascending: true })
        .range(a, b),
    ),
    pageAll<{ bcs_account_id: string | null; actual_end: string | null; modified_on: string | null }>((a, b) =>
      sb
        .from("tasks")
        .select("bcs_account_id, actual_end, modified_on")
        .eq("bcs_task_subtype_label", "Feedback")
        .eq("state_label", "Completed")
        .or("is_test.is.null,is_test.eq.false")
        .order("task_id", { ascending: true })
        .range(a, b),
    ),
  ])

  const acct = new Map(accounts.map((a) => [a.account_id, a]))
  const earliestContract = new Map<string, string>()
  for (const c of contracts) {
    if (!c.contract_start_date) continue
    const prev = earliestContract.get(c.client_account_id)
    if (!prev || c.contract_start_date < prev) earliestContract.set(c.client_account_id, c.contract_start_date)
  }

  const clients: ClientIn[] = active
    .filter((c) => !acct.get(c.account_id)?.is_test)
    .map((c) => {
      const orig = acct.get(c.account_id)?.original_start_date ?? null
      const contract = earliestContract.get(c.account_id) ?? null
      const start = orig ?? contract ?? c.client_since ?? null
      return {
        account_id: c.account_id,
        client_name: c.client_name,
        start_date: start ? start.slice(0, 10) : null,
        start_source: orig ? "original_start_date" : contract ? "contract_start" : c.client_since ? "first_meeting" : null,
      }
    })

  const reports: ReportIn[] = tasks
    .filter((t) => {
      const d = Date.parse(t.actual_end ?? t.modified_on ?? "")
      return d >= window.start.getTime() && d < window.end.getTime()
    })
    .map((t) => ({ client_account_id: t.bcs_account_id }))

  const result = computeClientHours(clients, meetings, reports, window, now)
  return { ...result, windowKey, windowStart: startIso, windowEnd: endIso }
}
