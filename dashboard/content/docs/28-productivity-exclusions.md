# 28 — Productivity exclusions ("Former / Excluded")

## What it does (plain language)

Some people shouldn't appear by name in the Productivity charts, usually because they've left the firm. A super user can **hide** them. Hidden people disappear as individuals from the per-person views, but **their work still counts in every total**. It's added up into a single row labelled **"Former / Excluded (N people)"**, which names nobody. So the shown people plus that row always equal the same firm totals as before.

**How to hide or show someone.**
1. Open **Productivity → Summary by Person**.
2. Click **Excluded people**. Only super users see this, and it disappears while you're using View as.
3. Tick a person to hide them, or untick to show them again. It saves immediately and is recorded in the Audit Log.

The list contains everyone active in the selected date range, plus everyone already hidden, so a hidden person can always be switched back on. To find someone older, widen the date range.

What happens on each page:

| Page | A hidden person… | Totals |
|---|---|---|
| **Summary by Person** | Leaves the table. A **"Former / Excluded"** row is pinned to the bottom. It follows the Role and Account-Management filters: only hidden people who match the current filters are in it. | Stat cards are unchanged. The "x of y people" count still counts them. |
| **Resource Statistics** | Leaves **Activity by Person**. They're summed into a muted **"Former / Excluded"** group at the bottom. They also leave **Feedback by Person**, where their sum is a row pinned last. | KPI cards are unchanged, including the people count and the role split. The Meetings-over-time and Seasonality charts are firm-wide and never affected. |
| **Person Detail** | Leaves the person picker, the default selection, and Prev / Next. | The page has no firm totals. |
| **Capacity** | Simply **drops out**, with no rollup. Each bar is one person's own hours, so there's no total to reconcile. | — |

**A direct link still works.** Opening `/productivity-detail?display_name=Name` for a hidden person still loads their page. It shows an **"Excluded from Productivity breakdowns"** note, and they appear in the picker as "Name (excluded)" only while they're the one open. Hiding is a **display choice, not access control**: their data stays in every total, and anyone who can open the page can still reach them by URL.

**One caveat:** if only one person is hidden, the "Former / Excluded (1 person)" row is effectively their numbers. The same is true of a Summary filter that leaves only one hidden person in the rollup.

## Technical

### The table — `public.productivity_hidden_people`

| Column | Notes |
|---|---|
| `user_id` uuid PK | The **canonical** CRM user id (`public.canonical_user_id()` / `user_id_aliases`). Hiding a merged person hides every Dynamics id they have. |
| `hidden_by` text | The super user's email. |
| `hidden_at` timestamptz | Defaults to `now()`. |

The patch is `sql/patches/2026-10-14b_productivity_hidden_people.sql`. RLS is on with no policies, so only the service role can use it. It is dashboard-owned, and no Dynamics or personnel sync writes to it. No row means shown.

**Fails open to "shown":** if the table, or `user_id_aliases`, can't be read (for example before the patch runs), nobody is hidden and every page looks exactly as before.

### The model — a server-side split

`lib/productivity-exclusions.ts` holds the model:
- `loadProductivityExclusions()` is memoised per request and returns `isHidden(id)`, which canonicalises the id through the alias map first.
- `splitHidden(rows, idOf, exclusions)` splits a list into shown and hidden rows.

`lib/productivity-exclusions-shared.ts` holds the browser-safe rollup id and label. Client Components import that file, never the server module.

Each page **builds its full per-person list exactly as before**, then splits it on the server:
- **Summary** (`app/productivity/page.tsx`): the shown rows, plus the hidden people summed into **buckets keyed by role + "has primary" + "has secondary"**. Those are exactly the inputs of the table's Role / AM filters. The table (`productivity-table.tsx`) sums the buckets that match the active filters into the pinned row. The stat cards (`productivity-view.tsx`) add up rows + all buckets, using `active_count` for "Active people".
- **Resource Statistics** (`app/people-statistics/page.tsx`): both arrays get one rollup entry (`user_id = EXCLUDED_ROLLUP_ID`). The activity entry carries `excluded: { members, byRole }`, so the KPI card's people count and role split still count everyone. Bars are scaled to individuals only, and the rollup bar is capped at full width.
- **Capacity** (`app/capacity/page.tsx`): hidden people are skipped.
- **Person Detail** (`app/productivity-detail/page.tsx`): these views are keyed on **display name**. Names are mapped to ids through the `users` list, and a name is hidden when **any** of its ids is hidden. Hidden names' summary, monthly and institution rows are not sent, except for the name requested by `?display_name=`, which is passed as `excludedName`.

Because hidden people's individual rows never leave the server (on Summary, Resource Statistics and Capacity), the browser can't recover them. The totals are unchanged **by construction**: shown + rollup = everyone, and no SQL view was modified.

### Merged-id fix (2026-10-14)

`aggregate()` in `app/productivity/page.tsx` looked people up by `canonical_user_id` but **stored them under the raw `user_id`**. For a merged person (Brian Smith, Blair Mutschler — see `user_id_aliases`), whenever the first row came from the alias id, the person split into two rows. It now stores by canonical id, so each merged person is one row. Capacity already did this correctly.

### The toggle

- **Screen:** `ExcludedPeopleManager` (`app/productivity/excluded-people.tsx`). It is rendered only when `isStrictSuperUser(getEffectiveRole())`, so it is hidden under View as. Admins can't open Productivity at all, and a role given the page through the Roles matrix sees the table without the control.
- **Save:** `setProductivityHidden(userId, hidden)` (`app/productivity/actions.ts`):
  - checks `requireStrictSuperUser` on the **real** role and validates a uuid
  - canonicalises the id through `user_id_aliases`
  - is idempotent
  - audits each change as `productivity_hidden_people`: `create` on hide, and `delete` with the original who and when on show (Audit Log label **Productivity → Excluded Person**)
  - revalidates all four Productivity pages
