"use client"

/**
 * "Add New Client" + edit — the Clients (accounts) create/edit form, the same
 * pattern as the other six live CRM entities (new-*-dialog.tsx). Writes go
 * through createClient / updateClient in ./actions.ts (gate, audit, re-reads,
 * origin guard via lib/crm-write.ts).
 *
 * Covers the drawer's own fields, grouped like the drawer. NOT here, by design:
 * the ACCOUNT TEAM (deferred source-of-truth decision — the drawer keeps
 * showing it read-only) and Dynamics rollups (last/next touch & event, days
 * since review, last targeting/teaser, current project).
 *
 * See content/docs/20-clients.md and 22-cutover-ownership-boundary.md.
 */

import * as React from "react"
import { useRouter } from "next/navigation"
import { Loader2 } from "lucide-react"
import { toast } from "sonner"

import { AddNewButton, useQuickAddRequest } from "@/components/crm-add-new"
import { PurgeTestButton } from "@/components/purge-test-button"
import { UserCombobox } from "@/components/user-combobox"
import { FormSection, SelectField, TextField, YesNo } from "@/components/crm-form-kit"
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
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import {
  CLIENT_DATES,
  CLIENT_FLAGS,
  CLIENT_PROFILE_FLAGS,
  NEW_CLIENT_TEST_DEFAULT,
  type ClientChoiceOptions,
  type NewClientInput,
} from "@/lib/accounts/create"
import type { UserOption } from "@/lib/types"
import {
  countTestClients,
  createClient,
  loadClientChoiceOptions,
  loadClientContactOptions,
  loadClientEventOptions,
  loadClientForEdit,
  loadClientUserOptions,
  purgeTestClients,
  updateClient,
} from "./actions"

function emptyForm(): NewClientInput {
  return {
    name: "",
    active: true,
    dates: {},
    flags: {},
    isTest: NEW_CLIENT_TEST_DEFAULT,
  }
}

function ClientFormDialog({
  open,
  setOpen,
  initial,
  editId,
  onSaved,
}: {
  open: boolean
  setOpen: (o: boolean) => void
  initial: NewClientInput | null
  editId: string | null
  onSaved: () => void
}) {
  const router = useRouter()
  const [form, setForm] = React.useState<NewClientInput>(() => initial ?? emptyForm())
  const [choices, setChoices] = React.useState<ClientChoiceOptions | null>(null)
  const [users, setUsers] = React.useState<UserOption[] | null>(null)
  const [contacts, setContacts] = React.useState<{ contact_id: string; full_name: string | null }[]>([])
  const [events, setEvents] = React.useState<{ event_id: string; name: string | null }[]>([])
  const [error, setError] = React.useState<string | null>(null)
  const [pending, startTransition] = React.useTransition()
  const set = (p: Partial<NewClientInput>) => setForm((f) => ({ ...f, ...p }))

  React.useEffect(() => {
    if (!open || choices) return
    loadClientChoiceOptions().then((r) => (r.ok ? setChoices(r.data) : setError(r.error)))
    loadClientUserOptions().then((r) => (r.ok ? setUsers(r.data) : setError(r.error)))
    // Primary contact / current event exist only once the client does.
    if (editId) {
      loadClientContactOptions(editId).then((r) => r.ok && setContacts(r.data))
      loadClientEventOptions(editId).then((r) => r.ok && setEvents(r.data))
    }
  }, [open, choices, editId])

  function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    if (!form.name.trim()) return setError("Enter the client name.")
    startTransition(async () => {
      const r = editId ? await updateClient(editId, form) : await createClient(form)
      if (!r.ok) {
        setError(r.error)
        return
      }
      toast.success(editId ? "Changes saved" : form.isTest ? `Test client “${form.name}” created` : `Client “${form.name}” created`)
      setOpen(false)
      router.refresh()
      onSaved()
    })
  }

  const choice = (id: string, label: string, key: keyof NewClientInput, list: { code: number; label: string }[] | undefined) => (
    <SelectField
      id={id}
      label={label}
      value={(form[key] as number | null | undefined) ?? ""}
      onChange={(v) => set({ [key]: v ? Number(v) : null } as Partial<NewClientInput>)}
      options={(list ?? []).map((o) => ({ value: o.code, label: o.label }))}
    />
  )
  const text = (id: string, label: string, key: keyof NewClientInput, props?: Record<string, unknown>) => (
    <TextField
      id={id}
      label={label}
      value={(form[key] as string | undefined) ?? ""}
      onChange={(v) => set({ [key]: v } as Partial<NewClientInput>)}
      {...props}
    />
  )
  const notes = (id: string, label: string, key: keyof NewClientInput) => (
    <div className="grid gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Textarea
        id={id}
        rows={2}
        value={(form[key] as string | undefined) ?? ""}
        onChange={(e) => set({ [key]: e.target.value } as Partial<NewClientInput>)}
      />
    </div>
  )

  return (
    <Dialog open={open} onOpenChange={(o) => !pending && setOpen(o)}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{editId ? "Edit client" : "Add new client"}</DialogTitle>
          <DialogDescription>
            {editId
              ? "Editing a client created in the dashboard. Changes are saved directly and audited."
              : "Created directly in the dashboard (not in Dynamics). The account team is assigned separately."}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={onSubmit} className="grid max-h-[72vh] gap-3 overflow-y-auto pr-1">
          <FormSection title="Overview">
            <div className="grid grid-cols-2 gap-3">
              {text("nl-name", "Client name", "name", { autoFocus: true })}
              {text("nl-ticker", "Ticker", "tickerSymbol")}
              <SelectField
                id="nl-active"
                label="Active/Inactive — only Active clients appear on Portfolio"
                value={form.active ? "1" : "0"}
                onChange={(v) => set({ active: v === "1" })}
                options={[
                  { value: "1", label: "Active" },
                  { value: "0", label: "Inactive" },
                ]}
                empty={null}
              />
              {choice("nl-status", "Client Status", "clientStatusCode", choices?.clientStatus)}
              {choice("nl-sector", "Sector", "sectorCode", choices?.sector)}
              {choice("nl-industry", "Industry", "industryCode", choices?.industry)}
              <SelectField
                id="nl-hqcountry"
                label="HQ Country"
                value={form.hqCountryId ?? ""}
                onChange={(v) => set({ hqCountryId: v || null })}
                options={(choices?.hqCountry ?? []).map((o) => ({ value: o.id, label: o.name }))}
              />
              {text("nl-mcap", "Market Cap ($B)", "marketCapB", { type: "number", step: "any" })}
              {choice("nl-exchange", "Exchange", "exchangeCode", choices?.exchange)}
              {text("nl-web", "Website", "websiteUrl")}
              {text("nl-email", "Email", "email", { type: "email" })}
              {text("nl-ipreo", "Ipreo Ticker", "ipreoTicker")}
              <SelectField
                id="nl-master"
                label="Master Company Record"
                value={form.companyMasterId ?? ""}
                onChange={(v) => set({ companyMasterId: v || null })}
                options={(choices?.companyMaster ?? []).map((o) => ({ value: o.id, label: o.name }))}
              />
            </div>
          </FormSection>

          <FormSection title="Primary address">
            {text("nl-street", "Street", "street")}
            <div className="grid grid-cols-2 gap-3">
              {text("nl-city", "City", "city")}
              {text("nl-state", "State/Province", "stateProvince")}
              {text("nl-postal", "Postal Code", "postalCode")}
              {text("nl-country", "Country", "country")}
              {text("nl-phone", "Phone", "phone", { type: "tel" })}
            </div>
          </FormSection>

          <FormSection title="Links">
            <div className="grid grid-cols-2 gap-3">
              <SelectField
                id="nl-contact"
                label="Primary Contact"
                value={form.primaryContactId ?? ""}
                onChange={(v) => set({ primaryContactId: v || null })}
                options={contacts.map((c) => ({ value: c.contact_id, label: c.full_name ?? c.contact_id }))}
                empty={editId ? "—" : "— (after the client exists)"}
              />
              <SelectField
                id="nl-event"
                label="Current Event"
                value={form.currentEventId ?? ""}
                onChange={(v) => set({ currentEventId: v || null })}
                options={events.map((ev) => ({ value: ev.event_id, label: ev.name ?? ev.event_id }))}
                empty={editId ? "—" : "— (after the client exists)"}
              />
            </div>
            <p className="text-xs text-muted-foreground">
              The account team (manager, secondary, associate, feedback, logistics, targeting, teaser) is assigned
              separately and is not set here.
            </p>
          </FormSection>

          <FormSection title="Engagement dates">
            <div className="grid grid-cols-3 gap-3">
              {CLIENT_DATES.map(([k, label]) => (
                <TextField
                  key={k}
                  id={`nl-${k}`}
                  label={label}
                  type="date"
                  value={form.dates[k] ?? ""}
                  onChange={(v) => set({ dates: { ...form.dates, [k]: v } })}
                />
              ))}
            </div>
            <p className="text-xs text-muted-foreground">
              Last/next touch and event, days since review and last targeting/teaser are Dynamics rollups —
              display-only.
            </p>
          </FormSection>

          <FormSection title="Flags">
            <div className="grid grid-cols-3 gap-2">
              {CLIENT_FLAGS.map(([k, label]) => (
                <YesNo
                  key={k}
                  label={label}
                  checked={form.flags[k]}
                  onChange={(v) => set({ flags: { ...form.flags, [k]: v } })}
                />
              ))}
            </div>
          </FormSection>

          <FormSection title="Profile & Preferences">
            <div className="grid grid-cols-2 gap-3">
              {choice("nl-secex", "Secondary Exchange", "secondaryExchangeCode", choices?.secondaryExchange)}
              {choice("nl-hqstate", "HQ State", "hqStateCode", choices?.hqState)}
              {choice("nl-freq", "Reporting Frequency", "reportingFrequencyCode", choices?.reportingFrequency)}
              {text("nl-yield", "Dividend Yield (%)", "divYield", { type: "number", step: "any" })}
              {text("nl-slot", "Meeting Slot (min)", "meetingSlotMinutes", { type: "number" })}
              {text("nl-platform", "Meeting Platform", "meetingPlatformPref", { placeholder: "e.g. Teams, Zoom" })}
              {text("nl-tz", "Time Zone (Dynamics code)", "timezoneCode", {
                type: "number",
                placeholder: "e.g. 35 = Eastern, 85 = London",
              })}
            </div>
            <div className="grid grid-cols-2 gap-2">
              {CLIENT_PROFILE_FLAGS.map(([k, label]) => (
                <YesNo
                  key={k}
                  label={label}
                  checked={form.flags[k]}
                  onChange={(v) => set({ flags: { ...form.flags, [k]: v } })}
                />
              ))}
            </div>
          </FormSection>

          <FormSection title="Notes">
            {notes("nl-addl", "Additional Notes", "additionalNotes")}
            {notes("nl-targeting", "Targeting Parameters", "targetingParameters")}
            {notes("nl-onboarding", "Onboarding Notes", "onboardingNotes")}
            {notes("nl-peers", "Peers", "peers")}
            {notes("nl-diet", "Dietary Restrictions", "dietaryRestrictions")}
          </FormSection>

          <FormSection title="System">
            <div className="grid gap-1.5">
              <Label>Owner</Label>
              <UserCombobox
                options={users ?? []}
                value={form.ownerId ?? null}
                onChange={(v) => set({ ownerId: v })}
                placeholder="Me (default)"
              />
            </div>
          </FormSection>

          {!editId && (
            <label className="flex items-start gap-2 rounded-md border border-[#F3E2BF] bg-[#FCF4E6] px-3 py-2 text-sm">
              <Checkbox
                checked={form.isTest}
                onCheckedChange={(c) => set({ isTest: c === true })}
                className="mt-0.5"
              />
              <span>
                <span className="font-medium">Test record</span>
                <span className="block text-xs text-muted-foreground">
                  Marked TEST and removed by “Delete test clients”. It is NOT hidden anywhere — an Active test
                  client appears on Portfolio like any other.
                </span>
              </span>
            </label>
          )}

          {error && <div className="text-sm text-destructive">{error}</div>}

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setOpen(false)} disabled={pending}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? (
                <>
                  <Loader2 className="size-4 animate-spin" /> Saving…
                </>
              ) : editId ? (
                "Save changes"
              ) : (
                "Create client"
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

/** "Add New Client" — the page button plus a fresh create form per open. */
export function NewClientButton() {
  const [open, setOpen] = React.useState(false)
  const [mount, setMount] = React.useState(0)
  // The nav quick-add lands here with ?new=1 — open the same form.
  const quick = useQuickAddRequest()
  return (
    <>
      <AddNewButton
        entity="client"
        onClick={() => {
          setMount((m) => m + 1)
          setOpen(true)
        }}
      />
      <ClientFormDialog
        key={`${mount}${quick.requested ? "-q" : ""}`}
        open={open || quick.requested}
        setOpen={(o) => {
          setOpen(o)
          if (!o) quick.clear()
        }}
        initial={null}
        editId={null}
        onSaved={() => {}}
      />
    </>
  )
}

/**
 * Edit an existing client — opened from the record drawer. loadClientForEdit
 * refuses anything that is not origin='dashboard'.
 */
export function EditClientDialog({
  id,
  onClose,
  onSaved,
}: {
  id: string | null
  onClose: () => void
  onSaved: (id: string) => void
}) {
  const [loaded, setLoaded] = React.useState<{ id: string; input: NewClientInput } | null>(null)

  React.useEffect(() => {
    if (!id) return
    let live = true
    loadClientForEdit(id).then((r) => {
      if (!live) return
      if (r.ok) setLoaded({ id, input: r.data })
      else {
        toast.error("This record can't be edited", { description: r.error })
        onClose()
      }
    })
    return () => {
      live = false
    }
  }, [id, onClose])

  const current = id && loaded?.id === id ? loaded : null
  if (!current) return null
  return (
    <ClientFormDialog
      key={current.id}
      open
      setOpen={(o) => {
        if (!o) {
          setLoaded(null)
          onClose()
        }
      }}
      initial={current.input}
      editId={current.id}
      onSaved={() => {
        setLoaded(null)
        onSaved(current.id)
      }}
    />
  )
}

/** "Delete test clients" — the shared purge button, bound to accounts. */
export function PurgeTestClientsButton() {
  return <PurgeTestButton noun="clients" count={countTestClients} purge={purgeTestClients} />
}
