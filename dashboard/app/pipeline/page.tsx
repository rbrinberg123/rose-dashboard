import { PageShell, PlaceholderBody } from "@/components/page-shell"

export default function PipelinePage() {
  return (
    <PageShell
      title="Pipeline (Next 30 Days)"
      description="Upcoming meetings by client and event"
    >
      <PlaceholderBody what="Pipeline view (v_pipeline_30d)" />
    </PageShell>
  )
}
