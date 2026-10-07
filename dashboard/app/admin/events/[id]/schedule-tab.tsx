"use client"

/**
 * Schedule tab — the main workspace.
 *   - Day strip: one chip per day (date, city, meetings), add / edit days.
 *   - Availability blocks: bookable windows drawn as dashed, tinted bands
 *     behind the timeline, each with its capacity readout and "Book meeting"
 *     (snaps a meeting into the next free slot, inheriting host + location).
 *   - Timeline: the selected day, 07:00–22:00 by default (extends to fit),
 *     blocks sized by duration, overlaps side by side. Or a dense list view.
 *   - "+ Add travel" between back-to-back blocks at different places.
 *   - Add item → the right-hand panel, pre-filled with the next free slot.
 *   - Clicking a Schedule-health issue lands here on its day / item / block.
 *
 * Hand-built (no calendar / drag-drop library), like the Calendar page, so
 * nothing heavy reaches any bundle. Colours are the app's IQ tokens.
 */

import * as React from "react"
import {
  BedDouble,
  CalendarPlus,
  Car,
  Coffee,
  Footprints,
  MoreHorizontal,
  Plane,
  Plus,
  Presentation,
  TrainFront,
  Utensils,
  Users,
} from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { SegmentedToggle } from "@/components/segmented-toggle"
import {
  BRAND_BLUE,
  BRAND_NAVY,
  CARD_CLASS,
  DEEP_TEAL,
  STATUS_PILL_LIGHT,
  TEAL,
  TEXT_MUTED,
  TEXT_PRIMARY,
} from "@/lib/design"
import {
  DEFAULT_ITEM_MINUTES,
  HOME_TZ,
  ITEM_TYPES,
  ITEM_TYPE_LABEL,
  TRAVEL_MODE_LABEL,
  blockCapacity,
  blockName,
  capacityText,
  differsFromHome,
  dualTime,
  formatDay,
  formatTime,
  layoutLanes,
  locationLabel,
  minutesIntoDay,
  nextFreeSlot,
  nextSlotInBlock,
  travelGaps,
  travelSlot,
  zoneAbbrev,
  type ItemType,
  type TravelMode,
} from "@/lib/events-planner/core"
import type { BuilderBlock, BuilderDay, BuilderItem } from "@/lib/events-planner/types"
import { useBuilder } from "./builder-context"
import { BlockPanel, newBlockDraft, type BlockTarget } from "./block-panel"
import { DayDialog, type DayDialogTarget } from "./day-dialog"
import { ItemPanel, emptyTravel, newDraft, zoneLabel, type PanelTarget } from "./item-panel"

const HOUR_PX = 56
const DEFAULT_FROM = 7 * 60
const DEFAULT_TO = 22 * 60
/** Room on the right of the timeline for block labels / capacity, when a day has blocks. */
const BAND_INFO_PX = 200

/** Availability-block band tint — a light IQ teal, distinct from every item colour. */
const BAND_BG = `color-mix(in srgb, ${TEAL} 7%, white)`
const BAND_BORDER = `color-mix(in srgb, ${TEAL} 55%, white)`

/** Block colours by type — IQ palette only. */
function blockStyle(type: string): { bg: string; fg: string; border: string } {
  switch (type) {
    case "meeting":
      return { bg: BRAND_BLUE, fg: "#FFFFFF", border: BRAND_BLUE }
    case "presentation":
      return { bg: BRAND_NAVY, fg: "#FFFFFF", border: BRAND_NAVY }
    case "travel":
      return { bg: STATUS_PILL_LIGHT.new.bg, fg: STATUS_PILL_LIGHT.new.text, border: "#C9D6F0" }
    case "hotel":
    case "meal":
    case "break":
      return { bg: STATUS_PILL_LIGHT.neutral.bg, fg: STATUS_PILL_LIGHT.neutral.text, border: "#DCE0E8" }
    default:
      return { bg: "#FFFFFF", fg: TEXT_PRIMARY, border: "#D5DAE3" }
  }
}

function TypeIcon({ item, className }: { item: BuilderItem; className?: string }) {
  const c = className ?? "size-3.5 shrink-0"
  if (item.item_type === "travel") {
    const m = item.travel?.mode
    if (m === "flight") return <Plane className={c} />
    if (m === "train") return <TrainFront className={c} />
    if (m === "walk") return <Footprints className={c} />
    return <Car className={c} />
  }
  if (item.item_type === "hotel") return <BedDouble className={c} />
  if (item.item_type === "meal") return <Utensils className={c} />
  if (item.item_type === "break") return <Coffee className={c} />
  if (item.item_type === "presentation") return <Presentation className={c} />
  return null
}

const durationMin = (i: BuilderItem) => Math.round((Date.parse(i.end_at) - Date.parse(i.start_at)) / 60_000)

/** The one-line detail under a block's title. */
function detailLine(i: BuilderItem, meetingTypeName: string | null): string {
  if (i.item_type === "travel") {
    const mode = TRAVEL_MODE_LABEL[(i.travel?.mode ?? "other") as TravelMode] ?? "Travel"
    const extra = i.travel?.flight_or_train_number ?? i.travel?.driver_name ?? null
    const est = i.travel?.duration_source === "estimated" ? "est." : null
    return [`${durationMin(i)} min`, est, mode, extra].filter(Boolean).join(" · ")
  }
  if (i.item_type === "meeting") {
    return [
      i.institution_name && i.institution_name !== i.title ? i.institution_name : null,
      meetingTypeName,
      i.attendee_ids.length ? `${i.attendee_ids.length} attending` : null,
    ]
      .filter(Boolean)
      .join(" · ")
  }
  return locationLabel(i) ?? ""
}

/** Start → end; a flight landing in another zone shows its arrival on that clock. */
function timeRange(i: BuilderItem): string {
  const arrTz = i.travel?.to_timezone && i.travel.to_timezone !== i.timezone ? i.travel.to_timezone : null
  if (arrTz)
    return `${formatTime(i.start_at, i.timezone)} ${zoneAbbrev(i.start_at, i.timezone)} → ${formatTime(i.end_at, arrTz)} ${zoneAbbrev(i.end_at, arrTz)}`
  const local = `${formatTime(i.start_at, i.timezone)} – ${formatTime(i.end_at, i.timezone)}`
  if (!differsFromHome(i.start_at, i.timezone)) return local
  return `${local} ${zoneAbbrev(i.start_at, i.timezone)} · ${formatTime(i.start_at, HOME_TZ)} ET`
}

const blockTimes = (b: BuilderBlock) => `${formatTime(b.start_at, b.timezone)}–${formatTime(b.end_at, b.timezone)}`

export function ScheduleTab() {
  const { itin, meetingTypes, readOnly, focus } = useBuilder()
  const [dayId, setDayId] = React.useState(itin.days[0]?.id ?? "")
  const [view, setView] = React.useState<"timeline" | "list">("timeline")
  const [showCancelled, setShowCancelled] = React.useState(false)
  const [panel, setPanel] = React.useState<PanelTarget>(null)
  const [blockPanel, setBlockPanel] = React.useState<BlockTarget>(null)
  const [selectedId, setSelectedId] = React.useState<string | null>(null)
  const [dayDialog, setDayDialog] = React.useState<DayDialogTarget>(null)
  const [addOpen, setAddOpen] = React.useState(false)

  // Jump-to from Schedule health: land on the issue's day and open it.
  const [seenFocus, setSeenFocus] = React.useState(focus?.seq ?? 0)
  if (focus && focus.seq !== seenFocus) {
    setSeenFocus(focus.seq)
    if (focus.dayId) setDayId(focus.dayId)
    if (focus.itemId) {
      setSelectedId(focus.itemId)
      setBlockPanel(null)
      setPanel({ kind: "edit", itemId: focus.itemId })
      if (itin.items.find((i) => i.id === focus.itemId)?.status === "cancelled") setShowCancelled(true)
    } else if (focus.blockId) {
      setPanel(null)
      setBlockPanel({ kind: "edit", blockId: focus.blockId })
    }
  }

  const day = itin.days.find((d) => d.id === dayId) ?? itin.days[0]
  const mtName = React.useCallback((id: string | null) => meetingTypes.find((m) => m.id === id)?.name ?? null, [meetingTypes])

  if (!day) {
    return (
      <div className={`${CARD_CLASS} px-6 py-10 text-center text-sm text-muted-foreground`}>
        This itinerary has no days.{" "}
        {!readOnly && (
          <button className="underline" onClick={() => setDayDialog({ kind: "add", date: itin.start_date, timezone: HOME_TZ })}>
            Add one
          </button>
        )}
        <DayDialog target={dayDialog} onClose={() => setDayDialog(null)} onSelect={setDayId} />
      </div>
    )
  }

  const dayItems = itin.items.filter((i) => i.day_id === day.id)
  const dayBlocks = itin.blocks.filter((b) => b.day_id === day.id)
  const visible = dayItems.filter((i) => showCancelled || i.status !== "cancelled")
  const cancelledCount = dayItems.filter((i) => i.status === "cancelled").length
  const gaps = travelGaps(visible)

  function openNew(type: ItemType) {
    setAddOpen(false)
    const after = selectedId ? dayItems.find((i) => i.id === selectedId) ?? null : null
    const minutes = type === "meeting" ? itin.default_meeting_minutes : DEFAULT_ITEM_MINUTES[type]
    const slot = nextFreeSlot(dayItems, day.date, day.timezone, minutes, after)
    const draft = newDraft(type, day, slot.startIso, slot.endIso)
    if (draft.travel) draft.travel.bufferMinutes = itin.buffer_car_minutes
    setBlockPanel(null)
    setPanel({ kind: "new", draft })
  }

  /** A meeting in the block's next free slot, inheriting its host + location. */
  function bookInBlock(b: BuilderBlock) {
    const slot = nextSlotInBlock(b, dayItems)
    if (!slot) {
      toast(`${blockName(b)} is full`, { description: "Lengthen the block, shorten its slots or book outside it." })
      return
    }
    const draft = newDraft("meeting", day, slot.startIso, slot.endIso)
    Object.assign(draft, {
      title: b.host_institution_name ?? "",
      institutionName: b.host_institution_name ?? "",
      venueName: b.venue_name ?? "",
      addressLine1: b.address_line1 ?? "",
      addressLine2: b.address_line2 ?? "",
      city: b.city ?? day.city ?? "",
      state: b.state ?? "",
      postalCode: b.postal_code ?? "",
      country: b.country ?? "",
      roomOrFloor: b.room_or_floor ?? "",
      atInvestorOffice: b.at_investor_office,
      videoUrl: b.video_url ?? "",
      dialIn: b.dial_in ?? "",
      dialInPasscode: b.dial_in_passcode ?? "",
      notesExternal: b.notes_external ?? "",
      availabilityBlockId: b.id,
    })
    setBlockPanel(null)
    setPanel({ kind: "new", draft })
  }

  function openTravel(from: BuilderItem, to: BuilderItem) {
    const slot = travelSlot(from.end_at, to.start_at)
    const draft = newDraft("travel", day, slot.startIso, slot.endIso)
    draft.title = `To ${to.institution_name || to.venue_name || to.title}`
    draft.city = ""
    draft.travel = {
      ...emptyTravel(),
      bufferMinutes: itin.buffer_car_minutes,
      fromItemId: from.id,
      toItemId: to.id,
      fromLabel: from.venue_name || from.institution_name || from.title,
      toLabel: to.venue_name || to.institution_name || to.title,
      fromAddress: [from.address_line1, from.city].filter(Boolean).join(", "),
      toAddress: [to.address_line1, to.city].filter(Boolean).join(", "),
    }
    draft.attendeeIds = [...new Set([...from.attendee_ids.filter((a) => to.attendee_ids.includes(a))])]
    setBlockPanel(null)
    setPanel({ kind: "new", draft })
  }

  const openEdit = (i: BuilderItem) => {
    setSelectedId(i.id)
    setBlockPanel(null)
    setPanel({ kind: "edit", itemId: i.id })
  }
  const openBlock = (b: BuilderBlock) => {
    setPanel(null)
    setBlockPanel({ kind: "edit", blockId: b.id })
  }

  /* ---- day strip ---- */
  const strip = (
    <div className="flex items-center gap-2 overflow-x-auto pb-1">
      {itin.days.map((d) => {
        const n = itin.items.filter((i) => i.day_id === d.id && i.item_type === "meeting" && i.status !== "cancelled").length
        const active = d.id === day.id
        return (
          <button
            key={d.id}
            type="button"
            onClick={() => {
              setDayId(d.id)
              setSelectedId(null)
            }}
            className="shrink-0 rounded-[10px] border px-3 py-2 text-left transition-colors"
            style={{
              background: active ? BRAND_NAVY : "#FFFFFF",
              color: active ? "#FFFFFF" : TEXT_PRIMARY,
              borderColor: active ? BRAND_NAVY : "#E6E9EF",
            }}
          >
            <div className="text-sm font-semibold">{formatDay(d.date)}</div>
            <div className="text-xs" style={{ opacity: 0.8 }}>
              {d.city || "No city"}
              {d.timezone !== HOME_TZ ? ` · ${zoneAbbrev(`${d.date}T17:00:00Z`, d.timezone)}` : ""} · {n} mtg{n === 1 ? "" : "s"}
            </div>
          </button>
        )
      })}
      {!readOnly && (
        <Button
          variant="outline"
          size="sm"
          className="shrink-0"
          onClick={() => {
            const last = itin.days[itin.days.length - 1]
            const next = new Date(Date.parse(`${last.date}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10)
            setDayDialog({ kind: "add", date: next, timezone: last.timezone })
          }}
        >
          <Plus className="size-4" /> Add day
        </Button>
      )}
    </div>
  )

  /* ---- toolbar ---- */
  const toolbar = (
    <div className="flex flex-wrap items-center gap-2">
      <div className="mr-auto min-w-0">
        <div className="text-sm font-semibold" style={{ color: TEXT_PRIMARY }}>
          {formatDay(day.date)}
          {day.day_title || day.city ? ` · ${day.day_title || day.city}` : ""}
        </div>
        <div className="text-xs" style={{ color: TEXT_MUTED }}>
          {zoneLabel(day.timezone)} time{day.timezone !== HOME_TZ ? " · Eastern shown alongside" : ""}
          {day.day_notes ? ` · ${day.day_notes}` : ""}
        </div>
      </div>
      {!readOnly && (
        <Button variant="ghost" size="sm" onClick={() => setDayDialog({ kind: "edit", day })}>
          <MoreHorizontal className="size-4" /> Edit day
        </Button>
      )}
      {cancelledCount > 0 && (
        <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <input type="checkbox" checked={showCancelled} onChange={(e) => setShowCancelled(e.target.checked)} />
          Show cancelled ({cancelledCount})
        </label>
      )}
      <SegmentedToggle
        value={view}
        onChange={setView}
        options={[
          { value: "timeline", label: "Timeline" },
          { value: "list", label: "List" },
        ]}
      />
      {!readOnly && (
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            setPanel(null)
            setBlockPanel({ kind: "new", draft: newBlockDraft(day) })
          }}
        >
          <CalendarPlus className="size-4" /> Add block
        </Button>
      )}
      {!readOnly && (
        <Popover open={addOpen} onOpenChange={setAddOpen}>
          <PopoverTrigger render={<Button size="sm" />}>
            <Plus className="size-4" /> Add item
          </PopoverTrigger>
          <PopoverContent align="end" className="w-52 p-1">
            <div className="px-2 py-1 text-xs text-muted-foreground">
              {selectedId && dayItems.some((i) => i.id === selectedId) ? "After the selected item" : "After the last item"}
            </div>
            {ITEM_TYPES.map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => openNew(t)}
                className="flex w-full items-center rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted"
              >
                {ITEM_TYPE_LABEL[t]}
              </button>
            ))}
          </PopoverContent>
        </Popover>
      )}
    </div>
  )

  /* ---- per-day block summary ---- */
  const live = dayItems.filter((i) => i.status !== "cancelled")
  const caps = dayBlocks.map((b) => ({ b, c: blockCapacity(b, live) }))
  const openMin = caps.reduce((s, x) => s + x.c.blockMinutes, 0)
  const bookedMin = caps.reduce((s, x) => s + x.c.bookedMinutes, 0)
  const summary = dayBlocks.length > 0 && (
    <div className="flex flex-wrap items-center gap-2 text-xs">
      <span style={{ color: TEXT_MUTED }}>
        Availability: {Math.round(openMin / 6) / 10} h open · {bookedMin} min booked
      </span>
      {caps.map(({ b, c }) => (
        <button
          key={b.id}
          type="button"
          onClick={() => openBlock(b)}
          className="rounded-full border px-2.5 py-0.5 hover:bg-muted"
          style={{ borderColor: BAND_BORDER, background: BAND_BG, color: DEEP_TEAL }}
          title={capacityText(c)}
        >
          {blockName(b)} {blockTimes(b)} · {c.bookedCount} of ~{c.capacity} booked
          {c.overCapacity ? " · over" : ""}
        </button>
      ))}
    </div>
  )

  const empty = visible.length === 0 && dayBlocks.length === 0

  return (
    <div className="space-y-3">
      {strip}
      <div className={`${CARD_CLASS} space-y-3 p-4`}>
        {toolbar}
        {summary}
        {empty ? (
          <div className="rounded-lg border border-dashed border-border px-6 py-12 text-center text-sm text-muted-foreground">
            Nothing scheduled on this day yet.
            {!readOnly && (
              <>
                {" "}
                <button className="underline" onClick={() => openNew("meeting")}>
                  Add a meeting
                </button>{" "}
                or{" "}
                <button className="underline" onClick={() => setBlockPanel({ kind: "new", draft: newBlockDraft(day) })}>
                  add an availability block
                </button>
                .
              </>
            )}
          </div>
        ) : view === "timeline" ? (
          <Timeline
            day={day}
            items={visible}
            liveItems={live}
            blocks={dayBlocks}
            gaps={gaps}
            selectedId={selectedId}
            onOpen={openEdit}
            onOpenBlock={openBlock}
            onBook={readOnly ? null : bookInBlock}
            onTravel={readOnly ? null : openTravel}
            mtName={mtName}
          />
        ) : (
          <ListView items={visible} gaps={gaps} onOpen={openEdit} onTravel={readOnly ? null : openTravel} mtName={mtName} />
        )}
      </div>

      <ItemPanel target={panel} onClose={() => setPanel(null)} />
      <BlockPanel target={blockPanel} onClose={() => setBlockPanel(null)} />
      <DayDialog key={JSON.stringify(dayDialog)} target={dayDialog} onClose={() => setDayDialog(null)} onSelect={setDayId} />
    </div>
  )
}

/* ================================================================ timeline */

function Timeline({
  day,
  items,
  liveItems,
  blocks,
  gaps,
  selectedId,
  onOpen,
  onOpenBlock,
  onBook,
  onTravel,
  mtName,
}: {
  day: BuilderDay
  items: BuilderItem[]
  liveItems: BuilderItem[]
  blocks: BuilderBlock[]
  gaps: { from: BuilderItem; to: BuilderItem }[]
  selectedId: string | null
  onOpen: (i: BuilderItem) => void
  onOpenBlock: (b: BuilderBlock) => void
  onBook: ((b: BuilderBlock) => void) | null
  onTravel: ((from: BuilderItem, to: BuilderItem) => void) | null
  mtName: (id: string | null) => string | null
}) {
  const pos = items.map((i) => ({
    item: i,
    start: minutesIntoDay(i.start_at, day.date, day.timezone),
    end: minutesIntoDay(i.end_at, day.date, day.timezone),
  }))
  const bands = blocks.map((b) => ({
    block: b,
    start: minutesIntoDay(b.start_at, day.date, day.timezone),
    end: minutesIntoDay(b.end_at, day.date, day.timezone),
    cap: blockCapacity(b, liveItems),
  }))
  const starts = [...pos.map((p) => p.start), ...bands.map((b) => b.start)]
  const ends = [...pos.map((p) => p.end), ...bands.map((b) => b.end)]
  const from = Math.min(DEFAULT_FROM, Math.floor(Math.min(...starts) / 60) * 60)
  const to = Math.max(DEFAULT_TO, Math.ceil(Math.max(...ends) / 60) * 60)
  const hours = Array.from({ length: (to - from) / 60 + 1 }, (_, k) => from + k * 60)
  const lanes = layoutLanes(pos.map((p) => ({ id: p.item.id, start: p.start, end: p.end })))
  const y = (min: number) => ((min - from) / 60) * HOUR_PX
  const infoW = blocks.length ? BAND_INFO_PX : 0

  const hourLabel = (min: number) => {
    const h = ((Math.floor(min / 60) % 24) + 24) % 24
    return `${h % 12 === 0 ? 12 : h % 12} ${h < 12 ? "AM" : "PM"}`
  }

  return (
    <div className="relative overflow-x-auto">
      <div className="relative" style={{ height: y(to) + 8, minWidth: 520 + infoW }}>
        {/* hour grid */}
        {hours.map((m) => (
          <div key={m} className="absolute inset-x-0 flex items-start" style={{ top: y(m) }}>
            <div className="w-16 shrink-0 -translate-y-2 pr-2 text-right text-[11px] tabular-nums" style={{ color: TEXT_MUTED }}>
              {hourLabel(m)}
            </div>
            <div className="h-px flex-1" style={{ background: "#EEF0F4" }} />
          </div>
        ))}

        {/* availability bands — behind everything, full width */}
        <div className="absolute bottom-0 right-2 top-0" style={{ left: 72 }}>
          {bands.map(({ block: b, start, end, cap }) => (
            <div
              key={b.id}
              className="absolute inset-x-0 rounded-md"
              style={{
                top: y(start),
                height: Math.max(y(end) - y(start), 18),
                background: BAND_BG,
                border: `1.5px dashed ${cap.overCapacity && b.block_type === "hard" ? "#B42318" : BAND_BORDER}`,
              }}
            >
              <div className="absolute right-0 top-0 flex flex-col items-start gap-1 p-2 text-[11px]" style={{ width: BAND_INFO_PX - 8, color: DEEP_TEAL }}>
                <button type="button" onClick={() => onOpenBlock(b)} className="max-w-full truncate text-left font-semibold hover:underline">
                  {blockName(b)}
                </button>
                <span className="opacity-80">
                  {blockTimes(b)} · {b.block_type === "hard" ? "hard" : "soft"}
                </span>
                <span style={{ color: cap.overCapacity ? "#B42318" : undefined }}>
                  {cap.overCapacity ? `Over capacity · ${cap.bookedCount} booked` : capacityText(cap)}
                </span>
                {onBook && cap.remainingSlots > 0 && y(end) - y(start) >= 70 && (
                  <button
                    type="button"
                    onClick={() => onBook(b)}
                    className="flex items-center gap-1 rounded-full border bg-white px-2 py-0.5 hover:bg-muted"
                    style={{ borderColor: BAND_BORDER }}
                  >
                    <Plus className="size-3" /> Book meeting
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>

        {/* items */}
        <div className="absolute bottom-0 top-0" style={{ left: 72, right: 8 + infoW }}>
          {pos.map(({ item: i, start, end }) => {
            const l = lanes.get(i.id) ?? { lane: 0, lanes: 1 }
            const st = blockStyle(i.item_type)
            const h = Math.max(y(end) - y(start), 18)
            const tentative = i.status === "tentative"
            const cancelled = i.status === "cancelled"
            const compact = h < 40
            return (
              <button
                key={i.id}
                type="button"
                onClick={() => onOpen(i)}
                className="absolute z-10 overflow-hidden rounded-md px-2 py-1 text-left text-xs shadow-sm transition-shadow hover:shadow-md"
                style={{
                  top: y(start),
                  height: h,
                  left: `calc(${(l.lane / l.lanes) * 100}% + 2px)`,
                  width: `calc(${100 / l.lanes}% - 4px)`,
                  background: st.bg,
                  color: st.fg,
                  border: `1.5px ${tentative ? "dashed" : "solid"} ${tentative && i.item_type === "meeting" ? "#FFFFFF" : st.border}`,
                  outline: selectedId === i.id ? `2px solid ${BRAND_NAVY}` : undefined,
                  outlineOffset: 1,
                  opacity: cancelled ? 0.55 : i.id.startsWith("tmp-") ? 0.7 : 1,
                }}
                title={`${i.title} · ${timeRange(i)}`}
              >
                <div className={`flex items-center gap-1 font-semibold ${cancelled ? "line-through" : ""}`}>
                  <TypeIcon item={i} />
                  <span className="truncate">{i.title}</span>
                  {compact && <span className="ml-auto shrink-0 font-normal opacity-80">{formatTime(i.start_at, i.timezone)}</span>}
                </div>
                {!compact && (
                  <>
                    <div className="truncate opacity-90">{timeRange(i)}</div>
                    <div className="truncate opacity-80">{detailLine(i, mtName(i.meeting_type_id))}</div>
                  </>
                )}
              </button>
            )
          })}

          {/* "+ Add travel" connectors */}
          {onTravel &&
            gaps.map((g) => {
              const a = minutesIntoDay(g.from.end_at, day.date, day.timezone)
              const b = minutesIntoDay(g.to.start_at, day.date, day.timezone)
              return (
                <button
                  key={`${g.from.id}-${g.to.id}`}
                  type="button"
                  onClick={() => onTravel(g.from, g.to)}
                  className="absolute right-0 z-20 flex -translate-y-1/2 items-center gap-1 rounded-full border bg-white px-2 py-0.5 text-[11px] shadow-sm hover:bg-muted"
                  style={{ top: y((a + b) / 2), borderColor: "#C9D6F0", color: STATUS_PILL_LIGHT.new.text }}
                >
                  <Plus className="size-3" /> Add travel
                </button>
              )
            })}
        </div>
      </div>
      {day.timezone !== HOME_TZ && (
        <div className="mt-1 text-[11px]" style={{ color: TEXT_MUTED }}>
          Hours are {zoneLabel(day.timezone)} time; each block also shows its Eastern time.
        </div>
      )}
    </div>
  )
}

/* ================================================================= list */

function ListView({
  items,
  gaps,
  onOpen,
  onTravel,
  mtName,
}: {
  items: BuilderItem[]
  gaps: { from: BuilderItem; to: BuilderItem }[]
  onOpen: (i: BuilderItem) => void
  onTravel: ((from: BuilderItem, to: BuilderItem) => void) | null
  mtName: (id: string | null) => string | null
}) {
  const sorted = [...items].sort((a, b) => a.start_at.localeCompare(b.start_at))
  if (!sorted.length)
    return <div className="rounded-lg border border-dashed border-border px-6 py-8 text-center text-sm text-muted-foreground">No items on this day yet.</div>
  return (
    <div className="divide-y divide-border rounded-lg border border-border">
      {sorted.map((i) => {
        const gap = gaps.find((g) => g.from.id === i.id)
        const st = blockStyle(i.item_type)
        return (
          <React.Fragment key={i.id}>
            <button
              type="button"
              onClick={() => onOpen(i)}
              className="flex w-full items-center gap-3 px-3 py-2 text-left text-sm hover:bg-muted/40"
            >
              <span className="h-8 w-1 shrink-0 rounded-full" style={{ background: st.border === "#D5DAE3" ? "#D5DAE3" : st.bg }} />
              <span className="w-56 shrink-0 text-xs tabular-nums">{dualTime(i.start_at, i.timezone)}</span>
              <span className={`min-w-0 flex-1 ${i.status === "cancelled" ? "line-through opacity-60" : ""}`}>
                <span className="flex items-center gap-1 font-medium">
                  <TypeIcon item={i} />
                  <span className="truncate">{i.title}</span>
                </span>
                <span className="block truncate text-xs text-muted-foreground">
                  {[
                    ITEM_TYPE_LABEL[i.item_type as ItemType],
                    detailLine(i, mtName(i.meeting_type_id)),
                    i.item_type !== "travel" ? locationLabel(i) : null,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
              </span>
              <span className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground">
                <Users className="size-3.5" /> {i.attendee_ids.length}
              </span>
              <span className="w-20 shrink-0 text-right text-xs capitalize text-muted-foreground">
                {i.status === "confirmed" ? `${durationMin(i)} min` : i.status}
              </span>
            </button>
            {gap && onTravel && (
              <div className="flex justify-center py-1">
                <button
                  type="button"
                  onClick={() => onTravel(gap.from, gap.to)}
                  className="flex items-center gap-1 rounded-full border bg-white px-2 py-0.5 text-[11px] hover:bg-muted"
                  style={{ borderColor: "#C9D6F0", color: STATUS_PILL_LIGHT.new.text }}
                >
                  <Plus className="size-3" /> Add travel
                </button>
              </div>
            )}
          </React.Fragment>
        )
      })}
    </div>
  )
}
