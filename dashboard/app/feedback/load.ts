import { getSupabaseServer } from "@/lib/supabase"
import type { FeedbackOutstandingRow } from "@/lib/types"

/**
 * Load every outstanding-feedback row from v_feedback_outstanding (concluded
 * confirmed meetings still missing complete feedback). Shared by the /feedback
 * page and the digest send route so both render from the exact same query.
 *
 * The set is small, but we still page in PAGE_SIZE chunks as a guard against
 * PostgREST's db-max-rows cap (1,000 by default on Supabase Cloud). Ordering
 * mirrors the page: days_since desc, with meeting_id as a stable tiebreaker so
 * pagination can't drop/duplicate rows. (The email template re-groups by person
 * and re-sorts by meeting_date on top of this; Stage 2 will settle the canonical
 * DB-side ordering here.)
 */
export async function loadFeedbackOutstandingRows(): Promise<{
  rows: FeedbackOutstandingRow[]
  error: string | null
}> {
  const sb = getSupabaseServer()
  const PAGE_SIZE = 1000
  const rows: FeedbackOutstandingRow[] = []
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const { data, error } = await sb
      .from("v_feedback_outstanding")
      .select("*")
      .order("days_since", { ascending: false })
      .order("meeting_id", { ascending: true })
      .range(offset, offset + PAGE_SIZE - 1)

    if (error) return { rows: [], error: error.message }

    const page = (data ?? []) as FeedbackOutstandingRow[]
    rows.push(...page)
    if (page.length < PAGE_SIZE) break
  }
  return { rows, error: null }
}
