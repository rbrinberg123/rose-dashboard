"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { ChevronDown, ChevronRight, EyeOff, Loader2 } from "lucide-react"
import { toast } from "sonner"

import { CARD_CLASS, CONTROL_STYLE, TEXT_MUTED, TEXT_PRIMARY } from "@/lib/design"
import type { ProductivityPersonToggle } from "@/lib/types"
import { setProductivityHidden } from "./actions"

/**
 * Super-user-only "Excluded people" manager on Summary by Person. Lists
 * everyone in the current date range plus everyone already hidden, so a hidden
 * person can always be switched back on. Rendered only when the page passes a
 * list (effective role = super_user); setProductivityHidden re-checks the REAL
 * role server-side. See lib/productivity-exclusions.ts.
 */
export function ExcludedPeopleManager({ people }: { people: ProductivityPersonToggle[] }) {
  const router = useRouter()
  const [open, setOpen] = React.useState(false)
  const [query, setQuery] = React.useState("")
  const [hidden, setHidden] = React.useState<Record<string, boolean>>(() =>
    Object.fromEntries(people.map((p) => [p.user_id, p.hidden])),
  )
  const [saving, setSaving] = React.useState<Record<string, boolean>>({})
  const [, startTransition] = React.useTransition()

  const hiddenCount = Object.values(hidden).filter(Boolean).length
  const q = query.trim().toLowerCase()
  // Hidden people first, then A–Z, so the current exclusions are easy to find.
  const list = people
    .filter((p) => !q || p.display_name.toLowerCase().includes(q))
    .sort(
      (a, b) =>
        Number(!!hidden[b.user_id]) - Number(!!hidden[a.user_id]) ||
        a.display_name.localeCompare(b.display_name),
    )

  function toggle(p: ProductivityPersonToggle, next: boolean) {
    setHidden((h) => ({ ...h, [p.user_id]: next }))
    setSaving((s) => ({ ...s, [p.user_id]: true }))
    startTransition(async () => {
      const result = await setProductivityHidden(p.user_id, next)
      setSaving((s) => ({ ...s, [p.user_id]: false }))
      if (result.ok) {
        router.refresh()
      } else {
        setHidden((h) => ({ ...h, [p.user_id]: !next }))
        toast.error("Could not save", { description: result.error })
      }
    })
  }

  return (
    <div className={`mb-4 px-4 py-2.5 ${CARD_CLASS}`}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 text-left text-sm"
        style={{ color: TEXT_PRIMARY }}
      >
        {open ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
        <EyeOff className="size-4" style={{ color: TEXT_MUTED }} />
        <span className="font-medium">Excluded people</span>
        <span className="text-xs" style={{ color: TEXT_MUTED }}>
          · {hiddenCount} hidden from per-person breakdowns · super user only
        </span>
      </button>

      {open ? (
        <div className="mt-3 space-y-2">
          <p className="text-xs" style={{ color: TEXT_MUTED }}>
            Hidden people disappear as individuals from Summary by Person, Resource Statistics,
            Person Detail and Capacity. Their numbers still count in every total, shown as one
            &ldquo;Former / Excluded&rdquo; row (Capacity just drops them). Lists everyone active
            in the selected date range plus everyone already hidden — widen the range to find
            someone older.
          </p>
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search people…"
            className="h-8 w-full max-w-xs px-2 text-sm"
            style={CONTROL_STYLE}
            aria-label="Search people"
          />
          <ul className="grid max-h-80 gap-x-6 gap-y-1 overflow-y-auto text-sm sm:grid-cols-2 lg:grid-cols-3">
            {list.map((p) => (
              <li key={p.user_id} className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={!!hidden[p.user_id]}
                  disabled={!!saving[p.user_id]}
                  onChange={(e) => toggle(p, e.target.checked)}
                  className="size-3.5 cursor-pointer accent-[#1E2858] disabled:cursor-not-allowed"
                  aria-label={`Hide ${p.display_name} from Productivity breakdowns`}
                />
                <span
                  className="truncate"
                  style={{ color: hidden[p.user_id] ? TEXT_MUTED : TEXT_PRIMARY }}
                >
                  {p.display_name}
                </span>
                {hidden[p.user_id] ? (
                  <span className="shrink-0 text-[10px]" style={{ color: TEXT_MUTED }}>
                    hidden
                  </span>
                ) : null}
                {saving[p.user_id] ? <Loader2 className="size-3 shrink-0 animate-spin" /> : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  )
}
