import type { Metadata } from "next"
import { PageShell } from "@/components/page-shell"
import { getSupabaseServer } from "@/lib/supabase"
import type { FeedbackOutstandingRow } from "@/lib/types"
import { FeedbackView } from "./feedback-view"

export const dynamic = "force-dynamic"

export const metadata: Metadata = { title: "Feedback" }

export default async function FeedbackPage() {
  const sb = getSupabaseServer()

  // The outstanding set is small (concluded confirmed meetings still missing
  // complete feedback), so a single fetch is enough. We still loop in
  // PAGE_SIZE chunks as a guard in case it ever grows past PostgREST's
  // db-max-rows cap (1,000 by default on Supabase Cloud).
  const PAGE_SIZE = 1000
  const rows: FeedbackOutstandingRow[] = []
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const { data, error } = await sb
      .from("v_feedback_outstanding")
      .select("*")
      .order("days_since", { ascending: false })
      .range(offset, offset + PAGE_SIZE - 1)

    if (error) {
      return (
        <PageShell title="Feedback">
          <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm">
            <div className="font-medium text-destructive">
              Could not load v_feedback_outstanding
            </div>
            <div className="mt-1 text-muted-foreground">{error.message}</div>
          </div>
        </PageShell>
      )
    }

    const page = (data ?? []) as FeedbackOutstandingRow[]
    rows.push(...page)
    if (page.length < PAGE_SIZE) break
  }

  return (
    <PageShell title="Feedback">
      <FeedbackView rows={rows} />
    </PageShell>
  )
}
