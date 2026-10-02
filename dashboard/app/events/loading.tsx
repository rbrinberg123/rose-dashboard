import { TablePageSkeleton } from "@/components/loading-skeletons"

/**
 * Shown the instant a CRM link is clicked, while the server builds the page —
 * so the click responds immediately instead of the old page sitting frozen.
 * Next.js also prefetches up to this boundary, so it usually paints at once.
 */
export default function Loading() {
  return <TablePageSkeleton title="Events" kpis={0} columns={10} rows={12} />
}
