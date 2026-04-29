import { PageShell, PlaceholderBody } from "@/components/page-shell"

export default function MarginPage() {
  return (
    <PageShell
      title="Margin by Client"
      description="Revenue minus labor, direct costs, and overhead"
    >
      <PlaceholderBody what="Quarterly margin view (v_client_quarterly_pnl) — depends on admin data" />
    </PageShell>
  )
}
