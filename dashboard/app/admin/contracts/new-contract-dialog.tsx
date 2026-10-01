"use client"

/**
 * "Add New Contract" — the create/edit form, a near-copy of
 * app/notes/new-note-dialog.tsx built from components/crm-form-kit.tsx — plus
 * the contracts test-data purge button.
 *
 * FORM FIELD SET = DRAWER FIELD SET (lib/contracts/record.ts). The dropdowns
 * come from lib/contracts/create.ts, the same lists the server validates and
 * the DB CHECK constraints mirror. Term End and Notice Date are READ-ONLY here:
 * the database generates them; the form only previews them live.
 *
 * Writes go through createContract / updateContract in ./actions.ts, which hold
 * the real gate (super_user, not impersonating), the origin guard and the audit
 * call. The "Test record" toggle starts ON (NEW_CONTRACT_TEST_DEFAULT).
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
import { Textarea } from "@/components/ui/textarea"
import { FormSection, SelectField, TextField, YesNo } from "@/components/crm-form-kit"
import {
  CONTRACT_CURRENCY,
  CONTRACT_SCOPE,
  CONTRACT_STATUS,
  NEW_CONTRACT_TEST_DEFAULT,
  parseWhole,
  previewNoticeDate,
  previewTermEnd,
  type NewContractInput,
} from "@/lib/contracts/create"
import type { AccountOption } from "@/lib/types"
import {
  countTestContracts,
  createContract,
  loadContractClientOptions,
  loadContractForEdit,
  purgeTestContracts,
  updateContract,
} from "./actions"

const opts = (list: readonly string[]) => list.map((v) => ({ value: v, label: v }))

function emptyForm(): NewContractInput {
  return {
    contractName: "",
    accountId: null,
    scope: "",
    contractStatus: "Draft",
    startDate: "",
    termLengthMonths: "",
    terminationNoticeDays: "",
    autoRenew: false,
    renewalDate: "",
    quarterlyRetainer: "",
    currency: "USD",
    referralSource: "",
    notes: "",
    terminationDate: "",
    terminationReason: "",
    isTest: NEW_CONTRACT_TEST_DEFAULT,
  }
}

/** Whole numbers for the preview; anything unparseable previews as blank. */
const whole = (v: string): number | null => {
  const n = parseWhole(v)
  return n === null || Number.isNaN(n) ? null : n
}

/** A read-only, DB-calculated value shown in the form. */
function CalculatedField({ id, label, value }: { id: string; label: string; value: string | null }) {
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={id}>
        {label} <span className="font-normal italic text-muted-foreground">(calculated)</span>
      </Label>
      <Input id={id} value={value ?? ""} placeholder="—" readOnly disabled tabIndex={-1} />
    </div>
  )
}

/**
 * The contract form, for BOTH create and edit. `editId` set = edit mode: fields
 * start from `initial`, save goes through updateContract (the server refuses any
 * row that is not origin='dashboard'), and the Test toggle is hidden — is_test
 * is never editable. Mounted fresh per open (keyed by the caller).
 */
function ContractFormDialog({
  open,
  setOpen,
  initial,
  editId,
  onSaved,
}: {
  open: boolean
  setOpen: (o: boolean) => void
  initial: NewContractInput | null
  editId: string | null
  onSaved: () => void
}) {
  const router = useRouter()
  const [form, setForm] = React.useState<NewContractInput>(() => initial ?? emptyForm())
  // Renewal date follows Term End until the user sets their own. An existing
  // record keeps whatever it has.
  const [renewalEdited, setRenewalEdited] = React.useState(initial != null)
  const [clients, setClients] = React.useState<AccountOption[] | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const [pending, startTransition] = React.useTransition()

  React.useEffect(() => {
    if (!open || clients) return
    loadContractClientOptions().then((r) => {
      if (r.ok) setClients(r.data)
      else setError(`Could not load clients: ${r.error}`)
    })
  }, [open, clients])

  const termEnd = previewTermEnd(form.startDate, whole(form.termLengthMonths))
  const noticeDate = previewNoticeDate(
    form.startDate,
    whole(form.termLengthMonths),
    whole(form.terminationNoticeDays),
  )

  /** Update one field; a term input re-defaults the renewal date to Term End. */
  function set<K extends keyof NewContractInput>(k: K, v: NewContractInput[K]) {
    setForm((f) => {
      const next = { ...f, [k]: v }
      if (!renewalEdited && (k === "startDate" || k === "termLengthMonths")) {
        next.renewalDate = previewTermEnd(next.startDate, whole(next.termLengthMonths)) ?? ""
      }
      return next
    })
  }

  function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    if (!form.contractName.trim()) return setError("Enter a contract name.")
    if (!form.accountId) return setError("Pick a client.")
    startTransition(async () => {
      const r = editId ? await updateContract(editId, form) : await createContract(form)
      if (!r.ok) {
        setError(r.error)
        return
      }
      const client = clients?.find((c) => c.account_id === form.accountId)?.name ?? "client"
      toast.success(
        editId
          ? "Changes saved"
          : form.isTest
            ? `Test contract for ${client} created`
            : `Contract for ${client} created`,
      )
      setOpen(false)
      router.refresh()
      onSaved()
    })
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !pending && setOpen(o)}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{editId ? "Edit contract" : "Add new contract"}</DialogTitle>
          <DialogDescription>
            {editId
              ? "Editing a contract created in the dashboard. Changes are saved directly and audited."
              : "Created directly in the dashboard (not in Dynamics). It appears on this page right away; the Portfolio and contract reports still read Dynamics contracts only."}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={onSubmit} className="grid max-h-[70vh] gap-3 overflow-y-auto pr-1">
          <FormSection title="Contract">
            <TextField
              id="nc-name"
              label="Contract name"
              value={form.contractName}
              onChange={(v) => set("contractName", v)}
            />
            <div className="grid gap-1.5">
              <Label>Client</Label>
              <ClientCombobox
                options={clients ?? []}
                value={form.accountId}
                onChange={(v) => set("accountId", v)}
                placeholder={clients ? "Select a client" : "Loading clients…"}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <SelectField
                id="nc-scope"
                label="Scope"
                value={form.scope}
                onChange={(v) => set("scope", v)}
                options={opts(CONTRACT_SCOPE)}
              />
              <SelectField
                id="nc-status"
                label="Contract status"
                value={form.contractStatus}
                onChange={(v) => set("contractStatus", v)}
                options={opts(CONTRACT_STATUS)}
              />
            </div>
            <TextField
              id="nc-referral"
              label="Referral source"
              value={form.referralSource}
              onChange={(v) => set("referralSource", v)}
            />
          </FormSection>

          <FormSection title="Term">
            <div className="grid grid-cols-2 gap-3">
              <TextField
                id="nc-start"
                label="Start date"
                type="date"
                value={form.startDate}
                onChange={(v) => set("startDate", v)}
              />
              <TextField
                id="nc-months"
                label="Term length (months)"
                inputMode="numeric"
                value={form.termLengthMonths}
                onChange={(v) => set("termLengthMonths", v)}
              />
              <CalculatedField id="nc-term-end" label="Term end" value={termEnd} />
              <TextField
                id="nc-notice-days"
                label="Termination notice (days)"
                inputMode="numeric"
                value={form.terminationNoticeDays}
                onChange={(v) => set("terminationNoticeDays", v)}
              />
              <CalculatedField id="nc-notice-date" label="Notice date" value={noticeDate} />
              <TextField
                id="nc-renewal"
                label="Renewal date"
                type="date"
                value={form.renewalDate}
                onChange={(v) => {
                  setRenewalEdited(true)
                  set("renewalDate", v)
                }}
              />
            </div>
            <YesNo label="Auto-renew" checked={form.autoRenew} onChange={(v) => set("autoRenew", v)} />
          </FormSection>

          <FormSection title="Retainer">
            <div className="grid grid-cols-[1fr_120px] gap-3">
              <TextField
                id="nc-retainer"
                label="Quarterly retainer"
                inputMode="decimal"
                placeholder="0.00"
                value={form.quarterlyRetainer}
                onChange={(v) => set("quarterlyRetainer", v)}
              />
              <SelectField
                id="nc-currency"
                label="Currency"
                value={form.currency}
                onChange={(v) => set("currency", v)}
                options={opts(CONTRACT_CURRENCY)}
              />
            </div>
          </FormSection>

          <FormSection title="Termination (actually ended)">
            <p className="-mt-1 text-xs text-muted-foreground">
              When the contract actually ended — usually filled in when the status is Terminated.
              Not the same as Term End.
            </p>
            <div className="grid grid-cols-2 gap-3">
              <TextField
                id="nc-term-date"
                label="Termination date"
                type="date"
                value={form.terminationDate}
                onChange={(v) => set("terminationDate", v)}
              />
              <TextField
                id="nc-term-reason"
                label="Termination reason"
                value={form.terminationReason}
                onChange={(v) => set("terminationReason", v)}
              />
            </div>
          </FormSection>

          <FormSection title="Notes">
            <Textarea
              id="nc-notes"
              aria-label="Notes"
              rows={4}
              value={form.notes}
              onChange={(e) => set("notes", e.target.value)}
            />
          </FormSection>

          {!editId && (
            <label className="flex items-start gap-2 rounded-md border border-[#F3E2BF] bg-[#FCF4E6] px-3 py-2 text-sm">
              <Checkbox
                checked={form.isTest}
                onCheckedChange={(c) => set("isTest", c === true)}
                className="mt-0.5"
              />
              <span>
                <span className="font-medium">Test record</span>
                <span className="block text-xs text-muted-foreground">
                  Marked TEST and removed by “Delete test contracts”. It is NOT hidden anywhere — use the ZZ -
                  Test Client (ZVZZT) while we’re testing.
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
                "Create contract"
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

/** "Delete test contracts" — the shared purge button, bound to contracts. */
export function PurgeTestContractsButton() {
  return <PurgeTestButton noun="contracts" count={countTestContracts} purge={purgeTestContracts} />
}

/** "Add New Contract" — the page button plus a fresh create form per open. */
export function NewContractButton() {
  const [open, setOpen] = React.useState(false)
  const [mount, setMount] = React.useState(0)
  // The nav quick-add lands here with ?new=1 — open the same form.
  const quick = useQuickAddRequest()
  return (
    <>
      <AddNewButton
        entity="contract"
        onClick={() => {
          setMount((m) => m + 1)
          setOpen(true)
        }}
      />
      <ContractFormDialog
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
 * Edit an existing contract — opened from the record drawer. Loads the row via
 * loadContractForEdit, which refuses anything that is not origin='dashboard', so
 * a Dynamics record never reaches this form.
 */
export function EditContractDialog({
  id,
  onClose,
  onSaved,
}: {
  id: string | null
  onClose: () => void
  onSaved: (id: string) => void
}) {
  const [loaded, setLoaded] = React.useState<{ id: string; input: NewContractInput } | null>(null)

  React.useEffect(() => {
    if (!id) return
    let live = true
    loadContractForEdit(id).then((r) => {
      if (!live) return
      if (r.ok) setLoaded({ id, input: r.data! })
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
    <ContractFormDialog
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
