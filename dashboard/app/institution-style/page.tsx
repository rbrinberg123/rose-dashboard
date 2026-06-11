import type { Metadata } from "next"
import { PageShell } from "@/components/page-shell"
import { getSupabaseServer } from "@/lib/supabase"
import type {
  ActiveClientOption,
  InstitutionStyleMeetingRow,
} from "@/lib/types"
import { InstitutionStyleView } from "./institution-style-view"

export const dynamic = "force-dynamic"

export const metadata: Metadata = { title: "Institution Style/Set Finder" }

export default async function InstitutionStylePage() {
  const sb = getSupabaseServer()

  // The meeting-grain set can run to ~10k rows. PostgREST caps a single
  // response at db-max-rows (1,000 by default on Supabase Cloud), so we
  // paginate to make sure every row comes back regardless of project setting.
  const PAGE_SIZE = 1000
  const meetingRows: InstitutionStyleMeetingRow[] = []
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const { data, error } = await sb
      .from("v_institution_style_meetings")
      .select("*")
      .order("institution_name", { ascending: true })
      .range(offset, offset + PAGE_SIZE - 1)

    if (error) {
      return (
        <PageShell title="Institution Style/Set Finder">
          <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm">
            <div className="font-medium text-destructive">
              Could not load v_institution_style_meetings
            </div>
            <div className="mt-1 text-muted-foreground">{error.message}</div>
          </div>
        </PageShell>
      )
    }

    const page = (data ?? []) as InstitutionStyleMeetingRow[]
    meetingRows.push(...page)
    if (page.length < PAGE_SIZE) break
  }

  const clientsRes = await sb
    .from("accounts")
    .select("account_id, name")
    .eq("state_label", "Active")
    .order("name", { ascending: true })

  if (clientsRes.error) {
    return (
      <PageShell title="Institution Style/Set Finder">
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm">
          <div className="font-medium text-destructive">
            Could not load active client list
          </div>
          <div className="mt-1 text-muted-foreground">{clientsRes.error.message}</div>
        </div>
      </PageShell>
    )
  }

  const clients = (clientsRes.data ?? []) as ActiveClientOption[]

  return (
    <PageShell title="Institution Style/Set Finder">
      <InstitutionStyleView meetings={meetingRows} clients={clients} />
    </PageShell>
  )
}
