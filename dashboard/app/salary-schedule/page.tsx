import { PageShell, PlaceholderBody } from "@/components/page-shell"

export default function SalarySchedulePage() {
  return (
    <PageShell
      title="Salary Schedule"
      description="Compensation history per staff member"
    >
      <PlaceholderBody what="Salary CRUD with non-overlapping periods (salary_schedule)" />
    </PageShell>
  )
}
