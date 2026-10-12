/**
 * Desktop sidebar collapse state.
 *
 * The collapsed flag lives in a plain (non-httpOnly) cookie so the *server*
 * render already knows the right width — the sidebar comes back from the server
 * at its remembered size instead of mounting wide and snapping narrow. The
 * client writes it directly with `document.cookie` (see `components/nav.tsx`);
 * nothing server-side needs to write it, so no server action is involved.
 */
export const SIDEBAR_COLLAPSED_COOKIE = "sidebar_collapsed"

/** Icon-rail width, in px — fits a 40px icon button plus 9px of gutter. */
// 62px (2026-10-12; was 58) — a touch wider for the 45px tiles. Shared:
// TOP_BAR_HEIGHT below derives from it, so the top section strip grew 4px too.
export const SIDEBAR_COLLAPSED_WIDTH = 62
/**
 * Height, in px, of the top band — shared by the rail's IQ logo box and the
 * page's sectional-nav strip so the two line up across the top of the app.
 *
 * Deliberately DERIVED from the rail width rather than given its own number:
 * that makes the logo box a true square (rail width x rail width) at the
 * top-left corner, and keeps the band and the rail in sync if the rail is ever
 * resized. Both surfaces are border-box and carry the same 1px bottom rule, so
 * their rules land on the same line.
 */
export const TOP_BAR_HEIGHT = SIDEBAR_COLLAPSED_WIDTH

/** Full width, in px — matches the original `w-64`. */
export const SIDEBAR_EXPANDED_WIDTH = 256

/** A year, in seconds — how long the remembered state sticks around. */
const SIDEBAR_COOKIE_MAX_AGE = 60 * 60 * 24 * 365

/**
 * One-time collapse reset epoch (2026-10-12). Bump this to put EVERYONE back on
 * the collapsed rail once, on their next load, without overriding what they
 * choose afterwards.
 *
 * The epoch rides inside the cookie value — `"<flag>.<epoch>"`, e.g. `"0.1"` —
 * so there is no server-side preference to migrate. A cookie whose epoch is
 * older than this (including the legacy bare `"0"` / `"1"`, which count as
 * epoch 0) is treated as collapsed, and the client re-stamps it with the
 * current epoch on mount (see `stampSidebarCookieIfStale`). From then on the
 * epoch matches, so the user's own toggle wins again.
 *
 * History: 1 — first reset, 2026-10-12.
 */
export const SIDEBAR_COLLAPSE_RESET_EPOCH = 1

/** Split a cookie value into its flag ("0" / "1") and epoch (0 if absent). */
function parseSidebarCookie(value: string | undefined): {
  flag: string | undefined
  epoch: number
} {
  if (!value) return { flag: undefined, epoch: 0 }
  const [flag, epoch] = value.split(".")
  return { flag, epoch: Number(epoch) || 0 }
}

/**
 * Whether the sidebar should render collapsed for this request.
 *
 * **Collapsed is the default** — a user with no saved preference gets the icon
 * rail. Only an explicit "0" (written when they expand it) opts out, so a
 * deliberate choice always wins over the default on later loads — provided it
 * was saved under the current `SIDEBAR_COLLAPSE_RESET_EPOCH`. An older one is
 * ignored, which is what makes the one-time reset happen.
 */
export function isSidebarCollapsed(value: string | undefined): boolean {
  const { flag, epoch } = parseSidebarCookie(value)
  if (epoch < SIDEBAR_COLLAPSE_RESET_EPOCH) return true
  return flag !== "0"
}

/** Persist the collapse state from the client. No-op on the server. */
export function persistSidebarCollapsed(collapsed: boolean) {
  if (typeof document === "undefined") return
  document.cookie = `${SIDEBAR_COLLAPSED_COOKIE}=${collapsed ? "1" : "0"}.${SIDEBAR_COLLAPSE_RESET_EPOCH}; path=/; max-age=${SIDEBAR_COOKIE_MAX_AGE}; samesite=lax`
}

/**
 * Client-only, run once on mount: if the cookie predates the current reset
 * epoch, rewrite it as collapsed under the current epoch. This is the "update
 * their stored epoch" half of the reset — after it runs the reset can never
 * fire again for this browser until the epoch is bumped. (The layout can't do
 * this itself: a server component render can read cookies but not set them.)
 */
export function stampSidebarCookieIfStale() {
  if (typeof document === "undefined") return
  const raw = document.cookie
    .split("; ")
    .find((c) => c.startsWith(`${SIDEBAR_COLLAPSED_COOKIE}=`))
    ?.slice(SIDEBAR_COLLAPSED_COOKIE.length + 1)
  if (parseSidebarCookie(raw).epoch < SIDEBAR_COLLAPSE_RESET_EPOCH) {
    persistSidebarCollapsed(true)
  }
}
