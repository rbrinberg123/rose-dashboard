"use client"

import type { ProductivityAggregateRow } from "@/lib/types"
import { DateRangeControl } from "./date-range-control"
import { ProductivityTable } from "./productivity-table"

export function ProductivityView({
  from,
  to,
  rows,
}: {
  from: string
  to: string
  rows: ProductivityAggregateRow[]
}) {
  return (
    <>
      <DateRangeControl from={from} to={to} />
      <ProductivityTable rows={rows} />
    </>
  )
}
