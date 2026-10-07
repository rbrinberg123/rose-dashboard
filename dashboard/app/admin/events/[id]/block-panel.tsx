"use client"

/**
 * The right-hand panel for an AVAILABILITY BLOCK — a bookable window on a day
 * ("Fidelity, 9:00–12:00, their office") that meetings are booked into.
 * Same pattern as the item panel: optimistic save, server copy replaces it.
 *
 * Location set here is inherited by meetings booked into the block.
 */

import * as React from "react"
import { Loader2, Trash2 } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { Textarea } from "@/components/ui/textarea"
import { FormSection } from "@/components/crm-form-kit"
import { TEXT_MUTED } from "@/lib/design"
import { blockCapacity, capacityText, dualTime, formatDay, isoToZoned, resolveTimes } from "@/lib/events-planner/core"
import type { BlockInput, BuilderBlock, BuilderDay } from "@/lib/events-planner/types"
import { useBuilder } from "./builder-context"
import { deleteBlock, saveBlock } from "./builder-actions"
import { zoneLabel } from "./item-panel"

export type BlockTarget = { kind: "edit"; blockId: string } | { kind: "new"; draft: BlockInput } | null

/** A new block on `day`: 9:00–12:00, 30-min slots, 5-min buffer, hard. */
export function newBlockDraft(day: BuilderDay): BlockInput {
  return {
    dayId: day.id,
    startTime: "09:00",
    endTime: "12:00",
    label: "",
    hostInstitutionName: "",
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
    defaultSlotMinutes: 30,
    defaultBufferMinutes: 5,
    blockType: "hard",
    notesInternal: "",
    notesExternal: "",
  }
}

const s = (v: string | null) => v ?? ""

function draftFromBlock(b: BuilderBlock): BlockInput {
  return {
    dayId: b.day_id,
    startTime: isoToZoned(b.start_at, b.timezone).time,
    endTime: isoToZoned(b.end_at, b.timezone).time,
    label: s(b.label),
    hostInstitutionName: s(b.host_institution_name),
    venueName: s(b.venue_name),
    addressLine1: s(b.address_line1),
    addressLine2: s(b.address_line2),
    city: s(b.city),
    state: s(b.state),
    postalCode: s(b.postal_code),
    country: s(b.country),
    roomOrFloor: s(b.room_or_floor),
    atInvestorOffice: b.at_investor_office,
    videoUrl: s(b.video_url),
    dialIn: s(b.dial_in),
    dialInPasscode: s(b.dial_in_passcode),
    defaultSlotMinutes: b.default_slot_minutes,
    defaultBufferMinutes: b.default_buffer_minutes,
    blockType: b.block_type,
    notesInternal: s(b.notes_internal),
    notesExternal: s(b.notes_external),
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

const SELECT_CLASS = "h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm"

export function BlockPanel({ target, onClose }: { target: BlockTarget; onClose: () => void }) {
  const { itin, readOnly, mutate, upsertBlocks, removeBlock } = useBuilder()
  const existing = target?.kind === "edit" ? itin.blocks.find((b) => b.id === target.blockId) ?? null : null
  const initial = React.useMemo(
    () => (target?.kind === "new" ? target.draft : existing ? draftFromBlock(existing) : null),
    // Re-seed only when a different block / new draft is opened.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [target],
  )
  const [d, setD] = React.useState<BlockInput | null>(initial)
  const [seed, setSeed] = React.useState(initial)
  const [error, setError] = React.useState<string | null>(null)
  const [saving, setSaving] = React.useState(false)
  const [confirmDelete, setConfirmDelete] = React.useState(false)
  if (seed !== initial) {
    setSeed(initial)
    setD(initial)
    setError(null)
    setConfirmDelete(false)
  }
  if (!d) return <Sheet open={false} onOpenChange={onClose} />

  const set = (p: Partial<BlockInput>) => setD((x) => (x ? { ...x, ...p } : x))
  const day = itin.days.find((x) => x.id === d.dayId) ?? itin.days[0]
  const times = resolveTimes({ dayDate: day.date, dayTz: day.timezone, startTime: d.startTime, endTime: d.endTime })
  const cap =
    existing && times.ok
      ? blockCapacity(
          { ...existing, start_at: times.startIso, end_at: times.endIso, default_slot_minutes: d.defaultSlotMinutes, default_buffer_minutes: d.defaultBufferMinutes },
          itin.items,
        )
      : null

  async function onSave() {
    if (!d || readOnly) return
    setError(null)
    if (!times.ok) return setError(times.error)
    setSaving(true)
    const r = await mutate(null, () => saveBlock(itin.id, existing?.id ?? null, d), (data) => upsertBlocks([data.block]))
    setSaving(false)
    if (!r.ok) return setError(r.error)
    toast.success(existing ? "Block saved" : "Block added")
    onClose()
  }

  async function onDelete() {
    if (!existing) return
    onClose()
    const r = await mutate(
      (st) => ({
        ...st,
        blocks: st.blocks.filter((b) => b.id !== existing.id),
        items: st.items.map((i) => (i.availability_block_id === existing.id ? { ...i, availability_block_id: null } : i)),
      }),
      () => deleteBlock(existing.id),
      () => removeBlock(existing.id),
    )
    if (r.ok) toast.success("Block deleted — its meetings stay on the schedule")
  }

  return (
    <Sheet open={!!target} onOpenChange={(o) => !o && !saving && onClose()}>
      <SheetContent side="right" className="w-full gap-0 p-0 sm:max-w-xl">
        <SheetHeader className="border-b border-border px-5 py-4">
          <SheetTitle>{existing ? "Edit availability block" : "New availability block"}</SheetTitle>
          <SheetDescription>
            A window of time a host has given us, to fill with meetings. {formatDay(day.date)} · {zoneLabel(day.timezone)} time.
          </SheetDescription>
        </SheetHeader>

        <fieldset disabled={readOnly || saving} className="grid flex-1 content-start gap-4 overflow-y-auto px-5 py-4">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Host (who gave us the time)">
              <Input value={d.hostInstitutionName} onChange={(e) => set({ hostInstitutionName: e.target.value })} placeholder="e.g. Fidelity" autoFocus={!existing} />
            </Field>
            <Field label="Label">
              <Input value={d.label} onChange={(e) => set({ label: e.target.value })} placeholder="e.g. Fidelity — AM session" />
            </Field>
          </div>

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
              <Input type="time" value={d.startTime} onChange={(e) => set({ startTime: e.target.value })} />
            </Field>
            <Field label="End">
              <Input type="time" value={d.endTime} onChange={(e) => set({ endTime: e.target.value })} />
            </Field>
          </div>
          <div className="-mt-2 text-xs" style={{ color: TEXT_MUTED }}>
            {times.ok ? `${dualTime(times.startIso, day.timezone)} → ${dualTime(times.endIso, day.timezone)}` : <span className="text-destructive">{times.error}</span>}
          </div>

          <div className="grid grid-cols-3 gap-3">
            <Field label="Slot length (min)">
              <Input type="number" min={5} max={600} step={5} value={d.defaultSlotMinutes} onChange={(e) => set({ defaultSlotMinutes: Number(e.target.value) })} />
            </Field>
            <Field label="Buffer between (min)">
              <Input type="number" min={0} max={240} value={d.defaultBufferMinutes} onChange={(e) => set({ defaultBufferMinutes: Number(e.target.value) })} />
            </Field>
            <Field label="Type">
              <select value={d.blockType} onChange={(e) => set({ blockType: e.target.value as "hard" | "soft" })} className={SELECT_CLASS}>
                <option value="hard">Hard — must fit inside</option>
                <option value="soft">Soft — guideline</option>
              </select>
            </Field>
          </div>
          {cap && <div className="-mt-2 text-xs" style={{ color: TEXT_MUTED }}>{capacityText(cap)} · ~{cap.capacity} slots in total</div>}

          <FormSection title="Location — booked meetings inherit it">
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
            <label className="flex items-center gap-2 text-sm">
              <Checkbox checked={d.atInvestorOffice} onCheckedChange={(c) => set({ atInvestorOffice: c === true })} />
              At the investor&apos;s office
            </label>
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

          <FormSection title="Notes">
            <Field label="External notes — copied to meetings booked in this block">
              <Textarea rows={2} value={d.notesExternal} onChange={(e) => set({ notesExternal: e.target.value })} />
            </Field>
            <Field label="Internal notes — never shown outside Rose">
              <Textarea rows={2} value={d.notesInternal} onChange={(e) => set({ notesInternal: e.target.value })} />
            </Field>
          </FormSection>
          <div className="text-xs" style={{ color: TEXT_MUTED }}>
            Blocks are planning scaffolding: the client PDF shows only the booked meetings, never empty blocks or open slots.
          </div>
        </fieldset>

        {error && <div className="px-5 pb-2 text-sm text-destructive">{error}</div>}

        <SheetFooter className="flex-row items-center border-t border-border px-5 py-3">
          {existing && !readOnly && (
            <div className="mr-auto">
              {confirmDelete ? (
                <span className="flex items-center gap-2 text-sm">
                  Delete this block?
                  <Button type="button" variant="destructive" size="sm" onClick={onDelete}>
                    Delete
                  </Button>
                  <Button type="button" variant="ghost" size="sm" onClick={() => setConfirmDelete(false)}>
                    Keep
                  </Button>
                </span>
              ) : (
                <Button type="button" variant="ghost" size="sm" onClick={() => setConfirmDelete(true)} disabled={saving}>
                  <Trash2 className="size-4" /> Delete
                </Button>
              )}
            </div>
          )}
          <Button type="button" variant="ghost" onClick={onClose} disabled={saving}>
            {readOnly ? "Close" : "Cancel"}
          </Button>
          {!readOnly && (
            <Button type="button" onClick={onSave} disabled={saving}>
              {saving ? <Loader2 className="size-4 animate-spin" /> : null} {existing ? "Save" : "Add block"}
            </Button>
          )}
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}
