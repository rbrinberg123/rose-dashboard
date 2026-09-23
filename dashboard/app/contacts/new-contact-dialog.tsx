"use client"

/**
 * "Add New Contact" — the first LIVE dashboard create form — plus the
 * test-data purge button that sits beside it.
 *
 * Writes go through createContact / purgeTestContacts in ./actions.ts, which
 * hold the real gate (super_user, not impersonating) and the audit call. This
 * file only collects input. Every contact it creates is origin='dashboard';
 * the "Test record" toggle starts ON during the test phase — flip
 * NEW_CONTACT_TEST_DEFAULT in lib/contacts/create.ts to go live.
 *
 * See content/docs/22-cutover-ownership-boundary.md.
 */

import * as React from "react"
import { useRouter } from "next/navigation"
import { Loader2 } from "lucide-react"
import { toast } from "sonner"

import { AddNewButton, useQuickAddRequest } from "@/components/crm-add-new"
import { ClientCombobox } from "@/components/client-combobox"
import { PurgeTestButton } from "@/components/purge-test-button"
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
import {
  CONTACT_INDUSTRY_OPTIONS,
  CONTACT_TYPE_OPTIONS,
  NEW_CONTACT_TEST_DEFAULT,
  type NewContactInput,
} from "@/lib/contacts/create"
import type { AccountOption, UserOption } from "@/lib/types"
import { UserCombobox } from "@/components/user-combobox"
import { FormSection, SelectField, TextField, YesNo } from "@/components/crm-form-kit"
import {
  countTestContacts,
  createContact,
  loadContactForEdit,
  updateContact,
  loadContactClientOptions,
  loadContactUserOptions,
  purgeTestContacts,
} from "./actions"

type TextKey = "firstName" | "lastName" | "jobTitle" | "email" | "mobilePhone" | "directPhone" | "city"

const EMPTY: NewContactInput = {
  firstName: "",
  lastName: "",
  jobTitle: "",
  clientAccountId: null,
  email: "",
  mobilePhone: "",
  directPhone: "",
  city: "",
  contactTypeCode: "",
  street: "",
  industryCode: "",
  active: true,
  irOnly: false,
  poc: false,
  doNotCall: false,
  distributionList: false,
  exEmployee: false,
  verifiedOn: "",
  previousCompany: "",
  tickerSymbol: "",
  ownerId: null,
  isTest: NEW_CONTACT_TEST_DEFAULT,
}

/**
 * The contact form, for BOTH create and edit. `editId` set = edit mode: fields
 * start from `initial`, save goes through updateContact (the server refuses any
 * row that is not origin='dashboard'), and the Test toggle is hidden — is_test
 * is never editable. Mounted fresh per open (keyed by the caller).
 */
function ContactFormDialog({
  open,
  setOpen,
  initial,
  editId,
  onSaved,
}: {
  open: boolean
  setOpen: (o: boolean) => void
  initial: NewContactInput | null
  editId: string | null
  onSaved: () => void
}) {
  const router = useRouter()
  const [form, setForm] = React.useState<NewContactInput>(initial ?? EMPTY)
  const [clients, setClients] = React.useState<AccountOption[] | null>(null)
  const [users, setUsers] = React.useState<UserOption[] | null>(null)
  const up = (p: Partial<NewContactInput>) => setForm((f) => ({ ...f, ...p }))
  const [error, setError] = React.useState<string | null>(null)
  const [pending, startTransition] = React.useTransition()

  // Load the client list the first time the form opens.
  React.useEffect(() => {
    if (!open || clients) return
    loadContactClientOptions().then((r) => {
      if (r.ok) setClients(r.data)
      else setError(`Could not load clients: ${r.error}`)
    })
    loadContactUserOptions().then((r) => (r.ok ? setUsers(r.data) : setError(r.error)))
  }, [open, clients])

  const set = (k: TextKey) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }))

  function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    if (!form.firstName.trim() && !form.lastName.trim()) {
      setError("Enter a first or last name.")
      return
    }
    startTransition(async () => {
      const r = editId ? await updateContact(editId, form) : await createContact(form)
      if (!r.ok) {
        setError(r.error)
        return
      }
      const name = [form.firstName, form.lastName].map((s) => s.trim()).filter(Boolean).join(" ")
      toast.success(editId ? "Changes saved" : form.isTest ? `Test contact “${name}” created` : `Contact “${name}” created`)
      setOpen(false)
      router.refresh()
      onSaved()
    })
  }

  const field = (id: TextKey, label: string, props?: React.ComponentProps<typeof Input>) => (
    <div className="grid gap-1.5">
      <Label htmlFor={`nc-${id}`}>{label}</Label>
      <Input id={`nc-${id}`} value={(form[id] as string) ?? ""} onChange={set(id)} {...props} />
    </div>
  )

  return (
    <>
      <Dialog open={open} onOpenChange={(o) => !pending && setOpen(o)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{editId ? "Edit contact" : "Add new contact"}</DialogTitle>
            <DialogDescription>
              {editId ? (
                "Editing a record created in the dashboard. Changes are saved directly and audited."
              ) : (
                <>
              Created directly in the dashboard (not in Dynamics). It appears on this page right away.
                </>
              )}
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={onSubmit} className="grid max-h-[70vh] gap-3 overflow-y-auto pr-1">
            <div className="grid grid-cols-2 gap-3">
              {field("firstName", "First name", { autoFocus: true })}
              {field("lastName", "Last name")}
            </div>
            {field("jobTitle", "Job title")}

            <div className="grid gap-1.5">
              <Label>Client</Label>
              <ClientCombobox
                options={clients ?? []}
                value={form.clientAccountId ?? null}
                onChange={(v) => setForm((f) => ({ ...f, clientAccountId: v }))}
                placeholder={clients ? "Select a client (optional)" : "Loading clients…"}
              />
            </div>

            <div className="grid gap-1.5">
              <Label htmlFor="nc-type">Contact type</Label>
              <select
                id="nc-type"
                value={form.contactTypeCode ?? ""}
                onChange={(e) => setForm((f) => ({ ...f, contactTypeCode: e.target.value }))}
                className="h-8 rounded-lg border border-input bg-transparent px-2.5 text-sm"
              >
                <option value="">—</option>
                {CONTACT_TYPE_OPTIONS.map((o) => (
                  <option key={o.code} value={o.code}>
                    {o.label}
                  </option>
                ))}
              </select>
            </div>

            {field("email", "Email", { type: "email" })}
            <div className="grid grid-cols-2 gap-3">
              {field("mobilePhone", "Mobile phone", { type: "tel" })}
              {field("directPhone", "Direct phone", { type: "tel" })}
            </div>
            {field("city", "City")}
            <TextField id="nc-street" label="Street" value={form.street} onChange={(v) => up({ street: v })} />

            <FormSection title="Profile">
              <div className="grid grid-cols-2 gap-3">
                <SelectField
                  id="nc-industry"
                  label="Industry"
                  value={form.industryCode}
                  onChange={(v) => up({ industryCode: v })}
                  options={[
                    ...CONTACT_INDUSTRY_OPTIONS.map((o) => ({ value: o.code, label: o.label })),
                    ...(form.industryCode && !CONTACT_INDUSTRY_OPTIONS.some((o) => o.code === form.industryCode)
                      ? [{ value: form.industryCode, label: `Existing code ${form.industryCode}` }]
                      : []),
                  ]}
                />
                <SelectField
                  id="nc-active"
                  label="Active/Inactive"
                  value={form.active ? "1" : "0"}
                  onChange={(v) => up({ active: v === "1" })}
                  options={[
                    { value: "1", label: "Active" },
                    { value: "0", label: "Inactive" },
                  ]}
                  empty={null}
                />
              </div>
            </FormSection>

            <FormSection title="Flags">
              <div className="grid grid-cols-3 gap-2">
                <YesNo label="IR Only" checked={form.irOnly} onChange={(v) => up({ irOnly: v })} />
                <YesNo label="PoC" checked={form.poc} onChange={(v) => up({ poc: v })} />
                <YesNo label="Do Not Call" checked={form.doNotCall} onChange={(v) => up({ doNotCall: v })} />
                <YesNo
                  label="Distribution List"
                  checked={form.distributionList}
                  onChange={(v) => up({ distributionList: v })}
                />
                <YesNo label="Ex-Employee" checked={form.exEmployee} onChange={(v) => up({ exEmployee: v })} />
              </div>
            </FormSection>

            <FormSection title="Activity">
              <div className="grid grid-cols-3 gap-3">
                <TextField
                  id="nc-verified"
                  label="Verified On"
                  type="date"
                  value={form.verifiedOn}
                  onChange={(v) => up({ verifiedOn: v })}
                />
                <TextField
                  id="nc-prev"
                  label="Previous Company"
                  value={form.previousCompany}
                  onChange={(v) => up({ previousCompany: v })}
                />
                <TextField
                  id="nc-ticker"
                  label="Ticker Symbol"
                  value={form.tickerSymbol}
                  onChange={(v) => up({ tickerSymbol: v })}
                />
              </div>
              <p className="text-xs text-muted-foreground">
                Last Activity (subject, type, time) is maintained by the CRM from the contact’s activities — display-only.
              </p>
            </FormSection>

            <FormSection title="System">
              <div className="grid gap-1.5">
                <Label>Owner</Label>
                <UserCombobox
                  options={users ?? []}
                  value={form.ownerId ?? null}
                  onChange={(v) => up({ ownerId: v })}
                  placeholder="Me (default)"
                />
              </div>
            </FormSection>

            {!editId && (
              <label className="flex items-start gap-2 rounded-md border border-[#F3E2BF] bg-[#FCF4E6] px-3 py-2 text-sm">
                <Checkbox
                  checked={form.isTest}
                  onCheckedChange={(c) => setForm((f) => ({ ...f, isTest: c === true }))}
                  className="mt-0.5"
                />
                <span>
                  <span className="font-medium">Test record</span>
                  <span className="block text-xs text-muted-foreground">
                    Marked TEST and removed by “Delete test contacts”. Leave on while we’re testing.
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
                ) : (
                  editId ? "Save changes" : "Create contact"
                )}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  )
}

/** "Delete test contacts" — the shared purge button, bound to contacts. */
export function PurgeTestContactsButton() {
  return <PurgeTestButton noun="contacts" count={countTestContacts} purge={purgeTestContacts} />
}

/** "Add New Contact" — the page button plus a fresh create form per open. */
export function NewContactButton() {
  const [open, setOpen] = React.useState(false)
  const [mount, setMount] = React.useState(0)
  // The nav quick-add lands here with ?new=1 — open the same form.
  const quick = useQuickAddRequest()
  return (
    <>
      <AddNewButton
        entity="contact"
        onClick={() => {
          setMount((m) => m + 1)
          setOpen(true)
        }}
      />
      <ContactFormDialog
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
 * Edit an existing contact — opened from the record drawer. Loads the row via
 * loadContactForEdit, which refuses anything that is not origin='dashboard', so a
 * Dynamics record never reaches this form.
 */
export function EditContactDialog({
  id,
  onClose,
  onSaved,
}: {
  id: string | null
  onClose: () => void
  onSaved: (id: string) => void
}) {
  const [loaded, setLoaded] = React.useState<{ id: string; input: NewContactInput } | null>(null)

  React.useEffect(() => {
    if (!id) return
    let live = true
    loadContactForEdit(id).then((r) => {
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
    <ContactFormDialog
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
