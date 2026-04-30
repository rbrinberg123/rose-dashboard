import type { Metadata } from "next"
import { PageShell } from "@/components/page-shell"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { getSupabaseServer } from "@/lib/supabase"
import type {
  FeedbackOverallRow,
  FeedbackByClientRow,
  FeedbackByAnalystRow,
} from "@/lib/types"
import { FeedbackKpis } from "./feedback-kpis"
import { FeedbackTrend } from "./feedback-trend"
import { FeedbackByClientTable } from "./feedback-by-client-table"
import { FeedbackByAnalystTable } from "./feedback-by-analyst-table"

export const dynamic = "force-dynamic"

export const metadata: Metadata = { title: "Feedback Discipline" }

export default async function FeedbackDisciplinePage() {
  const sb = getSupabaseServer()

  // Three reads in parallel — each tab gets its own view, and the page
  // renders all of them up front (tabs swap content, not data fetches).
  const [overallRes, byClientRes, byAnalystRes] = await Promise.all([
    sb.from("v_feedback_overall").select("*"),
    sb.from("v_feedback_by_client").select("*"),
    sb.from("v_feedback_by_analyst").select("*"),
  ])

  const firstError = overallRes.error ?? byClientRes.error ?? byAnalystRes.error
  if (firstError) {
    return (
      <PageShell title="Feedback Discipline" description="Are we collecting feedback on the meetings we host?">
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm">
          <div className="font-medium text-destructive">Could not load feedback views</div>
          <div className="mt-1 text-muted-foreground">{firstError.message}</div>
        </div>
      </PageShell>
    )
  }

  const overall = (overallRes.data ?? []) as FeedbackOverallRow[]
  const byClient = (byClientRes.data ?? []) as FeedbackByClientRow[]
  const byAnalyst = (byAnalystRes.data ?? []) as FeedbackByAnalystRow[]

  return (
    <PageShell
      title="Feedback Discipline"
      description="Are we collecting feedback on the meetings we host?"
    >
      <Tabs defaultValue="overall" className="w-full">
        <TabsList>
          <TabsTrigger value="overall">Overall</TabsTrigger>
          <TabsTrigger value="by-client">By Client</TabsTrigger>
          <TabsTrigger value="by-analyst">By Analyst</TabsTrigger>
        </TabsList>

        <TabsContent value="overall" className="pt-4">
          <FeedbackKpis rows={overall} />
          <FeedbackTrend rows={overall} />
        </TabsContent>

        <TabsContent value="by-client" className="pt-4">
          <FeedbackByClientTable rows={byClient} />
        </TabsContent>

        <TabsContent value="by-analyst" className="pt-4">
          <FeedbackByAnalystTable rows={byAnalyst} />
        </TabsContent>
      </Tabs>
    </PageShell>
  )
}
