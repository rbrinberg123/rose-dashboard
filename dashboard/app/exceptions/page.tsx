import { PageShell, PlaceholderBody } from "@/components/page-shell"

export default function ExceptionsPage() {
  return (
    <PageShell
      title="Exception Report"
      description="Data-quality issues affecting the cost model"
    >
      <PlaceholderBody what="Five sections of cost-model exceptions (read-only)" />
    </PageShell>
  )
}
