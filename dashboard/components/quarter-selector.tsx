"use client"

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { formatQuarter } from "@/lib/format"

export type QuarterKey = { year: number; quarter: number }

/** Sort newest first; identical (year, quarter) gets dedup'd by the caller. */
export function sortQuarters(qs: QuarterKey[]): QuarterKey[] {
  return [...qs].sort((a, b) => {
    if (a.year !== b.year) return b.year - a.year
    return b.quarter - a.quarter
  })
}

/** Compute the (year, quarter) for today's date; matches Postgres EXTRACT. */
export function currentQuarter(): QuarterKey {
  const now = new Date()
  return { year: now.getFullYear(), quarter: Math.floor(now.getMonth() / 3) + 1 }
}

function quarterToValue(q: QuarterKey): string {
  return `${q.year}-${q.quarter}`
}

function valueToQuarter(v: string): QuarterKey {
  const [y, q] = v.split("-").map(Number)
  return { year: y, quarter: q }
}

export function QuarterSelector({
  value,
  options,
  onChange,
  className,
}: {
  value: QuarterKey
  options: QuarterKey[]
  onChange: (next: QuarterKey) => void
  className?: string
}) {
  return (
    <Select
      value={quarterToValue(value)}
      onValueChange={(v) => { if (v) onChange(valueToQuarter(v)) }}
    >
      <SelectTrigger className={className ?? "w-36"}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map((q) => (
          <SelectItem key={quarterToValue(q)} value={quarterToValue(q)}>
            {formatQuarter(q.year, q.quarter)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
