"use client"

import * as React from "react"
import { MarginKpis } from "./margin-kpis"
import { MarginTable } from "./margin-table"
import {
  QuarterSelector,
  currentQuarter,
  sortQuarters,
  type QuarterKey,
} from "@/components/quarter-selector"
import type { ClientQuarterlyPnlRow } from "@/lib/types"

/**
 * Year+quarter selector at top, defaulting to the current quarter (or the
 * latest with data if the current is empty). KPIs and the table both pull
 * from the rows filtered to the selected period.
 */
export function MarginView({ rows }: { rows: ClientQuarterlyPnlRow[] }) {
  const quarterOptions = React.useMemo(() => {
    const seen = new Map<string, QuarterKey>()
    for (const r of rows) {
      const key = `${r.period_year}-${r.period_quarter}`
      if (!seen.has(key)) seen.set(key, { year: r.period_year, quarter: r.period_quarter })
    }
    return sortQuarters([...seen.values()])
  }, [rows])

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
      <MarginKpis rows={filtered} />
      <MarginTable rows={filtered} />
    </>
  )
}
