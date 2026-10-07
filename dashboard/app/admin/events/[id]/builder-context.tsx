"use client"

/**
 * The builder's in-browser copy of the itinerary. Edits apply here at once
 * (optimistic) and are replaced by the server's fresh rows when the action
 * returns — or rolled back if it fails. One itinerary is small (a five-day
 * roadshow is ~40 items / 25 people), so plain state is plenty.
 */

import * as React from "react"
import { toast } from "sonner"

import type { ActionResult } from "@/lib/actions"
import { checkSchedule, type Issue } from "@/lib/events-planner/core"
import type {
  BuilderAttendee,
  BuilderBlock,
  BuilderDay,
  BuilderItem,
  BuilderItinerary,
  CrossBooking,
  ItineraryStatus,
  TypeOption,
} from "@/lib/events-planner/types"
import { loadCrossBookings } from "./builder-actions"

/** Where "jump to" should land: a block or item on the Schedule tab. */
export type Focus = { seq: number; dayId: string | null; itemId: string | null; blockId: string | null }

type Ctx = {
  itin: BuilderItinerary
  meetingTypes: TypeOption[]
  eventTypes: TypeOption[]
  readOnly: boolean
  /** A travel-time estimator is configured (GOOGLE_MAPS_API_KEY). */
  canEstimate: boolean
  /** Every schedule check, re-run on each change. */
  issues: Issue[]
  focus: Focus | null
  jumpTo: (issue: Pick<Issue, "dayId" | "itemId" | "blockId">) => void
  upsertBlocks: (blocks: BuilderBlock[]) => void
  removeBlock: (id: string) => void
  setItin: React.Dispatch<React.SetStateAction<BuilderItinerary>>
  upsertItems: (items: BuilderItem[]) => void
  removeItems: (ids: string[]) => void
  upsertDay: (day: BuilderDay) => void
  removeDay: (id: string) => void
  upsertAttendees: (a: BuilderAttendee[]) => void
  removeAttendee: (id: string) => void
  setStatus: (s: ItineraryStatus) => void
  /**
   * Apply `optimistic` now, run `action`, then `onOk` with the result — or roll
   * back to the state before and toast the error. Returns the result.
   */
  mutate: <T extends { status?: ItineraryStatus }>(
    optimistic: ((s: BuilderItinerary) => BuilderItinerary) | null,
    action: () => Promise<ActionResult<T>>,
    onOk?: (data: T) => void,
    failTitle?: string,
  ) => Promise<ActionResult<T>>
}

const BuilderCtx = React.createContext<Ctx | null>(null)

export function useBuilder(): Ctx {
  const c = React.useContext(BuilderCtx)
  if (!c) throw new Error("useBuilder outside BuilderProvider")
  return c
}

const byStart = (a: BuilderItem, b: BuilderItem) => a.start_at.localeCompare(b.start_at) || a.sort_order - b.sort_order

export function BuilderProvider({
  initial,
  meetingTypes,
  eventTypes,
  readOnly,
  canEstimate,
  onJump,
  children,
}: {
  initial: BuilderItinerary
  meetingTypes: TypeOption[]
  eventTypes: TypeOption[]
  readOnly: boolean
  canEstimate: boolean
  /** Called on jump-to so the view can switch to the Schedule tab. */
  onJump?: () => void
  children: React.ReactNode
}) {
  const [itin, setItin] = React.useState(initial)
  const [focus, setFocus] = React.useState<Focus | null>(null)
  const [cross, setCross] = React.useState<CrossBooking[]>([])

  // The cross-itinerary double-booking check needs the server; re-run it
  // (debounced) whenever who-is-where or when changes.
  const crossKey = React.useMemo(
    () =>
      JSON.stringify([
        itin.attendees.map((a) => [a.id, a.email, a.crm_contact_id]),
        itin.items.map((i) => [i.id, i.start_at, i.end_at, i.status, i.attendee_ids]),
      ]),
    [itin.attendees, itin.items],
  )
  React.useEffect(() => {
    let live = true
    const t = setTimeout(() => {
      loadCrossBookings(itin.id).then((r) => {
        if (live && r.ok) setCross(r.data)
      })
    }, 800)
    return () => {
      live = false
      clearTimeout(t)
    }
  }, [itin.id, crossKey])

  const issues = React.useMemo(
    () =>
      checkSchedule({
        days: itin.days,
        items: itin.items.filter((i) => !i.id.startsWith("tmp-")),
        attendees: itin.attendees,
        blocks: itin.blocks,
        airportLeadMinutes: itin.airport_lead_minutes,
        crossBookings: cross,
      }),
    [itin.days, itin.items, itin.attendees, itin.blocks, itin.airport_lead_minutes, cross],
  )
  const latest = React.useRef(itin)
  React.useEffect(() => {
    latest.current = itin
  }, [itin])

  const value = React.useMemo<Ctx>(() => {
    const upsertItems = (items: BuilderItem[]) =>
      setItin((s) => {
        const ids = new Set(items.map((i) => i.id))
        return { ...s, items: [...s.items.filter((i) => !ids.has(i.id)), ...items].sort(byStart) }
      })
    const removeItems = (ids: string[]) =>
      setItin((s) => ({ ...s, items: s.items.filter((i) => !ids.includes(i.id)) }))
    const upsertDay = (day: BuilderDay) =>
      setItin((s) => {
        const days = [...s.days.filter((d) => d.id !== day.id), day].sort((a, b) => a.date.localeCompare(b.date))
        return { ...s, days, start_date: days[0].date, end_date: days[days.length - 1].date }
      })
    const removeDay = (id: string) =>
      setItin((s) => {
        const days = s.days.filter((d) => d.id !== id)
        return {
          ...s,
          days,
          items: s.items.filter((i) => i.day_id !== id),
          blocks: s.blocks.filter((b) => b.day_id !== id),
          start_date: days[0]?.date ?? s.start_date,
          end_date: days[days.length - 1]?.date ?? s.end_date,
        }
      })
    const upsertAttendees = (list: BuilderAttendee[]) =>
      setItin((s) => {
        const ids = new Set(list.map((a) => a.id))
        return { ...s, attendees: [...s.attendees.filter((a) => !ids.has(a.id)), ...list].sort((a, b) => a.sort_order - b.sort_order) }
      })
    const removeAttendee = (id: string) =>
      setItin((s) => ({
        ...s,
        attendees: s.attendees.filter((a) => a.id !== id),
        items: s.items.map((i) => (i.attendee_ids.includes(id) ? { ...i, attendee_ids: i.attendee_ids.filter((x) => x !== id) } : i)),
      }))
    const upsertBlocks = (blocks: BuilderBlock[]) =>
      setItin((s) => {
        const ids = new Set(blocks.map((b) => b.id))
        return { ...s, blocks: [...s.blocks.filter((b) => !ids.has(b.id)), ...blocks].sort((a, b) => a.start_at.localeCompare(b.start_at)) }
      })
    const removeBlock = (id: string) =>
      setItin((s) => ({
        ...s,
        blocks: s.blocks.filter((b) => b.id !== id),
        items: s.items.map((i) => (i.availability_block_id === id ? { ...i, availability_block_id: null } : i)),
      }))
    const jumpTo: Ctx["jumpTo"] = (issue) => {
      onJump?.()
      setFocus((f) => ({ seq: (f?.seq ?? 0) + 1, dayId: issue.dayId ?? null, itemId: issue.itemId ?? null, blockId: issue.blockId ?? null }))
    }
    const setStatus = (status: ItineraryStatus) => setItin((s) => (s.status === status ? s : { ...s, status }))

    const mutate: Ctx["mutate"] = async (optimistic, action, onOk, failTitle = "Could not save") => {
      const before = latest.current
      if (optimistic) setItin(optimistic)
      const r = await action()
      if (!r.ok) {
        setItin(before)
        toast.error(failTitle, { description: r.error })
        return r
      }
      onOk?.(r.data)
      if (r.data && typeof r.data === "object" && "status" in r.data && r.data.status) setStatus(r.data.status)
      return r
    }

    return {
      itin,
      meetingTypes,
      eventTypes,
      readOnly,
      canEstimate,
      issues,
      focus,
      jumpTo,
      upsertBlocks,
      removeBlock,
      setItin,
      upsertItems,
      removeItems,
      upsertDay,
      removeDay,
      upsertAttendees,
      removeAttendee,
      setStatus,
      mutate,
    }
  }, [itin, meetingTypes, eventTypes, readOnly, canEstimate, issues, focus, onJump])

  return <BuilderCtx.Provider value={value}>{children}</BuilderCtx.Provider>
}
