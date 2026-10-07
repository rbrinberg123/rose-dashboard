/**
 * Itinerary PDF — /admin/events/[id]/pdf
 *
 *   GET  ?audience=client|internal|attendee&attendee=<id>&cancelled=1&conf=1
 *        &appendix=1&availability=1
 *        → the PDF inline, for the Export tab's preview. Nothing is saved.
 *   POST { audience, attendeeId, includeCancelled, includeConfirmations,
 *          includeAppendix, showAvailability }
 *        → render, save to the PRIVATE 'event-itineraries' bucket, record an
 *          ep_exports row, return a short-lived signed URL.
 *
 * Server-only (@react-pdf/renderer never reaches a browser bundle).
 *
 * ── SECURITY ───────────────────────────────────────────────────────────────
 * proxy.ts already keeps non-super-users off /admin/events/*, and each handler
 * re-checks: GET needs effective super_user; POST (a write) needs
 * requireCrmWriter (super_user, not in "View as"). Storage is reached only with
 * the service-role key; the bucket has no public access.
 */

import { NextResponse } from "next/server"

import { getSupabaseServer } from "@/lib/supabase"
import { recordAudit } from "@/lib/audit"
import { getEffectiveRole } from "@/lib/effective-identity"
import { isUuid, requireCrmWriter } from "@/lib/crm-write"
import { PDF_BUCKET, parsePdfOptions, renderForItinerary } from "@/lib/events-planner/pdf/export"

export const dynamic = "force-dynamic"

const SIGNED_URL_SECONDS = 10 * 60

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "itinerary"
}

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  // ---- GATE (must stay first) ----
  if ((await getEffectiveRole()) !== "super_user") return NextResponse.json({ error: "Not authorised." }, { status: 403 })
  const { id } = await params
  if (!isUuid(id)) return NextResponse.json({ error: "Unknown itinerary." }, { status: 404 })

  const parsed = parsePdfOptions(Object.fromEntries(new URL(req.url).searchParams))
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 })

  const r = await renderForItinerary(getSupabaseServer(), id, parsed.opts)
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status })
  return new Response(new Uint8Array(r.pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${slug(r.title)}-preview.pdf"`,
      "Cache-Control": "no-store",
    },
  })
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  // ---- GATE (must stay first) ----
  const gate = await requireCrmWriter("generating PDFs")
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: 403 })
  const { id } = await params
  if (!isUuid(id)) return NextResponse.json({ error: "Unknown itinerary." }, { status: 404 })

  let body: Record<string, unknown> = {}
  try {
    body = (await req.json()) as Record<string, unknown>
  } catch {
    return NextResponse.json({ error: "Bad request." }, { status: 400 })
  }
  const parsed = parsePdfOptions(body)
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 })

  const sb = getSupabaseServer()
  const r = await renderForItinerary(sb, id, parsed.opts)
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status })

  const stamp = new Date().toISOString().replace(/[:.]/g, "-")
  const storagePath = `${id}/v${r.version}/${stamp}-${parsed.opts.audience}.pdf`
  const up = await sb.storage.from(PDF_BUCKET).upload(storagePath, r.pdf, { contentType: "application/pdf", upsert: false })
  if (up.error)
    return NextResponse.json(
      { error: `Could not save the PDF: ${up.error.message}. Has the storage bucket SQL been run?` },
      { status: 500 },
    )

  const { data: row, error } = await sb
    .from("ep_exports")
    .insert({
      itinerary_id: id,
      version: r.version,
      storage_path: storagePath,
      generated_by_id: gate.userId,
      generated_by_name: gate.name,
      options: parsed.opts,
    })
    .select("id")
    .single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  const exportId = (row as { id: string }).id

  await sb.from("ep_activity_log").insert({
    itinerary_id: id,
    actor_id: gate.userId,
    actor_name: gate.name,
    action: "pdf_generated",
    details: { export_id: exportId, version: r.version, ...parsed.opts },
  })
  await recordAudit({
    action: "create",
    entity: "ep_exports",
    recordId: exportId,
    changes: { storage_path: storagePath, version: r.version, options: parsed.opts },
    context: `/admin/events/${id} · Generate PDF`,
  })

  const signed = await sb.storage.from(PDF_BUCKET).createSignedUrl(storagePath, SIGNED_URL_SECONDS, {
    download: `${slug(r.title)}-v${r.version}-${parsed.opts.audience}.pdf`,
  })
  return NextResponse.json({ exportId, url: signed.data?.signedUrl ?? null })
}
