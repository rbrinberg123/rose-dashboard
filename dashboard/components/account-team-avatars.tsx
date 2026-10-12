"use client"

import * as React from "react"
import { lookupInitials } from "@/lib/team-initials"
import { useTeamInitials } from "@/components/team-initials-context"
import type { TeamAvatarMember } from "@/lib/account-team"

// Re-exported so existing importers of the type keep working.
export type { TeamAvatarMember }

// Overlapping cluster of circular initials avatars. Only members with a non-blank
// name render; if none do, an em-dash is shown. Earlier members sit on top of
// later ones (matching the Portfolio Account Team column).
//
// Initials come from the GLOBAL account-team directory (via context): a person
// whose two-letter initials collide with anyone else in that full set shows an
// expanded three-letter form (e.g. "KMu"/"KMi"), the same on every page/team —
// not just when the colliding people happen to share one circle.
export function AccountTeamAvatars({
  members,
  size = 24,
}: {
  members: readonly TeamAvatarMember[]
  /** Circle diameter in px (default 24, the table size). Initials and the
   *  overlap scale with it, so a larger cluster keeps the same proportions. */
  size?: number
}) {
  const initialsMap = useTeamInitials()
  const shown = members.filter(
    (m): m is TeamAvatarMember & { name: string } => Boolean(m.name && m.name.trim()),
  )
  if (shown.length === 0) return <>—</>
  return (
    <div className="flex items-center">
      {shown.map((m, i) => (
        <span
          // Index included because `role` is NOT guaranteed unique: a caller may
          // pass several people under one role (the Meetings page renders a
          // meeting's two Hosts that way). Existing callers pass distinct roles,
          // so this changes nothing for them — React keys are internal.
          key={`${m.role}-${i}`}
          title={`${m.role}: ${m.name}`}
          aria-label={`${m.role}: ${m.name}`}
          className="flex shrink-0 items-center justify-center rounded-full"
          style={{
            width: size,
            height: size,
            fontSize: `${Math.round((size * 9) / 24)}px`,
            fontWeight: 600,
            lineHeight: 1,
            backgroundColor: m.bg,
            color: m.fg,
            // Thin border in the card/row background so overlapping avatars read cleanly.
            border: "2px solid var(--card)",
            marginLeft: i === 0 ? 0 : -Math.round(size / 3),
            // Earlier roles sit on top of later ones.
            zIndex: shown.length - i,
          }}
        >
          {lookupInitials(m.name, initialsMap)}
        </span>
      ))}
    </div>
  )
}
