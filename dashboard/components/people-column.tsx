// ---------------------------------------------------------------------------
// Shared "Top hosts" / "Top bookers" element. ONE source of truth for the pill
// column so every page that shows per-institution host/booker coverage renders
// an identical element:
//   - Relationships page (Top hosts + Top bookers columns).
//   - Scheduler page (Top hosts column in the Unassigned meetings table).
// A cell is up to 4 wrapping PersonPills — a small initials avatar + the
// person's %, with a hover tooltip like "Brian Smith — hosted 6 of 12 (50%)".
// ---------------------------------------------------------------------------
import * as React from "react"
import { initialsOf } from "@/lib/team-initials"
import type { RelationshipPerson } from "@/lib/types"

// Hosts vs bookers are visually distinguished by color: hosts read blue,
// bookers read teal. Each role has a soft pill fill + text color, a solid
// avatar-dot color, and the verb used in the tooltip.
export const HOST = { verb: "hosted", pillBg: "#E9F0FA", pillFg: "#0355A7", dotBg: "#0355A7" }
export const BOOKER = { verb: "booked", pillBg: "#E2F2F4", pillFg: "#146575", dotBg: "#1C8C9C" }
export type RoleStyle = typeof HOST

// One person as a rounded pill: small initials avatar + their %. Hovering shows
// the full name and the underlying counts via the native title tooltip, e.g.
// "Brian Smith — hosted 6 of 12 (50%)". `total` is the institution's meeting
// count in the SAME window as `person.count`, so the "X of Y" always matches
// the displayed %.
export function PersonPill({
  person,
  total,
  role,
}: {
  person: RelationshipPerson
  total: number
  role: RoleStyle
}) {
  const tip = `${person.name} — ${role.verb} ${person.count.toLocaleString()} of ${total.toLocaleString()} (${person.pct}%)`
  return (
    <span
      title={tip}
      className="inline-flex cursor-default items-center gap-1 rounded-full py-0.5 pl-0.5 pr-2"
      style={{ backgroundColor: role.pillBg, color: role.pillFg }}
    >
      <span
        aria-hidden="true"
        className="flex shrink-0 items-center justify-center rounded-full text-white"
        style={{
          width: 18,
          height: 18,
          fontSize: "8px",
          fontWeight: 700,
          lineHeight: 1,
          backgroundColor: role.dotBg,
        }}
      >
        {initialsOf(person.name)}
      </span>
      <span className="text-xs font-semibold tabular-nums">{person.pct}%</span>
    </span>
  )
}

// A "Top hosts" or "Top bookers" cell — up to 4 wrapping pills, or an em-dash.
export function PeopleColumn({
  people,
  total,
  role,
}: {
  people: RelationshipPerson[]
  total: number
  role: RoleStyle
}) {
  if (!people || people.length === 0) {
    return <div className="text-xs text-muted-foreground">—</div>
  }
  return (
    <div className="flex flex-wrap gap-1.5">
      {people.map((p) => (
        <PersonPill key={p.name} person={p} total={total} role={role} />
      ))}
    </div>
  )
}
