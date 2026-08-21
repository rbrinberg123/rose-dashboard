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
export const SIDEBAR_COLLAPSED_WIDTH = 58
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
 * Whether the sidebar should render collapsed for this request.
 *
 * **Collapsed is the default** — a user with no saved preference gets the icon
 * rail. Only an explicit "0" (written when they expand it) opts out, so a
 * deliberate choice always wins over the default on later loads.
 */
export function isSidebarCollapsed(value: string | undefined): boolean {
  return value !== "0"
}

/** Persist the collapse state from the client. No-op on the server. */
export function persistSidebarCollapsed(collapsed: boolean) {
  if (typeof document === "undefined") return
  document.cookie = `${SIDEBAR_COLLAPSED_COOKIE}=${collapsed ? "1" : "0"}; path=/; max-age=${SIDEBAR_COOKIE_MAX_AGE}; samesite=lax`
}
