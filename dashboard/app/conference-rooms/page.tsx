import type { Metadata } from "next"
import { PageShell } from "@/components/page-shell"
import { ConferenceRoomsView } from "./conference-rooms-view"

export const metadata: Metadata = { title: "Conference Rooms" }

/**
 * Logistics → Conference Rooms. Single-day availability across the four rooms.
 * The interactive view fetches /api/conference-rooms per day (client-side), so
 * this page is a thin shell. Access is gated by proxy.ts via canAccessRoute
 * ("/conference-rooms" is in USER_ALLOWED_ROUTES).
 */
export default function ConferenceRoomsPage() {
  return (
    <PageShell
      title="Conference Rooms"
      description="Single-day availability across the four conference rooms"
      canvas
    >
      <ConferenceRoomsView />
    </PageShell>
  )
}
