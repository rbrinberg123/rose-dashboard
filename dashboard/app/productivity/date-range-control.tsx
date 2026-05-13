"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { CalendarIcon } from "lucide-react"
import { Calendar } from "@/components/ui/calendar"
import { Button } from "@/components/ui/button"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { formatDate } from "@/lib/format"

type Preset = "last30" | "last90" | "ytd" | "ltm" | "last24" | "custom"

const PRESET_LABELS: Record<Preset, string> = {
  last30: "Last 30 days",
  last90: "Last 90 days",
  ytd: "Year to date",
  ltm: "Last 12 months",
  last24: "Last 24 months",
  custom: "Custom range",
}

function ymd(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, "0")
  const day = String(d.getDate()).padStart(2, "0")
  return `${y}-${m}-${day}`
}

function parseYmd(s: string): Date | undefined {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return undefined
  const [y, m, d] = s.split("-").map(Number)
  const dt = new Date(y, m - 1, d)
  if (Number.isNaN(dt.getTime())) return undefined
  return dt
}

/** Build the from/to YYYY-MM-DD pair for each non-custom preset, using local time. */
function presetRange(preset: Exclude<Preset, "custom">): { from: string; to: string } {
  const today = new Date()
  const to = ymd(today)
  if (preset === "ytd") {
    const start = new Date(today.getFullYear(), 0, 1)
    return { from: ymd(start), to }
  }
  const days = preset === "last30" ? 30 : preset === "last90" ? 90 : preset === "ltm" ? 365 : 730
  const start = new Date(today)
  start.setDate(start.getDate() - days)
  return { from: ymd(start), to }
}

/** Identify which preset (if any) the current from/to match. */
function detectPreset(from: string, to: string): Preset {
  const candidates: Exclude<Preset, "custom">[] = ["last30", "last90", "ytd", "ltm", "last24"]
  for (const p of candidates) {
    const r = presetRange(p)
    if (r.from === from && r.to === to) return p
  }
  return "custom"
}

export function DateRangeControl({ from, to }: { from: string; to: string }) {
  const router = useRouter()
  const [pending, startTransition] = React.useTransition()

  // Local working state for the custom date pickers — only applied when the
  // user clicks Apply, so they can change one half without an intermediate
  // round-trip to the server.
  const detected = detectPreset(from, to)
  const [preset, setPreset] = React.useState<Preset>(detected)
  const [customFrom, setCustomFrom] = React.useState<string>(from)
  const [customTo, setCustomTo] = React.useState<string>(to)

  // If the URL changes (e.g. a preset push completes), re-sync local state.
  React.useEffect(() => {
    setPreset(detected)
    setCustomFrom(from)
    setCustomTo(to)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [from, to])

  const pushRange = React.useCallback(
    (nextFrom: string, nextTo: string) => {
      startTransition(() => {
        router.push(`/productivity?from=${nextFrom}&to=${nextTo}`)
      })
    },
    [router],
  )

  function handlePresetChange(next: Preset) {
    setPreset(next)
    if (next === "custom") return
    const r = presetRange(next)
    pushRange(r.from, r.to)
  }

  function applyCustom() {
    if (!customFrom || !customTo) return
    const lo = customFrom <= customTo ? customFrom : customTo
    const hi = customFrom <= customTo ? customTo : customFrom
    pushRange(lo, hi)
  }

  const fromDate = parseYmd(customFrom)
  const toDate = parseYmd(customTo)

  return (
    <div className="mb-4 flex flex-wrap items-center gap-2">
      <span className="text-sm text-muted-foreground">Date range</span>
      <Select value={preset} onValueChange={(v) => handlePresetChange(v as Preset)}>
        <SelectTrigger className="w-48">
          <SelectValue placeholder="Select range" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="last30">{PRESET_LABELS.last30}</SelectItem>
          <SelectItem value="last90">{PRESET_LABELS.last90}</SelectItem>
          <SelectItem value="ytd">{PRESET_LABELS.ytd}</SelectItem>
          <SelectItem value="ltm">{PRESET_LABELS.ltm}</SelectItem>
          <SelectItem value="last24">{PRESET_LABELS.last24}</SelectItem>
          <SelectItem value="custom">{PRESET_LABELS.custom}</SelectItem>
        </SelectContent>
      </Select>

      {preset === "custom" ? (
        <>
          <DatePopover
            label="Start"
            valueYmd={customFrom}
            date={fromDate}
            onChange={(d) => setCustomFrom(ymd(d))}
          />
          <DatePopover
            label="End"
            valueYmd={customTo}
            date={toDate}
            onChange={(d) => setCustomTo(ymd(d))}
          />
          <Button
            size="sm"
            onClick={applyCustom}
            disabled={pending || !customFrom || !customTo || customFrom === from && customTo === to}
          >
            Apply
          </Button>
        </>
      ) : (
        <span className="text-xs text-muted-foreground tabular-nums">
          {formatDate(from)} – {formatDate(to)}
        </span>
      )}
    </div>
  )
}

function DatePopover({
  label,
  valueYmd,
  date,
  onChange,
}: {
  label: string
  valueYmd: string
  date: Date | undefined
  onChange: (d: Date) => void
}) {
  const [open, setOpen] = React.useState(false)
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button variant="outline" size="sm">
            <CalendarIcon />
            <span className="tabular-nums">
              {label}: {valueYmd ? formatDate(valueYmd) : "—"}
            </span>
          </Button>
        }
      />
      <PopoverContent className="w-auto p-0" align="start">
        <Calendar
          mode="single"
          selected={date}
          defaultMonth={date}
          onSelect={(d) => {
            if (!d) return
            onChange(d)
            setOpen(false)
          }}
        />
      </PopoverContent>
    </Popover>
  )
}
