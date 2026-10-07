"use client"

/**
 * The right-hand item panel — the full form for one block (meeting, travel,
 * hotel, meal, break, hold, presentation, other), for create and edit.
 *
 * Times are typed on the DAY's clock (Eastern unless the day is set to another
 * city); Eastern is shown alongside when the clocks differ. A flight or train
 * can land in another zone ("Arrives in"), so its end time is on that clock.
 *
 * Saving is optimistic: the block moves on the timeline at once and is replaced
 * by the server's copy (or rolled back) when the save returns. After a time
 * change, a toast offers to ripple the change through the rest of the day.
 */

import * as React from "react"
import { Copy, Loader2, Trash2 } from "lucide-react"
import { toast } from "sonner"

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { Textarea } from "@/components/ui/textarea"
import { FormSection } from "@/components/crm-form-kit"
import { TEXT_MUTED } from "@/lib/design"
import {
  HOME_TZ,
  ITEM_TYPES,
  ITEM_TYPE_LABEL,
  TIMEZONE_OPTIONS,
  TRAVEL_MODES,
  TRAVEL_MODE_LABEL,
  blockName,
  defaultBufferFor,
  dualTime,
  formatDay,
  formatTime,
  isoToZoned,
  resolveTimes,
  type ItemType,
} from "@/lib/events-planner/core"
import { ATTENDEE_SIDES, type BuilderDay, type BuilderItem, type ItemInput } from "@/lib/events-planner/types"
import { useBuilder } from "./builder-context"
import { deleteItem, duplicateItem, estimateTravelMinutes, saveItem, shiftFollowingItems } from "./builder-actions"

const SELECT_CLASS = "h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm"

/** Ids for not-yet-saved items (replaced by the real id when the save returns). */
let tmpSeq = 0

/** What the panel is showing: an existing item, or a new one with defaults. */
export type PanelTarget =
  | { kind: "edit"; itemId: string }
  | { kind: "new"; draft: ItemInput }
  | null

type Travel = NonNullable<ItemInput["travel"]>
type Hotel = NonNullable<ItemInput["hotel"]>

export function emptyTravel(): Travel {
  return {
    mode: "car_service",
    fromItemId: null,
    toItemId: null,
    fromLabel: "",
    toLabel: "",
    fromAddress: "",
    toAddress: "",
    toTimezone: "",
    bufferMinutes: 10,
    durationSource: "manual",
    transportCompany: "",
    driverName: "",
    driverPhone: "",
    vehicleType: "",
    pickupInstructions: "",
    carrier: "",
    flightOrTrainNumber: "",
    departTerminal: "",
    arriveTerminal: "",
    seatInfo: "",
    confirmationNumber: "",
    printConfirmationNumber: false,
  }
}

function emptyHotel(): Hotel {
  return { hotelName: "", address: "", phone: "", checkOutDate: "", checkOutTime: "11:00", confirmationNumber: "", notes: "" }
}

const s = (v: string | null | undefined) => v ?? ""

/** A fresh draft for a new block of `type` from `startIso` to `endIso` on `day`. */
export function newDraft(type: ItemType, day: BuilderDay, startIso: string, endIso: string): ItemInput {
  const endTz = day.timezone
  return {
    dayId: day.id,
    itemType: type,
    title: type === "meeting" ? "" : ITEM_TYPE_LABEL[type],
    startTime: isoToZoned(startIso, day.timezone).time,
    endTime: isoToZoned(endIso, endTz).time,
    status: "confirmed",
    meetingTypeId: null,
    institutionName: "",
    venueName: "",
    addressLine1: "",
    addressLine2: "",
    city: day.city ?? "",
    state: "",
    postalCode: "",
    country: "",
    roomOrFloor: "",
    atInvestorOffice: false,
    videoUrl: "",
    dialIn: "",
    dialInPasscode: "",
    notesInternal: "",
    notesExternal: "",
    includeInPdf: true,
    sendInvite: type !== "travel" && type !== "hotel",
    attendeeIds: [],
    availabilityBlockId: null,
    travel: type === "travel" ? emptyTravel() : null,
    hotel: type === "hotel" ? emptyHotel() : null,
  }
}

function draftFromItem(i: BuilderItem): ItemInput {
  const endTz = i.travel?.to_timezone && i.travel.to_timezone !== i.timezone ? i.travel.to_timezone : i.timezone
  const t = i.travel
  const h = i.hotel
  const out = h?.check_out_at ? isoToZoned(h.check_out_at, i.timezone) : null
  return {
    dayId: i.day_id,
    itemType: i.item_type,
    title: i.title,
    startTime: isoToZoned(i.start_at, i.timezone).time,
    endTime: isoToZoned(i.end_at, endTz).time,
    status: i.status,
    meetingTypeId: i.meeting_type_id,
    institutionName: s(i.institution_name),
    venueName: s(i.venue_name),
    addressLine1: s(i.address_line1),
    addressLine2: s(i.address_line2),
    city: s(i.city),
    state: s(i.state),
    postalCode: s(i.postal_code),
    country: s(i.country),
    roomOrFloor: s(i.room_or_floor),
    atInvestorOffice: i.at_investor_office,
    videoUrl: s(i.video_url),
    dialIn: s(i.dial_in),
    dialInPasscode: s(i.dial_in_passcode),
    notesInternal: s(i.notes_internal),
    notesExternal: s(i.notes_external),
    includeInPdf: i.include_in_pdf,
    sendInvite: i.send_invite,
    attendeeIds: [...i.attendee_ids],
    availabilityBlockId: i.availability_block_id,
    travel: t
      ? {
          mode: t.mode,
          fromItemId: t.from_item_id,
          toItemId: t.to_item_id,
          fromLabel: s(t.from_label),
          toLabel: s(t.to_label),
          fromAddress: s(t.from_address),
          toAddress: s(t.to_address),
          toTimezone: t.to_timezone && t.to_timezone !== i.timezone ? t.to_timezone : "",
          bufferMinutes: t.buffer_minutes,
          durationSource: t.duration_source === "estimated" ? "estimated" : "manual",
          transportCompany: s(t.transport_company),
          driverName: s(t.driver_name),
          driverPhone: s(t.driver_phone),
          vehicleType: s(t.vehicle_type),
          pickupInstructions: s(t.pickup_instructions),
          carrier: s(t.carrier),
          flightOrTrainNumber: s(t.flight_or_train_number),
          departTerminal: s(t.depart_terminal),
          arriveTerminal: s(t.arrive_terminal),
          seatInfo: s(t.seat_info),
          confirmationNumber: s(t.confirmation_number),
          printConfirmationNumber: t.print_confirmation_number,
        }
      : i.item_type === "travel"
        ? emptyTravel()
        : null,
    hotel: h
      ? {
          hotelName: s(h.hotel_name),
          address: s(h.address),
          phone: s(h.phone),
          checkOutDate: out?.date ?? "",
          checkOutTime: out?.time ?? "11:00",
          confirmationNumber: s(h.confirmation_number),
          notes: s(h.notes),
        }
      : i.item_type === "hotel"
        ? emptyHotel()
        : null,
  }
}

/** The optimistic copy of an item after applying a draft (times resolved client-side). */
function applyDraft(base: BuilderItem | null, id: string, d: ItemInput, day: BuilderDay, startIso: string, endIso: string): BuilderItem {
  return {
    ...(base ?? ({} as BuilderItem)),
    id,
    day_id: d.dayId,
    item_type: d.itemType,
    crm_meeting_id: base?.crm_meeting_id ?? null,
    title: d.title.trim(),
    start_at: startIso,
    end_at: endIso,
    timezone: day.timezone,
    meeting_type_id: d.itemType === "meeting" ? d.meetingTypeId : null,
    institution_name: d.institutionName || null,
    venue_name: d.venueName || null,
    address_line1: d.addressLine1 || null,
    address_line2: d.addressLine2 || null,
    city: d.city || null,
    state: d.state || null,
    postal_code: d.postalCode || null,
    country: d.country || null,
    room_or_floor: d.roomOrFloor || null,
    at_investor_office: d.atInvestorOffice,
    video_url: d.videoUrl || null,
    dial_in: d.dialIn || null,
    dial_in_passcode: d.dialInPasscode || null,
    status: d.status,
    notes_internal: d.notesInternal || null,
    notes_external: d.notesExternal || null,
    include_in_pdf: d.includeInPdf,
    send_invite: d.sendInvite,
    sort_order: base?.sort_order ?? 0,
    availability_block_id: d.itemType === "meeting" ? d.availabilityBlockId : null,
    travel: base?.travel ?? null,
    hotel: base?.hotel ?? null,
    attendee_ids: d.attendeeIds,
  }
}

function Field({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={`grid gap-1.5 ${className ?? ""}`}>
      <Label>{label}</Label>
      {children}
    </div>
  )
}

export function ItemPanel({ target, onClose }: { target: PanelTarget; onClose: () => void }) {
  const { itin, meetingTypes, readOnly, canEstimate, mutate, upsertItems, removeItems } = useBuilder()
  const [estimating, setEstimating] = React.useState(false)
  const existing = target?.kind === "edit" ? itin.items.find((i) => i.id === target.itemId) ?? null : null
  const initial = React.useMemo(
    () => (target?.kind === "new" ? target.draft : existing ? draftFromItem(existing) : null),
    // Re-seed only when a different item / new draft is opened.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [target],
  )
  const [d, setD] = React.useState<ItemInput | null>(initial)
  const [error, setError] = React.useState<string | null>(null)
  const [saving, setSaving] = React.useState(false)
  const [confirmDelete, setConfirmDelete] = React.useState(false)
  const [seed, setSeed] = React.useState(initial)
  if (seed !== initial) {
    setSeed(initial)
    setD(initial)
    setError(null)
  }

  const open = !!target && !!d
  if (!d) return <Sheet open={false} onOpenChange={onClose} />

  const set = (p: Partial<ItemInput>) => setD((x) => (x ? { ...x, ...p } : x))
  const setT = (p: Partial<Travel>) => setD((x) => (x ? { ...x, travel: { ...(x.travel ?? emptyTravel()), ...p } } : x))
  const setH = (p: Partial<Hotel>) => setD((x) => (x ? { ...x, hotel: { ...(x.hotel ?? emptyHotel()), ...p } } : x))

  const day = itin.days.find((x) => x.id === d.dayId) ?? itin.days[0]
  const type = d.itemType as ItemType
  const isTravel = type === "travel"
  const crossZoneMode = isTravel && (d.travel?.mode === "flight" || d.travel?.mode === "train")
  const endTz = crossZoneMode && d.travel?.toTimezone ? d.travel.toTimezone : day.timezone
  const times = resolveTimes({ dayDate: day.date, dayTz: day.timezone, startTime: d.startTime, endTime: d.endTime, endTz })
  const durationMin = times.ok ? Math.round((Date.parse(times.endIso) - Date.parse(times.startIso)) / 60_000) : null
  const dayBlocks = itin.blocks.filter((b) => b.day_id === day.id)

  function changeType(next: ItemType) {
    set({
      itemType: next,
      travel: next === "travel" ? d!.travel ?? emptyTravel() : null,
      hotel: next === "hotel" ? d!.hotel ?? emptyHotel() : null,
      sendInvite: next === "travel" || next === "hotel" ? false : d!.sendInvite,
    })
  }

  async function onEstimate() {
    if (!d?.travel || !times.ok) return
    setEstimating(true)
    const r = await estimateTravelMinutes({
      fromAddress: d.travel.fromAddress,
      toAddress: d.travel.toAddress,
      mode: d.travel.mode,
      departAt: times.startIso,
    })
    setEstimating(false)
    if (!r.ok) return toast.error("Couldn't estimate", { description: r.error })
    if (r.data.minutes == null) return toast("No estimate for this trip", { description: "Enter the travel time by hand." })
    const endIso = new Date(Date.parse(times.startIso) + r.data.minutes * 60_000).toISOString()
    set({ endTime: isoToZoned(endIso, endTz).time })
    setT({ durationSource: "estimated" })
    toast.success(`Estimated  min`)
  }

  async function onSave() {
    if (!d || readOnly) return
    setError(null)
    if (!d.title.trim()) return setError("Enter a title.")
    if (!times.ok) return setError(times.error)
    setSaving(true)
    const id = existing?.id ?? `tmp-${++tmpSeq}`
    const optimistic = applyDraft(existing, id, d, day, times.startIso, times.endIso)
    const oldEnd = existing?.end_at ?? null
    const oldDay = existing?.day_id ?? null
    const r = await mutate(
      (st) => ({ ...st, items: [...st.items.filter((i) => i.id !== id), optimistic].sort((a, b) => a.start_at.localeCompare(b.start_at)) }),
      () => saveItem(itin.id, existing?.id ?? null, d),
      (data) => {
        removeItems([id])
        upsertItems([data.item])
      },
    )
    setSaving(false)
    if (!r.ok) {
      setError(r.error)
      return
    }
    onClose()

    // Ripple: the end moved on the same day and something follows it.
    const saved = r.data.item
    if (oldEnd && oldDay === saved.day_id && oldEnd !== saved.end_at) {
      const delta = Math.round((Date.parse(saved.end_at) - Date.parse(oldEnd)) / 60_000)
      const following = itin.items.filter(
        (i) => i.day_id === saved.day_id && i.id !== saved.id && i.start_at >= oldEnd && i.status !== "cancelled",
      )
      if (delta !== 0 && following.length) {
        toast(`${saved.title} now ends ${delta > 0 ? "later" : "earlier"}`, {
          duration: 10_000,
          action: {
            label: `Shift ${following.length} following ${following.length === 1 ? "item" : "items"} ${delta > 0 ? "+" : "−"}${Math.abs(delta)} min`,
            onClick: () => {
              void mutate(null, () => shiftFollowingItems(saved.day_id, oldEnd, delta, saved.id), (data) => {
                upsertItems(data.items)
                toast.success(`Shifted ${data.items.length} ${data.items.length === 1 ? "item" : "items"}`)
              })
            },
          },
        })
      }
    }
  }

  async function onDuplicate() {
    if (!existing) return
    const r = await mutate(null, () => duplicateItem(existing.id), (data) => upsertItems([data.item]))
    if (r.ok) {
      toast.success("Duplicated")
      onClose()
    }
  }

  async function onDelete() {
    if (!existing) return
    setConfirmDelete(false)
    onClose()
    const r = await mutate(
      (st) => ({ ...st, items: st.items.filter((i) => i.id !== existing.id) }),
      () => deleteItem(existing.id),
    )
    if (r.ok) toast.success("Deleted")
  }

  const groups = ATTENDEE_SIDES.map((side) => ({ side, people: itin.attendees.filter((a) => a.side === side.value) })).filter(
    (g) => g.people.length,
  )
  const party = itin.attendees.filter((a) => a.receives_full_itinerary && (a.side === "client" || a.side === "internal"))

  return (
    <>
      <Sheet open={open} onOpenChange={(o) => !o && !saving && onClose()}>
        <SheetContent side="right" className="w-full gap-0 p-0 sm:max-w-xl">
          <SheetHeader className="border-b border-border px-5 py-4">
            <SheetTitle>{existing ? `Edit ${ITEM_TYPE_LABEL[type]?.toLowerCase() ?? "item"}` : `New ${ITEM_TYPE_LABEL[type]?.toLowerCase() ?? "item"}`}</SheetTitle>
            <SheetDescription>
              {formatDay(day.date)}
              {day.city ? ` · ${day.city}` : ""} ·{" "}
              {TIMEZONE_OPTIONS.find((z) => z.value === day.timezone)?.label ?? day.timezone}
            </SheetDescription>
          </SheetHeader>

          <fieldset disabled={readOnly || saving} className="grid flex-1 content-start gap-4 overflow-y-auto px-5 py-4">
            {/* ---- basics ---- */}
            <div className="grid grid-cols-2 gap-3">
              <Field label="Type">
                <select value={type} onChange={(e) => changeType(e.target.value as ItemType)} className={SELECT_CLASS}>
                  {ITEM_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {ITEM_TYPE_LABEL[t]}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Status">
                <select value={d.status} onChange={(e) => set({ status: e.target.value })} className={SELECT_CLASS}>
                  <option value="confirmed">Confirmed</option>
                  <option value="tentative">Tentative</option>
                  <option value="cancelled">Cancelled</option>
                </select>
              </Field>
            </div>

            <Field label={type === "meeting" ? "Title (e.g. the investor firm)" : "Title"}>
              <Input value={d.title} onChange={(e) => set({ title: e.target.value })} autoFocus={!existing} />
            </Field>

            <div className="grid grid-cols-3 gap-3">
              <Field label="Day">
                <select value={d.dayId} onChange={(e) => set({ dayId: e.target.value })} className={SELECT_CLASS}>
                  {itin.days.map((x) => (
                    <option key={x.id} value={x.id}>
                      {formatDay(x.date)}
                      {x.city ? ` · ${x.city}` : ""}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Start">
                <Input type="time" value={d.startTime} onChange={(e) => { set({ startTime: e.target.value }); if (isTravel) setT({ durationSource: "manual" }) }} />
              </Field>
              <Field label={crossZoneMode && d.travel?.toTimezone ? "Arrives (local)" : "End"}>
                <Input type="time" value={d.endTime} onChange={(e) => { set({ endTime: e.target.value }); if (isTravel) setT({ durationSource: "manual" }) }} />
              </Field>
            </div>
            <div className="-mt-2 text-xs" style={{ color: TEXT_MUTED }}>
              {times.ok ? (
                <>
                  {dualTime(times.startIso, day.timezone)} → {dualTime(times.endIso, endTz)}
                  {durationMin != null ? ` · ${durationMin} min` : ""}
                </>
              ) : (
                <span className="text-destructive">{times.error}</span>
              )}
            </div>

            {/* ---- meeting ---- */}
            {(type === "meeting" || type === "presentation") && (
              <div className="grid grid-cols-2 gap-3">
                {type === "meeting" && (
                  <Field label="Meeting type">
                    <select
                      value={d.meetingTypeId ?? ""}
                      onChange={(e) => set({ meetingTypeId: e.target.value || null })}
                      className={SELECT_CLASS}
                    >
                      <option value="">—</option>
                      {meetingTypes.map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.name}
                        </option>
                      ))}
                    </select>
                  </Field>
                )}
                <Field label="Institution">
                  <Input value={d.institutionName} onChange={(e) => set({ institutionName: e.target.value })} />
                </Field>
                {type === "meeting" && dayBlocks.length > 0 && (
                  <Field label="Availability block" className="col-span-2">
                    <select
                      value={d.availabilityBlockId ?? ""}
                      onChange={(e) => set({ availabilityBlockId: e.target.value || null })}
                      className={SELECT_CLASS}
                    >
                      <option value="">Not in a block</option>
                      {dayBlocks.map((b) => (
                        <option key={b.id} value={b.id}>
                          {blockName(b)} · {formatTime(b.start_at, b.timezone)}–{formatTime(b.end_at, b.timezone)}
                        </option>
                      ))}
                    </select>
                  </Field>
                )}
              </div>
            )}

            {/* ---- travel ---- */}
            {isTravel && d.travel && (
              <FormSection title="Travel">
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Mode">
                    <select value={d.travel.mode} onChange={(e) => setT({ mode: e.target.value, bufferMinutes: defaultBufferFor(e.target.value, itin) })} className={SELECT_CLASS}>
                      {TRAVEL_MODES.map((m) => (
                        <option key={m} value={m}>
                          {TRAVEL_MODE_LABEL[m]}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label={d.travel.mode === "flight" ? "At airport before (min)" : "Buffer after (min)"}>
                    <Input
                      type="number"
                      min={0}
                      value={d.travel.bufferMinutes}
                      onChange={(e) => setT({ bufferMinutes: Number(e.target.value) })}
                    />
                  </Field>
                  <Field label="From">
                    <Input value={d.travel.fromLabel} onChange={(e) => setT({ fromLabel: e.target.value })} />
                  </Field>
                  <Field label="To">
                    <Input value={d.travel.toLabel} onChange={(e) => setT({ toLabel: e.target.value })} />
                  </Field>
                  <Field label="From address">
                    <Input value={d.travel.fromAddress} onChange={(e) => setT({ fromAddress: e.target.value })} />
                  </Field>
                  <Field label="To address">
                    <Input value={d.travel.toAddress} onChange={(e) => setT({ toAddress: e.target.value })} />
                  </Field>
                </div>
                {canEstimate && d.travel.mode !== "flight" && (
                  <div className="flex items-center gap-2 text-xs" style={{ color: TEXT_MUTED }}>
                    <Button type="button" variant="outline" size="sm" onClick={onEstimate} disabled={estimating || !times.ok}>
                      {estimating ? <Loader2 className="size-4 animate-spin" /> : null} Estimate
                    </Button>
                    {d.travel.durationSource === "estimated" ? "Travel time is an estimate — edit the times to override." : "Fills the end time from the two addresses."}
                  </div>
                )}
                {crossZoneMode ? (
                  <div className="grid grid-cols-2 gap-3">
                    <Field label="Carrier">
                      <Input value={d.travel.carrier} onChange={(e) => setT({ carrier: e.target.value })} />
                    </Field>
                    <Field label={d.travel.mode === "flight" ? "Flight number" : "Train number"}>
                      <Input value={d.travel.flightOrTrainNumber} onChange={(e) => setT({ flightOrTrainNumber: e.target.value })} />
                    </Field>
                    <Field label="Departs terminal">
                      <Input value={d.travel.departTerminal} onChange={(e) => setT({ departTerminal: e.target.value })} />
                    </Field>
                    <Field label="Arrives terminal">
                      <Input value={d.travel.arriveTerminal} onChange={(e) => setT({ arriveTerminal: e.target.value })} />
                    </Field>
                    <Field label="Arrives in (time zone)">
                      <select
                        value={d.travel.toTimezone}
                        onChange={(e) => setT({ toTimezone: e.target.value })}
                        className={SELECT_CLASS}
                      >
                        <option value="">Same as the day</option>
                        {TIMEZONE_OPTIONS.map((z) => (
                          <option key={z.value} value={z.value}>
                            {z.label}
                          </option>
                        ))}
                      </select>
                    </Field>
                    <Field label="Seats">
                      <Input value={d.travel.seatInfo} onChange={(e) => setT({ seatInfo: e.target.value })} />
                    </Field>
                  </div>
                ) : (
                  <div className="grid grid-cols-2 gap-3">
                    <Field label="Company">
                      <Input value={d.travel.transportCompany} onChange={(e) => setT({ transportCompany: e.target.value })} />
                    </Field>
                    <Field label="Vehicle">
                      <Input value={d.travel.vehicleType} onChange={(e) => setT({ vehicleType: e.target.value })} />
                    </Field>
                    <Field label="Driver">
                      <Input value={d.travel.driverName} onChange={(e) => setT({ driverName: e.target.value })} />
                    </Field>
                    <Field label="Driver phone">
                      <Input value={d.travel.driverPhone} onChange={(e) => setT({ driverPhone: e.target.value })} />
                    </Field>
                    <Field label="Pickup instructions" className="col-span-2">
                      <Input value={d.travel.pickupInstructions} onChange={(e) => setT({ pickupInstructions: e.target.value })} />
                    </Field>
                  </div>
                )}
                <div className="grid grid-cols-2 items-end gap-3">
                  <Field label="Confirmation # (internal)">
                    <Input value={d.travel.confirmationNumber} onChange={(e) => setT({ confirmationNumber: e.target.value })} />
                  </Field>
                  <label className="flex items-center gap-2 pb-2 text-sm">
                    <Checkbox
                      checked={d.travel.printConfirmationNumber}
                      onCheckedChange={(c) => setT({ printConfirmationNumber: c === true })}
                    />
                    Print confirmation # in the PDF
                  </label>
                </div>
              </FormSection>
            )}

            {/* ---- hotel ---- */}
            {type === "hotel" && d.hotel && (
              <FormSection title="Hotel">
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Hotel">
                    <Input value={d.hotel.hotelName} onChange={(e) => setH({ hotelName: e.target.value })} />
                  </Field>
                  <Field label="Phone">
                    <Input value={d.hotel.phone} onChange={(e) => setH({ phone: e.target.value })} />
                  </Field>
                  <Field label="Address" className="col-span-2">
                    <Input value={d.hotel.address} onChange={(e) => setH({ address: e.target.value })} />
                  </Field>
                  <Field label="Check-out date">
                    <Input type="date" value={d.hotel.checkOutDate} onChange={(e) => setH({ checkOutDate: e.target.value })} />
                  </Field>
                  <Field label="Check-out time">
                    <Input type="time" value={d.hotel.checkOutTime} onChange={(e) => setH({ checkOutTime: e.target.value })} />
                  </Field>
                  <Field label="Confirmation # (internal)">
                    <Input value={d.hotel.confirmationNumber} onChange={(e) => setH({ confirmationNumber: e.target.value })} />
                  </Field>
                </div>
                <div className="text-xs" style={{ color: TEXT_MUTED }}>
                  The block&apos;s start time is the check-in time.
                </div>
              </FormSection>
            )}

            {/* ---- location ---- */}
            {!isTravel && (
              <FormSection title="Location">
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Venue">
                    <Input value={d.venueName} onChange={(e) => set({ venueName: e.target.value })} />
                  </Field>
                  <Field label="Room / floor">
                    <Input value={d.roomOrFloor} onChange={(e) => set({ roomOrFloor: e.target.value })} />
                  </Field>
                  <Field label="Address" className="col-span-2">
                    <Input value={d.addressLine1} onChange={(e) => set({ addressLine1: e.target.value })} />
                  </Field>
                  <Field label="Address line 2" className="col-span-2">
                    <Input value={d.addressLine2} onChange={(e) => set({ addressLine2: e.target.value })} />
                  </Field>
                  <Field label="City">
                    <Input value={d.city} onChange={(e) => set({ city: e.target.value })} />
                  </Field>
                  <Field label="State">
                    <Input value={d.state} onChange={(e) => set({ state: e.target.value })} />
                  </Field>
                  <Field label="Postal code">
                    <Input value={d.postalCode} onChange={(e) => set({ postalCode: e.target.value })} />
                  </Field>
                  <Field label="Country">
                    <Input value={d.country} onChange={(e) => set({ country: e.target.value })} />
                  </Field>
                </div>
                {type === "meeting" && (
                  <label className="flex items-center gap-2 text-sm">
                    <Checkbox checked={d.atInvestorOffice} onCheckedChange={(c) => set({ atInvestorOffice: c === true })} />
                    At the investor&apos;s office
                  </label>
                )}
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Video link" className="col-span-2">
                    <Input value={d.videoUrl} onChange={(e) => set({ videoUrl: e.target.value })} placeholder="https://" />
                  </Field>
                  <Field label="Dial-in">
                    <Input value={d.dialIn} onChange={(e) => set({ dialIn: e.target.value })} />
                  </Field>
                  <Field label="Passcode">
                    <Input value={d.dialInPasscode} onChange={(e) => set({ dialInPasscode: e.target.value })} />
                  </Field>
                </div>
              </FormSection>
            )}

            {/* ---- people ---- */}
            <FormSection title={`Attendees (${d.attendeeIds.length})`}>
              {itin.attendees.length === 0 ? (
                <div className="text-sm text-muted-foreground">No attendees on this itinerary yet — add them on the Attendees tab.</div>
              ) : (
                <>
                  {party.length > 0 && (
                    <button
                      type="button"
                      className="w-fit text-xs underline"
                      onClick={() => set({ attendeeIds: [...new Set([...d.attendeeIds, ...party.map((p) => p.id)])] })}
                    >
                      Add the travelling party ({party.length})
                    </button>
                  )}
                  {groups.map((g) => (
                    <div key={g.side.value} className="grid gap-1">
                      <div className="text-xs font-medium text-muted-foreground">{g.side.label}</div>
                      {g.people.map((a) => (
                        <label key={a.id} className="flex items-center gap-2 text-sm">
                          <Checkbox
                            checked={d.attendeeIds.includes(a.id)}
                            onCheckedChange={(c) =>
                              set({
                                attendeeIds: c === true ? [...d.attendeeIds, a.id] : d.attendeeIds.filter((x) => x !== a.id),
                              })
                            }
                          />
                          <span className="truncate">
                            {a.full_name}
                            {a.title ? <span className="text-muted-foreground"> · {a.title}</span> : null}
                          </span>
                        </label>
                      ))}
                    </div>
                  ))}
                </>
              )}
            </FormSection>

            {/* ---- notes + output ---- */}
            <FormSection title="Notes">
              <Field label="External notes — printed in the PDF and included in invites">
                <Textarea rows={2} value={d.notesExternal} onChange={(e) => set({ notesExternal: e.target.value })} />
              </Field>
              <Field label="Internal notes — never shown outside Rose">
                <Textarea rows={2} value={d.notesInternal} onChange={(e) => set({ notesInternal: e.target.value })} />
              </Field>
              <div className="flex flex-wrap gap-4">
                <label className="flex items-center gap-2 text-sm">
                  <Checkbox checked={d.includeInPdf} onCheckedChange={(c) => set({ includeInPdf: c === true })} />
                  Include in PDF
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <Checkbox checked={d.sendInvite} onCheckedChange={(c) => set({ sendInvite: c === true })} />
                  Send calendar invite
                </label>
              </div>
            </FormSection>

            {existing?.crm_meeting_id && (
              <div className="text-xs" style={{ color: TEXT_MUTED }}>
                Imported from a CRM meeting. Edits here change the itinerary only — never the CRM.
              </div>
            )}
          </fieldset>

          {error && <div className="px-5 pb-2 text-sm text-destructive">{error}</div>}

          <SheetFooter className="flex-row items-center border-t border-border px-5 py-3">
            {existing && !readOnly && (
              <div className="mr-auto flex gap-1">
                <Button type="button" variant="ghost" size="sm" onClick={onDuplicate} disabled={saving}>
                  <Copy className="size-4" /> Duplicate
                </Button>
                <Button type="button" variant="ghost" size="sm" onClick={() => setConfirmDelete(true)} disabled={saving}>
                  <Trash2 className="size-4" /> Delete
                </Button>
              </div>
            )}
            <Button type="button" variant="ghost" onClick={onClose} disabled={saving}>
              {readOnly ? "Close" : "Cancel"}
            </Button>
            {!readOnly && (
              <Button type="button" onClick={onSave} disabled={saving}>
                {saving ? <Loader2 className="size-4 animate-spin" /> : null} {existing ? "Save" : "Add to schedule"}
              </Button>
            )}
          </SheetFooter>
        </SheetContent>
      </Sheet>

      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete “{existing?.title}”?</AlertDialogTitle>
            <AlertDialogDescription>
              It is removed from the itinerary. {existing?.crm_meeting_id ? "The CRM meeting is not affected. " : ""}This
              can&apos;t be undone — to keep a record, mark it Cancelled instead.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep it</AlertDialogCancel>
            <AlertDialogAction onClick={onDelete}>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

/** "Eastern" for the home zone, else the option label or the raw zone. */
export function zoneLabel(tz: string): string {
  if (tz === HOME_TZ) return "Eastern"
  return TIMEZONE_OPTIONS.find((z) => z.value === tz)?.label ?? tz
}
