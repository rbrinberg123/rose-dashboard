import type { Metadata } from "next"
import { PageShell } from "@/components/page-shell"
import { getSupabaseServer } from "@/lib/supabase"
import type { RelationshipRow } from "@/lib/types"
import { RelationshipsView } from "./relationships-view"

export const dynamic = "force-dynamic"

export const metadata: Metadata = { title: "Relationships" }

export default async function RelationshipsPage() {
  const sb = getSupabaseServer()

  // ~1,500 institutions — above the PostgREST 1,000-row cap, so widen the range
  // (same approach as the Institution Summary page).
  const res = await sb
    .from("v_relationships")
    .select("*")
    .order("institution_name", { ascending: true })
    .range(0, 9999)

  if (res.error) {
    return (
      <PageShell title="Relationships">
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm">
          <div className="font-medium text-destructive">Could not load v_relationships</div>
          <div className="mt-1 text-muted-foreground">{res.error.message}</div>
        </div>
      </PageShell>
    )
  }

  const rows = (res.data ?? []) as RelationshipRow[]

  return (
    <PageShell title="Relationships" hideHeader canvas>
      <RelationshipsView rows={rows} />
    </PageShell>
  )
}
