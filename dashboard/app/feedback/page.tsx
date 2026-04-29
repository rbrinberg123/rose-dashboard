import { PageShell, PlaceholderBody } from "@/components/page-shell"

export default function FeedbackDisciplinePage() {
  return (
    <PageShell
      title="Feedback Discipline"
      description="Share of meetings with feedback collected"
    >
      <PlaceholderBody what="Feedback discipline (v_feedback_by_client / _analyst / _overall)" />
    </PageShell>
  )
}
