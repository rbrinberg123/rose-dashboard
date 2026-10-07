"use client"

/**
 * Attendees tab.
 *   - People grouped Client · Rose · External, with role, "full itinerary"
 *     and a flag for anyone without an email (they can't get invites).
 *   - Add from CRM Contacts (this client's first; search everyone), from Rose
 *     staff, or as a one-off.
 *   - Attendance grid: people × items; tick to put someone in an item.
 *     "Assign travelling party to all items" in one click.
 */

import * as React from "react"
import { AlertTriangle, Loader2, Pencil, Search, Trash2, UserPlus, UsersRound } from "lucide-react"
import { toast } from "sonner"

import { SegmentedToggle } from "@/components/segmented-toggle"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { CARD_CLASS, STATUS_PILL_LIGHT, TEXT_MUTED } from "@/lib/design"
import { formatDay, formatTime } from "@/lib/events-planner/core"
import {
  ATTENDEE_ROLES,
  ATTENDEE_SIDES,
  type AttendeeInput,
  type AttendeeRole,
  type AttendeeSide,
  type BuilderAttendee,
  type ContactSearchRow,
  type StaffOption,
} from "@/lib/events-planner/types"
import { useBuilder } from "./builder-context"
import {
  addAttendees,
  assignTravellingParty,
  deleteAttendee,
  loadStaffOptions,
  searchContacts,
  toggleItemAttendee,
  updateAttendee,
} from "./builder-actions"

const SELECT_CLASS = "h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm"
const roleLabel = (r: string) => ATTENDEE_ROLES.find((x) => x.value === r)?.label ?? r

function NoEmail() {
  return (
    <span className="inline-flex items-center gap-1 text-xs" style={{ color: STATUS_PILL_LIGHT.watch.text }}>
      <AlertTriangle className="size-3" /> No email — can&apos;t get invites
    </span>
  )
}

export function AttendeesTab() {
  const { itin, readOnly, mutate, setItin, removeAttendee } = useBuilder()
  const [adding, setAdding] = React.useState(false)
  const [editing, setEditing] = React.useState<BuilderAttendee | null>(null)
  const [busyParty, setBusyParty] = React.useState(false)

  const missingEmail = itin.attendees.filter((a) => !a.email).length

  async function onRemove(a: BuilderAttendee) {
    const r = await mutate(
      (s) => ({
        ...s,
        attendees: s.attendees.filter((x) => x.id !== a.id),
        items: s.items.map((i) => ({ ...i, attendee_ids: i.attendee_ids.filter((x) => x !== a.id) })),
      }),
      () => deleteAttendee(a.id),
      () => removeAttendee(a.id),
    )
    if (r.ok) toast.success(`${a.full_name} removed`)
  }

  async function onParty() {
    setBusyParty(true)
    const r = await mutate(null, () => assignTravellingParty(itin.id), (d) =>
      setItin((s) => ({
        ...s,
        items: s.items.map((i) => {
          const add = d.pairs.filter((p) => p.item_id === i.id).map((p) => p.attendee_id)
          return add.length ? { ...i, attendee_ids: [...new Set([...i.attendee_ids, ...add])] } : i
        }),
      })),
    )
    setBusyParty(false)
    if (r.ok) toast.success("Travelling party assigned to every item")
  }

  return (
    <div className="space-y-4">
      <div className={`${CARD_CLASS} p-4`}>
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <div className="mr-auto">
            <div className="text-sm font-semibold">People ({itin.attendees.length})</div>
            {missingEmail > 0 && (
              <div className="text-xs" style={{ color: STATUS_PILL_LIGHT.watch.text }}>
                {missingEmail} without an email — they can&apos;t receive calendar invites.
              </div>
            )}
          </div>
          {!readOnly && (
            <>
              <Button variant="outline" size="sm" onClick={onParty} disabled={busyParty}>
                {busyParty ? <Loader2 className="size-4 animate-spin" /> : <UsersRound className="size-4" />} Assign travelling
                party to all items
              </Button>
              <Button size="sm" onClick={() => setAdding(true)}>
                <UserPlus className="size-4" /> Add attendee
              </Button>
            </>
          )}
        </div>

        {itin.attendees.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border px-6 py-10 text-center text-sm text-muted-foreground">
            No attendees yet. Add client executives, Rose staff and investors.
          </div>
        ) : (
          <div className="grid gap-4">
            {ATTENDEE_SIDES.map((side) => {
              const people = itin.attendees.filter((a) => a.side === side.value)
              if (!people.length) return null
              return (
                <div key={side.value}>
                  <div className="mb-1 text-xs font-semibold uppercase tracking-wide" style={{ color: TEXT_MUTED }}>
                    {side.label} ({people.length})
                  </div>
                  <div className="divide-y divide-border rounded-lg border border-border">
                    {people.map((a) => (
                      <div key={a.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-3 py-2 text-sm">
                        <div className="min-w-48 flex-1">
                          <div className="font-medium">
                            {a.full_name}
                            {a.crm_contact_id && (
                              <span className="ml-1.5 rounded px-1 text-[10px] font-normal" style={{ background: STATUS_PILL_LIGHT.new.bg, color: STATUS_PILL_LIGHT.new.text }}>
                                CRM
                              </span>
                            )}
                          </div>
                          <div className="text-xs text-muted-foreground">
                            {[a.title, a.company].filter(Boolean).join(" · ") || "—"}
                          </div>
                        </div>
                        <div className="w-60 min-w-0 truncate text-xs">{a.email ? <span className="text-muted-foreground">{a.email}</span> : <NoEmail />}</div>
                        <div className="w-28 text-xs text-muted-foreground">{a.phone ?? ""}</div>
                        <div className="w-32 text-xs">{roleLabel(a.role)}</div>
                        <div className="w-28 text-xs text-muted-foreground">{a.receives_full_itinerary ? "Full itinerary" : "Own items only"}</div>
                        {!readOnly && (
                          <div className="flex gap-1">
                            <Button variant="ghost" size="icon-sm" onClick={() => setEditing(a)} aria-label="Edit">
                              <Pencil className="size-3.5" />
                            </Button>
                            <Button variant="ghost" size="icon-sm" onClick={() => onRemove(a)} aria-label="Remove">
                              <Trash2 className="size-3.5" />
                            </Button>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      <AttendanceMatrix />

      {adding && <AddAttendeeDialog onClose={() => setAdding(false)} />}
      {editing && <EditAttendeeDialog attendee={editing} onClose={() => setEditing(null)} />}
    </div>
  )
}

/* ========================================================== attendance grid */

function AttendanceMatrix() {
  const { itin, readOnly, mutate } = useBuilder()
  const items = itin.items.filter((i) => i.status !== "cancelled")
  if (!itin.attendees.length || !items.length) return null

  const dayOf = (dayId: string) => itin.days.find((d) => d.id === dayId)

  async function toggle(itemId: string, attendeeId: string, on: boolean) {
    await mutate(
      (s) => ({
        ...s,
        items: s.items.map((i) =>
          i.id !== itemId
            ? i
            : { ...i, attendee_ids: on ? [...new Set([...i.attendee_ids, attendeeId])] : i.attendee_ids.filter((x) => x !== attendeeId) },
        ),
      }),
      () => toggleItemAttendee(itemId, attendeeId, on),
    )
  }

  return (
    <div className={`${CARD_CLASS} p-4`}>
      <div className="mb-2 text-sm font-semibold">Who attends what</div>
      <div className="overflow-x-auto">
        <table className="border-separate border-spacing-0 text-xs">
          <thead>
            <tr>
              <th className="sticky left-0 z-10 min-w-48 bg-white px-2 py-1 text-left font-medium">Attendee</th>
              {items.map((i) => {
                const d = dayOf(i.day_id)
                return (
                  <th key={i.id} className="w-24 min-w-24 border-l border-border px-1.5 py-1 text-left align-bottom font-normal">
                    <div className="text-[10px]" style={{ color: TEXT_MUTED }}>
                      {d ? formatDay(d.date) : ""} · {formatTime(i.start_at, i.timezone)}
                    </div>
                    <div className="line-clamp-2 font-medium" title={i.title}>
                      {i.title}
                    </div>
                  </th>
                )
              })}
            </tr>
          </thead>
          <tbody>
            {itin.attendees.map((a) => (
              <tr key={a.id} className="hover:bg-muted/30">
                <td className="sticky left-0 z-10 border-t border-border bg-white px-2 py-1.5">
                  <div className="font-medium">{a.full_name}</div>
                  <div className="text-[10px] text-muted-foreground">{roleLabel(a.role)}</div>
                </td>
                {items.map((i) => (
                  <td key={i.id} className="border-l border-t border-border text-center">
                    <Checkbox
                      disabled={readOnly}
                      checked={i.attendee_ids.includes(a.id)}
                      onCheckedChange={(c) => toggle(i.id, a.id, c === true)}
                      aria-label={`${a.full_name} in ${i.title}`}
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="mt-2 text-[11px]" style={{ color: TEXT_MUTED }}>
        Times are each item&apos;s local time (Eastern unless its day is in another city). Cancelled items are hidden.
      </div>
    </div>
  )
}

/* ============================================================ add / edit */

type Source = "crm" | "staff" | "oneoff"

const blankInput = (): AttendeeInput => ({
  crmContactId: null,
  fullName: "",
  email: "",
  phone: "",
  title: "",
  company: "",
  role: "investor",
  side: "external",
  receivesFullItinerary: false,
})

function AttendeeFields({ v, set }: { v: AttendeeInput; set: (p: Partial<AttendeeInput>) => void }) {
  return (
    <div className="grid grid-cols-2 gap-3">
      <div className="col-span-2 grid gap-1.5">
        <Label>Name</Label>
        <Input value={v.fullName} onChange={(e) => set({ fullName: e.target.value })} disabled={!!v.crmContactId} />
      </div>
      <div className="grid gap-1.5">
        <Label>Email</Label>
        <Input value={v.email} onChange={(e) => set({ email: e.target.value })} />
      </div>
      <div className="grid gap-1.5">
        <Label>Phone</Label>
        <Input value={v.phone} onChange={(e) => set({ phone: e.target.value })} />
      </div>
      <div className="grid gap-1.5">
        <Label>Title</Label>
        <Input value={v.title} onChange={(e) => set({ title: e.target.value })} />
      </div>
      <div className="grid gap-1.5">
        <Label>Company</Label>
        <Input value={v.company} onChange={(e) => set({ company: e.target.value })} />
      </div>
      <div className="grid gap-1.5">
        <Label>Role</Label>
        <select
          value={v.role}
          onChange={(e) => {
            const role = e.target.value as AttendeeRole
            const side = ATTENDEE_ROLES.find((r) => r.value === role)!.side
            set({ role, side, receivesFullItinerary: side !== "external" })
          }}
          className={SELECT_CLASS}
        >
          {ATTENDEE_ROLES.map((r) => (
            <option key={r.value} value={r.value}>
              {r.label}
            </option>
          ))}
        </select>
      </div>
      <div className="grid gap-1.5">
        <Label>Side</Label>
        <select value={v.side} onChange={(e) => set({ side: e.target.value as AttendeeSide })} className={SELECT_CLASS}>
          {ATTENDEE_SIDES.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </select>
      </div>
      <label className="col-span-2 flex items-center gap-2 text-sm">
        <Checkbox checked={v.receivesFullItinerary} onCheckedChange={(c) => set({ receivesFullItinerary: c === true })} />
        Gets the full itinerary (part of the travelling party)
      </label>
    </div>
  )
}

function AddAttendeeDialog({ onClose }: { onClose: () => void }) {
  const { itin, mutate, upsertAttendees } = useBuilder()
  const [source, setSource] = React.useState<Source>("crm")
  const [q, setQ] = React.useState("")
  const [contacts, setContacts] = React.useState<ContactSearchRow[] | null>(null)
  const [staff, setStaff] = React.useState<StaffOption[] | null>(null)
  const [picked, setPicked] = React.useState<Map<string, AttendeeInput>>(new Map())
  const [oneOff, setOneOff] = React.useState<AttendeeInput>(blankInput())
  const [pending, setPending] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  const onItin = React.useMemo(
    () => new Set(itin.attendees.map((a) => a.crm_contact_id ?? `email:${(a.email ?? "").toLowerCase()}`)),
    [itin.attendees],
  )

  React.useEffect(() => {
    if (source !== "crm") return
    let live = true
    const t = setTimeout(() => {
      searchContacts(q, itin.client_company_id).then((r) => {
        if (!live) return
        if (r.ok) setContacts(r.data)
        else setError(r.error)
      })
    }, 250)
    return () => {
      live = false
      clearTimeout(t)
    }
  }, [source, q, itin.client_company_id])

  React.useEffect(() => {
    if (source !== "staff" || staff) return
    loadStaffOptions().then((r) => (r.ok ? setStaff(r.data) : setError(r.error)))
  }, [source, staff])

  const isClient = (company: string | null) =>
    !!company && !!itin.client_name && company.trim().toLowerCase() === itin.client_name.trim().toLowerCase()

  function togglePick(key: string, input: AttendeeInput | null) {
    setPicked((m) => {
      const n = new Map(m)
      if (input) n.set(key, input)
      else n.delete(key)
      return n
    })
  }

  async function onAdd() {
    setError(null)
    const list = source === "oneoff" ? [oneOff] : [...picked.values()]
    if (!list.length) return setError("Pick someone to add.")
    setPending(true)
    const r = await mutate(null, () => addAttendees(itin.id, list), (d) => upsertAttendees(d.attendees))
    setPending(false)
    if (!r.ok) return setError(r.error)
    toast.success(`Added ${r.data.attendees.length} ${r.data.attendees.length === 1 ? "person" : "people"}`)
    onClose()
  }

  const staffShown = (staff ?? []).filter((u) => {
    const t = q.trim().toLowerCase()
    return !t || `${u.display_name} ${u.email}`.toLowerCase().includes(t)
  })

  return (
    <Dialog open onOpenChange={(o) => !o && !pending && onClose()}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Add attendees</DialogTitle>
          <DialogDescription>From the CRM, from Rose staff, or a one-off person not in the CRM.</DialogDescription>
        </DialogHeader>
        <SegmentedToggle
          value={source}
          onChange={(v) => {
            setSource(v)
            setPicked(new Map())
            setQ("")
            setError(null)
          }}
          options={[
            { value: "crm", label: "CRM contacts" },
            { value: "staff", label: "Rose staff" },
            { value: "oneoff", label: "One-off" },
          ]}
        />

        {source === "oneoff" ? (
          <AttendeeFields v={oneOff} set={(p) => setOneOff((x) => ({ ...x, ...p }))} />
        ) : (
          <div className="grid gap-2">
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                autoFocus
                value={q}
                onChange={(e) => setQ(e.target.value)}
                className="pl-8"
                placeholder={source === "crm" ? "Search contacts by name, email or company" : "Search Rose staff"}
              />
            </div>
            {source === "crm" && !q.trim() && (
              <div className="text-xs text-muted-foreground">
                {itin.client_name ? `${itin.client_name}'s contacts. Type to search everyone (investors too).` : "Type to search CRM contacts."}
              </div>
            )}
            <div className="max-h-[45vh] divide-y divide-border overflow-y-auto rounded-md border border-border">
              {source === "crm" ? (
                contacts == null ? (
                  <div className="flex items-center gap-2 px-3 py-6 text-sm text-muted-foreground">
                    <Loader2 className="size-4 animate-spin" /> Loading…
                  </div>
                ) : contacts.length === 0 ? (
                  <div className="px-3 py-6 text-sm text-muted-foreground">No contacts match.</div>
                ) : (
                  contacts.map((c) => {
                    const already = onItin.has(c.contact_id)
                    const p = picked.get(c.contact_id)
                    const client = isClient(c.company)
                    return (
                      <div key={c.contact_id} className={`flex items-center gap-2 px-2.5 py-1.5 text-sm ${already ? "opacity-50" : ""}`}>
                        <Checkbox
                          disabled={already}
                          checked={already || !!p}
                          onCheckedChange={(on) =>
                            togglePick(
                              c.contact_id,
                              on === true
                                ? {
                                    crmContactId: c.contact_id,
                                    fullName: c.full_name ?? "",
                                    email: c.email ?? "",
                                    phone: c.mobile_phone ?? c.direct_phone ?? "",
                                    title: c.job_title ?? "",
                                    company: c.company ?? "",
                                    role: client ? "client_executive" : "investor",
                                    side: client ? "client" : "external",
                                    receivesFullItinerary: client,
                                  }
                                : null,
                            )
                          }
                        />
                        <span className="min-w-0 flex-1 truncate">
                          <span className="font-medium">{c.full_name ?? "(no name)"}</span>
                          <span className="text-muted-foreground">
                            {c.job_title ? ` · ${c.job_title}` : ""}
                            {c.company ? ` · ${c.company}` : ""}
                          </span>
                        </span>
                        {already ? (
                          <span className="text-xs text-muted-foreground">Already added</span>
                        ) : p ? (
                          <select
                            value={p.role}
                            onChange={(e) => {
                              const role = e.target.value as AttendeeRole
                              const side = ATTENDEE_ROLES.find((r) => r.value === role)!.side
                              togglePick(c.contact_id, { ...p, role, side, receivesFullItinerary: side !== "external" })
                            }}
                            className="h-7 rounded-md border border-input bg-transparent px-1.5 text-xs"
                          >
                            {ATTENDEE_ROLES.map((r) => (
                              <option key={r.value} value={r.value}>
                                {r.label}
                              </option>
                            ))}
                          </select>
                        ) : c.email ? null : (
                          <NoEmail />
                        )}
                      </div>
                    )
                  })
                )
              ) : staff == null ? (
                <div className="flex items-center gap-2 px-3 py-6 text-sm text-muted-foreground">
                  <Loader2 className="size-4 animate-spin" /> Loading…
                </div>
              ) : (
                staffShown.map((u) => {
                  const key = `email:${(u.email ?? "").toLowerCase()}`
                  const already = onItin.has(key)
                  return (
                    <label key={u.user_id} className={`flex items-center gap-2 px-2.5 py-1.5 text-sm ${already ? "opacity-50" : "cursor-pointer"}`}>
                      <Checkbox
                        disabled={already}
                        checked={already || picked.has(key)}
                        onCheckedChange={(on) =>
                          togglePick(
                            key,
                            on === true
                              ? {
                                  crmContactId: null,
                                  fullName: u.display_name ?? u.email ?? "",
                                  email: u.email ?? "",
                                  phone: "",
                                  title: "",
                                  company: "Rose & Company",
                                  role: "rose_staff",
                                  side: "internal",
                                  receivesFullItinerary: true,
                                }
                              : null,
                          )
                        }
                      />
                      <span className="flex-1 truncate font-medium">{u.display_name}</span>
                      <span className="truncate text-xs text-muted-foreground">{already ? "Already added" : u.email}</span>
                    </label>
                  )
                })
              )}
            </div>
            {picked.size > 0 && <div className="text-xs text-muted-foreground">{picked.size} selected</div>}
          </div>
        )}

        {error && <div className="text-sm text-destructive">{error}</div>}
        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button onClick={onAdd} disabled={pending}>
            {pending ? <Loader2 className="size-4 animate-spin" /> : null} Add
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function EditAttendeeDialog({ attendee, onClose }: { attendee: BuilderAttendee; onClose: () => void }) {
  const { mutate, upsertAttendees } = useBuilder()
  const [v, setV] = React.useState<AttendeeInput>({
    crmContactId: attendee.crm_contact_id,
    fullName: attendee.full_name,
    email: attendee.email ?? "",
    phone: attendee.phone ?? "",
    title: attendee.title ?? "",
    company: attendee.company ?? "",
    role: attendee.role,
    side: attendee.side,
    receivesFullItinerary: attendee.receives_full_itinerary,
  })
  const [pending, setPending] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  async function onSave() {
    setPending(true)
    const r = await mutate(null, () => updateAttendee(attendee.id, v), (d) => upsertAttendees([d.attendee]))
    setPending(false)
    if (!r.ok) return setError(r.error)
    toast.success("Saved")
    onClose()
  }

  return (
    <Dialog open onOpenChange={(o) => !o && !pending && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Edit {attendee.full_name}</DialogTitle>
          <DialogDescription>
            {attendee.crm_contact_id
              ? "From the CRM. Changes here apply to this itinerary only — the CRM contact is not changed."
              : "A one-off attendee on this itinerary."}
          </DialogDescription>
        </DialogHeader>
        <AttendeeFields v={v} set={(p) => setV((x) => ({ ...x, ...p }))} />
        {error && <div className="text-sm text-destructive">{error}</div>}
        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button onClick={onSave} disabled={pending}>
            {pending ? <Loader2 className="size-4 animate-spin" /> : null} Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
