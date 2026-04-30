"use client"

import * as React from "react"
import { AnalystKpis } from "./analyst-kpis"
import { AnalystTable } from "./analyst-table"
import {
  QuarterSelector,
  currentQuarter,
  sortQuarters,
  type QuarterKey,
} from "@/components/quarter-selector"
import type { AnalystActivityRow } from "@/lib/types"

/**
 * Wraps KPI strip + table in a single client component so the year+quarter
 * selector can drive both. The page does one server-side fetch for all rows
 * and we filter in-memory here.
 */
export function AnalystView({ rows }: { rows: AnalystActivityRow[] }) {
  const quarterOptions = React.useMemo(() => {
    const seen = new Map<string, QuarterKey>()
    for (const r of rows) {
      const key = `${r.period_year}-${r.period_quarter}`
      if (!seen.has(key)) seen.set(key, { year: r.period_year, quarter: r.period_quarter })
    }
    return sortQuarters([...seen.values()])
  }, [rows])

  // Default to current quarter; if no rows match, fall back to the most
  // recent quarter that has data so the user sees something on first paint.
  const [selected, setSelected] = React.useState<QuarterKey>(() => {
    const cur = currentQuarter()
    const has = quarterOptions.some((q) => q.year === cur.year && q.quarter === cur.quarter)
    return has || quarterOptions.length === 0 ? cur : quarterOptions[0]
  })

  const filtered = React.useMemo(
    () => rows.filter((r) => r.period_year === selected.year && r.period_quarter === selected.quarter),
    [rows, selected],
  )

  return (
    <>
      <div className="mb-4 flex items-center gap-2">
        <span className="text-sm text-muted-foreground">Period</span>
        <QuarterSelector value={selected} options={quarterOptions} onChange={setSelected} />
      </div>
      <AnalystKpis rows={filtered} />
      <AnalystTable rows={filtered} />
    </>
  )
}
