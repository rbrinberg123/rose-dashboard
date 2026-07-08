import * as React from "react"

// Initials from a person's name: first + last initial, uppercased. A single-word
// name yields one letter. Shared by the Portfolio Account Team column and the
// Profiles meeting cards so the treatment stays identical.
export function initialsOf(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean)
  if (words.length === 0) return ""
  if (words.length === 1) return words[0][0].toUpperCase()
  return (words[0][0] + words[words.length - 1][0]).toUpperCase()
}

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
export function AccountTeamAvatars({ members }: { members: readonly TeamAvatarMember[] }) {
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
          {initialsOf(m.name)}
        </span>
      ))}
    </div>
  )
}
