import { getSupabaseServer } from "@/lib/supabase"
import type { ClientInstitutionRow } from "@/lib/types"

/** Supabase caps a single select at 1000 rows; the confirmed-meeting set is
 *  ~12.6k, so the read below pages through it. */
const PAGE = 1000

/**
 * Per-client institution breakdown — the rows behind Portfolio's # Intro / # F/U
 * drill-in. One entry per (client, institution) pair: the institution's name,
 * the client's most recent confirmed meeting with it, and how many confirmed
 * meetings the pair has had.
 *
 * MUST RECONCILE WITH THE COLUMNS. The predicate here is character-for-character
 * the one in v_client_portfolio's `client_institution` CTE:
 *
 *     meeting_status_label = 'Confirmed'
 *     AND client_account_id IS NOT NULL
 *     AND institution_name IS NOT NULL
 *
 * and, critically, **NO DATE FILTER** — the columns are all-time and deliberately
 * INCLUDE future-dated confirmed meetings (293 of the 12,599 confirmed rows are
 * in the future today). Adding any date bound here — even an intuitive "only
 * meetings that have happened" — would make the panel disagree with the number
 * the user just clicked. Because the CTE and this read share the predicate, the
 * arithmetic holds exactly:
 *
 *     rows returned for a client      === that client's # Intro
 *     SUM(meeting_count) for a client === # Intro + # F/U
 *
 * Verified against the live view for all 109 active clients.
 *
 * A consequence worth knowing: last_meeting_date is MAX over that same
 * unbounded set, so for a client with something already booked it can be a
 * FUTURE date. That is the honest answer for this window — narrowing it to the
 * past here would describe a different set of meetings than the count beside it.
 *
 * SCOPING: takes account ids the CALLER has already scope-checked — it does no
 * scoping of its own, matching loadConfirmedMeetingsByEvent (lib/event-meetings.ts).
 *
 * Fail-soft, also matching that loader: a query error yields an empty map rather
 * than throwing, so a drill-in that cannot load degrades to an empty panel
 * instead of blanking the page.
 */
export async function loadInstitutionBreakdownByClient(
  accountIds: readonly (string | null | undefined)[],
): Promise<Record<string, ClientInstitutionRow[]>> {
  const ids = Array.from(new Set(accountIds.filter((id): id is string => Boolean(id))))
  const byClient: Record<string, ClientInstitutionRow[]> = {}
  if (ids.length === 0) return byClient

  const sb = getSupabaseServer()

  // Accumulate per (client, institution) while paging, so a pair split across a
  // page boundary still lands in one entry.
  const pairs = new Map<string, Map<string, ClientInstitutionRow>>()
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await sb
      .from("meetings")
      .select("client_account_id, institution_name, meeting_date")
      .in("client_account_id", ids)
      .eq("meeting_status_label", "Confirmed")
      .range(from, from + PAGE - 1)
    if (error) return {} // fail soft — see the note above
    const rows = (data ?? []) as {
      client_account_id: string | null
      institution_name: string | null
      meeting_date: string | null
    }[]
    for (const r of rows) {
      if (!r.client_account_id || !r.institution_name) continue
      let forClient = pairs.get(r.client_account_id)
      if (!forClient) {
        forClient = new Map()
        pairs.set(r.client_account_id, forClient)
      }
      const existing = forClient.get(r.institution_name)
      if (existing) {
        existing.meeting_count += 1
        if (
          r.meeting_date &&
          (!existing.last_meeting_date || r.meeting_date > existing.last_meeting_date)
        ) {
          existing.last_meeting_date = r.meeting_date
        }
      } else {
        forClient.set(r.institution_name, {
          institution_name: r.institution_name,
          last_meeting_date: r.meeting_date,
          meeting_count: 1,
        })
      }
    }
    if (rows.length < PAGE) break
  }

  // Alphabetical by institution, done here so every caller gets one order.
  // localeCompare so accented and punctuated names sort where a reader expects
  // rather than by code point.
  for (const [clientId, forClient] of pairs) {
    byClient[clientId] = [...forClient.values()].sort((a, b) =>
      a.institution_name.localeCompare(b.institution_name),
    )
  }
  return byClient
}
