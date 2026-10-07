import "server-only"

/**
 * Build + render an itinerary PDF on the server. Shared by the preview (GET)
 * and generate (POST) handlers in app/admin/events/[id]/pdf/route.ts.
 * Callers gate first.
 */

import type { SupabaseClient } from "@supabase/supabase-js"

import { buildPdfModel, type PdfOptions } from "../core"
import { loadBuilderItinerary } from "../load"
import { renderItineraryPdf } from "./document"

export const PDF_BUCKET = "event-itineraries"

const flag = (v: unknown) => v === true || v === "1" || v === "true"

/** Options from a query string or JSON body → validated PdfOptions. */
export function parsePdfOptions(raw: Record<string, unknown>): { ok: true; opts: PdfOptions } | { ok: false; error: string } {
  const audience = String(raw.audience ?? "client")
  if (audience !== "client" && audience !== "internal" && audience !== "attendee") return { ok: false, error: "Unknown audience." }
  const attendeeId = typeof raw.attendee === "string" && raw.attendee ? raw.attendee : typeof raw.attendeeId === "string" ? raw.attendeeId : null
  if (audience === "attendee" && !attendeeId) return { ok: false, error: "Pick the attendee." }
  return {
    ok: true,
    opts: {
      audience,
      attendeeId: audience === "attendee" ? attendeeId : null,
      includeCancelled: flag(raw.cancelled ?? raw.includeCancelled),
      includeConfirmations: flag(raw.conf ?? raw.includeConfirmations),
      includeAppendix: flag(raw.appendix ?? raw.includeAppendix),
      // Blocks are internal-only; ignored for any other audience.
      showAvailability: audience === "internal" && flag(raw.availability ?? raw.showAvailability),
    },
  }
}

export async function renderForItinerary(
  sb: SupabaseClient,
  itineraryId: string,
  opts: PdfOptions,
): Promise<{ ok: true; pdf: Buffer; version: number; title: string } | { ok: false; error: string; status: number }> {
  const [{ data: itin, error }, mt] = await Promise.all([
    loadBuilderItinerary(sb, itineraryId),
    sb.from("ep_meeting_types").select("id, name"),
  ])
  if (error) return { ok: false, error, status: 500 }
  if (!itin) return { ok: false, error: "That itinerary no longer exists.", status: 404 }
  if (opts.audience === "attendee" && !itin.attendees.some((a) => a.id === opts.attendeeId))
    return { ok: false, error: "That attendee is not on this itinerary.", status: 400 }

  const model = buildPdfModel({ ...itin, meetingTypes: (mt.data ?? []) as { id: string; name: string }[] }, opts)
  const pdf = await renderItineraryPdf(model)
  return { ok: true, pdf, version: itin.version, title: itin.title }
}
