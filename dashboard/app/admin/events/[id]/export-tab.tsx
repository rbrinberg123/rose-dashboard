"use client"

/**
 * Export tab — options, a live preview (iframe of the server-rendered PDF) and
 * "Generate PDF", which saves a copy (private storage + ep_exports) and hands
 * back a short-lived download link. History lists every saved copy.
 *
 * The PDF itself is drawn on the server in Rose & Co PRINT style; this screen
 * is ordinary IQ UI.
 */

import * as React from "react"
import { Download, FileDown, Loader2, RefreshCw } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Label } from "@/components/ui/label"
import { CARD_CLASS, TEXT_MUTED } from "@/lib/design"
import { useBuilder } from "./builder-context"
import { exportDownloadUrl, listExports, type ExportRow } from "./builder-actions"

type Audience = "client" | "internal" | "attendee"

const AUDIENCES: { value: Audience; label: string; help: string }[] = [
  { value: "client", label: "Client full itinerary", help: "Everything on the schedule. No internal notes, no open availability." },
  { value: "internal", label: "Rose internal", help: "Everything, plus internal notes on a final page marked “Internal — do not distribute”." },
  { value: "attendee", label: "Single attendee", help: "Only the items one person is in." },
]

const SELECT_CLASS = "h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm"
const WHEN = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" })

export function ExportTab() {
  const { itin, readOnly } = useBuilder()
  const [audience, setAudience] = React.useState<Audience>("client")
  const [attendeeId, setAttendeeId] = React.useState("")
  const [cancelled, setCancelled] = React.useState(false)
  const [conf, setConf] = React.useState(false)
  const [appendix, setAppendix] = React.useState(false)
  const [availability, setAvailability] = React.useState(false)
  const [previewKey, setPreviewKey] = React.useState(0)
  const [previewOn, setPreviewOn] = React.useState(false)
  const [generating, setGenerating] = React.useState(false)
  const [history, setHistory] = React.useState<ExportRow[] | null>(null)
  const [historyError, setHistoryError] = React.useState<string | null>(null)

  const refreshHistory = React.useCallback(() => {
    listExports(itin.id).then((r) => {
      if (r.ok) setHistory(r.data)
      else setHistoryError(r.error)
    })
  }, [itin.id])
  React.useEffect(() => {
    refreshHistory()
  }, [refreshHistory])

  const needsAttendee = audience === "attendee" && !attendeeId
  const query = new URLSearchParams({
    audience,
    ...(audience === "attendee" ? { attendee: attendeeId } : {}),
    cancelled: cancelled ? "1" : "0",
    conf: conf ? "1" : "0",
    appendix: appendix ? "1" : "0",
    availability: audience === "internal" && availability ? "1" : "0",
  }).toString()
  const previewUrl = `/admin/events/${itin.id}/pdf?${query}`

  async function onGenerate() {
    setGenerating(true)
    try {
      const res = await fetch(`/admin/events/${itin.id}/pdf`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          audience,
          attendeeId: audience === "attendee" ? attendeeId : null,
          includeCancelled: cancelled,
          includeConfirmations: conf,
          includeAppendix: appendix,
          showAvailability: audience === "internal" && availability,
        }),
      })
      const json = (await res.json()) as { url?: string | null; error?: string }
      if (!res.ok) throw new Error(json.error ?? `Failed (${res.status})`)
      toast.success("PDF generated and saved", {
        action: json.url ? { label: "Download", onClick: () => window.open(json.url!, "_blank") } : undefined,
      })
      refreshHistory()
    } catch (e) {
      toast.error("Could not generate the PDF", { description: (e as Error).message })
    } finally {
      setGenerating(false)
    }
  }

  async function onDownload(id: string) {
    const r = await exportDownloadUrl(id)
    if (!r.ok) return toast.error("Could not download", { description: r.error })
    window.open(r.data.url, "_blank")
  }

  const audienceLabel = (row: ExportRow) => {
    const a = row.options?.audience
    if (a === "attendee") return `For ${itin.attendees.find((x) => x.id === row.options.attendeeId)?.full_name ?? "one attendee"}`
    return AUDIENCES.find((x) => x.value === a)?.label ?? "PDF"
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[320px_1fr]">
      {/* ---- options ---- */}
      <div className="space-y-4">
        <div className={`${CARD_CLASS} space-y-4 p-4`}>
          <div className="grid gap-1.5">
            <Label>Audience</Label>
            <select value={audience} onChange={(e) => setAudience(e.target.value as Audience)} className={SELECT_CLASS}>
              {AUDIENCES.map((a) => (
                <option key={a.value} value={a.value}>
                  {a.label}
                </option>
              ))}
            </select>
            <div className="text-xs" style={{ color: TEXT_MUTED }}>
              {AUDIENCES.find((a) => a.value === audience)?.help}
            </div>
          </div>
          {audience === "attendee" && (
            <div className="grid gap-1.5">
              <Label>Attendee</Label>
              <select value={attendeeId} onChange={(e) => setAttendeeId(e.target.value)} className={SELECT_CLASS}>
                <option value="">Pick a person…</option>
                {itin.attendees.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.full_name}
                  </option>
                ))}
              </select>
            </div>
          )}
          <div className="grid gap-2 text-sm">
            <label className="flex items-center gap-2">
              <Checkbox checked={cancelled} onCheckedChange={(c) => setCancelled(c === true)} /> Include cancelled items
            </label>
            <label className="flex items-center gap-2">
              <Checkbox checked={conf} onCheckedChange={(c) => setConf(c === true)} /> Include confirmation numbers
            </label>
            <label className="flex items-center gap-2">
              <Checkbox checked={appendix} onCheckedChange={(c) => setAppendix(c === true)} /> Investor appendix
            </label>
            {audience === "internal" && (
              <label className="flex items-center gap-2">
                <Checkbox checked={availability} onCheckedChange={(c) => setAvailability(c === true)} /> Show open availability
              </label>
            )}
          </div>
          {conf && audience !== "internal" && (
            <div className="text-xs" style={{ color: TEXT_MUTED }}>
              Travel confirmation numbers print only on legs marked “Print confirmation # in the PDF”.
            </div>
          )}
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={needsAttendee}
              onClick={() => {
                setPreviewOn(true)
                setPreviewKey((k) => k + 1)
              }}
            >
              <RefreshCw className="size-4" /> {previewOn ? "Refresh preview" : "Preview"}
            </Button>
            {!readOnly && (
              <Button size="sm" onClick={onGenerate} disabled={generating || needsAttendee}>
                {generating ? <Loader2 className="size-4 animate-spin" /> : <FileDown className="size-4" />} Generate PDF
              </Button>
            )}
          </div>
          {itin.status !== "finalized" && itin.status !== "invites_sent" && (
            <div className="text-xs" style={{ color: TEXT_MUTED }}>
              Not finalised yet — the PDF footer is marked DRAFT.
            </div>
          )}
        </div>

        {/* ---- history ---- */}
        <div className={`${CARD_CLASS} p-4`}>
          <div className="mb-2 text-sm font-semibold">Export history</div>
          {historyError ? (
            <div className="text-xs text-destructive">{historyError}</div>
          ) : history == null ? (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="size-3.5 animate-spin" /> Loading…
            </div>
          ) : history.length === 0 ? (
            <div className="text-xs text-muted-foreground">No PDFs generated yet.</div>
          ) : (
            <ul className="divide-y divide-border">
              {history.map((h) => (
                <li key={h.id} className="flex items-center gap-2 py-2 text-xs">
                  <div className="min-w-0 flex-1">
                    <div className="font-medium">
                      {h.version ? `v${h.version}` : "Draft"} · {audienceLabel(h)}
                    </div>
                    <div className="text-muted-foreground">
                      {WHEN.format(new Date(h.generated_at))}
                      {h.generated_by_name ? ` · ${h.generated_by_name}` : ""}
                    </div>
                  </div>
                  <Button variant="ghost" size="icon-sm" onClick={() => onDownload(h.id)} aria-label="Download">
                    <Download className="size-4" />
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {/* ---- preview ---- */}
      <div className={`${CARD_CLASS} min-h-[70vh] overflow-hidden`}>
        {previewOn && !needsAttendee ? (
          <iframe key={previewKey} src={previewUrl} title="PDF preview" className="h-[80vh] w-full border-0" />
        ) : (
          <div className="flex h-full min-h-[70vh] flex-col items-center justify-center gap-2 text-sm text-muted-foreground">
            <FileDown className="size-7" />
            {needsAttendee ? "Pick an attendee to preview their PDF." : "Choose options, then Preview."}
          </div>
        )}
      </div>
    </div>
  )
}
