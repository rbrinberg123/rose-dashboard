"use client"

import * as React from "react"
import { lookupInitials } from "@/lib/team-initials"
import { useTeamInitials } from "@/components/team-initials-context"

// One team member to render as an avatar. `name` may be null/blank — those are
// dropped, so callers can pass an optional secondary without pre-filtering.
export type TeamAvatarMember = {
  role: string
  name: string | null | undefined
  bg: string
  fg: string
}

// Overlapping cluster of circular initials avatars. Only members with a non-blank
// name render; if none do, an em-dash is shown. Earlier members sit on top of
// later ones (matching the Portfolio Account Team column).
//
// Initials come from the GLOBAL account-team directory (via context): a person
// whose two-letter initials collide with anyone else in that full set shows an
// expanded three-letter form (e.g. "KMu"/"KMi"), the same on every page/team —
// not just when the colliding people happen to share one circle.
export function AccountTeamAvatars({ members }: { members: readonly TeamAvatarMember[] }) {
  const initialsMap = useTeamInitials()
  const shown = members.filter(
    (m): m is TeamAvatarMember & { name: string } => Boolean(m.name && m.name.trim()),
  )
  if (shown.length === 0) return <>—</>
  return (
    <div className="flex items-center">
      {shown.map((m, i) => (
        <span
          key={m.role}
          title={`${m.role}: ${m.name}`}
          aria-label={`${m.role}: ${m.name}`}
          className="flex shrink-0 items-center justify-center rounded-full"
          style={{
            width: 24,
            height: 24,
            fontSize: "9px",
            fontWeight: 600,
            lineHeight: 1,
            backgroundColor: m.bg,
            color: m.fg,
            // Thin border in the card/row background so overlapping avatars read cleanly.
            border: "2px solid var(--card)",
            marginLeft: i === 0 ? 0 : -8,
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
