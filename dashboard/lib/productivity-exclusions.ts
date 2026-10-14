import { cache } from "react"

import { getSupabaseServer } from "@/lib/supabase"

/**
 * Productivity exclusions — people a super user has chosen to HIDE from the
 * per-person Productivity breakdowns (public.productivity_hidden_people,
 * patch sql/patches/2026-10-14b_productivity_hidden_people.sql).
 *
 * THE MODEL — a server-side split, so totals never change:
 *   Each Productivity page builds its full per-person list exactly as before,
 *   then splits it into the SHOWN people plus one "Former / Excluded (N people)"
 *   rollup = the summed numbers of the hidden people. Shown + rollup = the
 *   same firm totals as before, and a hidden person's individual numbers never
 *   leave the server. Capacity just drops them (no rollup — it has no firm
 *   total to reconcile); Person Detail drops them from its picker.
 *
 * Keyed on the CANONICAL user id (public.canonical_user_id / user_id_aliases),
 * so hiding a merged person hides every duplicate Dynamics id they have.
 * Dashboard-owned: no sync touches this table.
 *
 * This is a DISPLAY preference, not access control — the data stays in every
 * total, and a direct Person Detail link still opens (with a note).
 *
 * FAILS OPEN TO "SHOWN": if either table can't be read (e.g. the patch hasn't
 * run), nobody is hidden and every page looks exactly as it did before.
 */
export type ProductivityExclusions = {
  /** Canonical ids currently hidden. */
  hiddenIds: Set<string>
  /** Map any user id (alias or canonical) to its canonical id. */
  canonical: (id: string) => string
  /** Is this user id (alias or canonical) hidden? */
  isHidden: (id: string | null | undefined) => boolean
}

/** Memoised for ONE request (React cache) — never process-wide. */
export const loadProductivityExclusions = cache(async (): Promise<ProductivityExclusions> => {
  const sb = getSupabaseServer()
  const [hiddenRes, aliasRes] = await Promise.all([
    sb.from("productivity_hidden_people").select("user_id"),
    sb.from("user_id_aliases").select("alias_user_id, canonical_user_id"),
  ])
  const aliases = new Map<string, string>()
  for (const a of (aliasRes.data ?? []) as { alias_user_id: string; canonical_user_id: string }[]) {
    aliases.set(a.alias_user_id, a.canonical_user_id)
  }
  const canonical = (id: string) => aliases.get(id) ?? id
  const hiddenIds = new Set<string>()
  if (!hiddenRes.error) {
    for (const h of (hiddenRes.data ?? []) as { user_id: string }[]) hiddenIds.add(canonical(h.user_id))
  }
  return {
    hiddenIds,
    canonical,
    isHidden: (id) => !!id && hiddenIds.has(canonical(id)),
  }
})

export { EXCLUDED_ROLLUP_ID, excludedRollupLabel } from "@/lib/productivity-exclusions-shared"

/** Split rows into shown and hidden by the row's user id. */
export function splitHidden<T>(
  rows: T[],
  idOf: (row: T) => string | null | undefined,
  exclusions: ProductivityExclusions,
): { shown: T[]; hidden: T[] } {
  const shown: T[] = []
  const hidden: T[] = []
  for (const r of rows) (exclusions.isHidden(idOf(r)) ? hidden : shown).push(r)
  return { shown, hidden }
}
