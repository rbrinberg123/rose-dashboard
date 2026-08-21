"use client"

import * as React from "react"
import { createPortal } from "react-dom"
import Link from "next/link"
import { usePathname } from "next/navigation"
import {
  Building2,
  Landmark,
  Users,
  CalendarDays,
  FileText,
  Settings,
  Menu,
  LogOut,
  ChevronsLeft,
  ChevronsRight,
} from "lucide-react"
import { cn } from "@/lib/utils"
import {
  SIDEBAR_COLLAPSED_WIDTH,
  SIDEBAR_EXPANDED_WIDTH,
  persistSidebarCollapsed,
} from "@/lib/sidebar"
import {
  RAIL_ACCENT_FILL,
  RAIL_ACCENT_UNDERLINE,
  RAIL_ACTIVE_TINT,
  RAIL_HOVER_TINT,
  TEAL,
} from "@/lib/design"
import { canAccessRoute, type ViewAsRole } from "@/lib/access-control"
import { Button } from "@/components/ui/button"
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet"
import { signOutAction } from "@/app/auth/actions"

type NavItem = { href: string; label: string }
type NavSection = {
  label: string
  icon: React.ComponentType<{ className?: string }>
  // A section either lists child links (`items`) OR is itself a single clickable
  // link (`href`, no items) — the category row navigates directly.
  items?: NavItem[]
  href?: string
  // COLLAPSED RAIL ONLY: the sub-page this section's rail icon links to when
  // clicked. Must be one of `items`; if the user can't reach it the rail falls
  // back to the first sub-page they can. The expanded sidebar ignores it.
  defaultHref?: string
}

const sections: NavSection[] = [
  {
    label: "Clients",
    icon: Building2,
    defaultHref: "/portfolio",
    items: [
      { href: "/client-statistics", label: "Statistics" },
      { href: "/portfolio", label: "Portfolio" },
      { href: "/client-detail", label: "Detail" },
      { href: "/clients/to-do", label: "To-Do List" },
    ],
  },
  {
    // Single clickable top-level item — the category row itself links to
    // /institutions (no child rows).
    // /institution-detail route kept but unlinked from the nav — reached by
    // drilling in from the Directory (same pattern as the old /planning).
    // /institution-style ("Finder") is reached from the Directory banner.
    label: "Institutions",
    icon: Landmark,
    href: "/institutions",
  },
  {
    label: "Productivity",
    icon: Users,
    defaultHref: "/people-statistics",
    items: [
      { href: "/people-statistics", label: "Statistics" },
      { href: "/productivity", label: "Summary" },
      { href: "/productivity-detail", label: "Detail" },
      { href: "/capacity", label: "Capacity" },
    ],
  },
  {
    label: "Logistics",
    icon: CalendarDays,
    defaultHref: "/planning-v2",
    items: [
      // The original /planning page is hidden from the nav (route kept, unlinked);
      // "Planning" now points at the former Planning Lab (app/planning-v2).
      { href: "/planning-v2", label: "Planning" },
      { href: "/calendar", label: "NDRS Calendar" },
      { href: "/scheduler", label: "Host Calendar" },
      { href: "/live-outreach", label: "Live Outreach" },
      { href: "/profiles", label: "Profiles" },
      // Feedback Reports (pipeline) and Feedback Collection are separate pages
      // with independent route grants; /feedback redirects to Collection.
      { href: "/feedback-manager", label: "Feedback Reports" },
      { href: "/feedback-collection", label: "Feedback Collection" },
      { href: "/onboarding", label: "Onboarding" },
      { href: "/time-off", label: "Time Off" },
    ],
  },
  {
    // Single clickable top-level item — the category row itself links to
    // /contract-management (no child rows).
    label: "Contracts",
    icon: FileText,
    href: "/contract-management",
  },
]

/** A route is "current" when it matches exactly or is an ancestor of the path. */
function isActive(current: string, href: string) {
  return current === href || current.startsWith(href + "/")
}

/**
 * Drive visibility off the SAME allowed-routes set the proxy enforces with, so
 * the nav and the security gate can never disagree. Filter items the user can't
 * access, then drop any section left with no items (no empty headers).
 */
function visibleSections(
  role: ViewAsRole | null,
  allowedRoutes: readonly string[],
) {
  return sections
    .map((section) => ({
      ...section,
      items: (section.items ?? []).filter((item) =>
        canAccessRoute(role, item.href, allowedRoutes),
      ),
    }))
    .filter((section) =>
      // Header-link sections (href, no items) show if the target is allowed;
      // list sections show only when at least one child survived the filter.
      section.href
        ? canAccessRoute(role, section.href, allowedRoutes)
        : section.items.length > 0,
    )
}

function Section({
  section,
  current,
  onNavigate,
}: {
  section: NavSection
  current: string
  onNavigate?: () => void
}) {
  const { label, icon: Icon, items, href } = section

  // Header-as-link: a section with an href and no child items renders the
  // category row itself as a clickable Link, with the same active/hover
  // styling as the child links (active-accent bar included).
  if (href && (!items || items.length === 0)) {
    const active = isActive(current, href)
    return (
      <div className="px-3 py-[5px]">
        <Link
          href={href}
          onClick={onNavigate}
          aria-current={active ? "page" : undefined}
          className={cn(
            "relative flex items-center gap-2 rounded-md px-2 py-1.5 text-[12px] font-medium uppercase tracking-wider transition-colors",
            active
              ? "bg-[#EEF2FB] text-[#1E2858]"
              : "text-[#9AA1AD] hover:bg-[#F4F6F9] hover:text-[#1E2858]",
          )}
        >
          {active && (
            <span
              aria-hidden="true"
              className="absolute inset-y-1 left-0 w-[3px] rounded-full"
              style={{ background: "linear-gradient(180deg, #1E2858, #0355A7)" }}
            />
          )}
          <Icon className="size-[18px] shrink-0" />
          <span>{label}</span>
        </Link>
      </div>
    )
  }

  return (
    <div className="px-3 py-[5px]">
      {/* Non-clickable category label — static, no hover/navigation */}
      <div className="mb-[3px] flex items-center gap-2 px-2 text-[12px] font-medium uppercase tracking-wider text-[#9AA1AD]">
        <Icon className="size-[18px] shrink-0" />
        <span>{label}</span>
      </div>
      <ul className="space-y-0.5">
        {(items ?? []).map(({ href: itemHref, label: itemLabel }) => {
          const active = isActive(current, itemHref)
          return (
            <li key={itemHref}>
              <Link
                href={itemHref}
                onClick={onNavigate}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "relative flex items-center rounded-md py-[3px] pl-6 pr-2 text-sm transition-colors",
                  active
                    ? "bg-[#EEF2FB] font-medium text-[#1E2858]"
                    : "text-[#5B6472] hover:bg-[#F4F6F9] hover:text-[#1E2858]",
                )}
              >
                {active && (
                  <span
                    aria-hidden="true"
                    className="absolute inset-y-1 left-0 w-[3px] rounded-full"
                    style={{ background: "linear-gradient(180deg, #1E2858, #0355A7)" }}
                  />
                )}
                <span className="truncate">{itemLabel}</span>
              </Link>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

function NavContents({
  pathname,
  role,
  allowedRoutes,
  onNavigate,
}: {
  pathname: string
  role: ViewAsRole | null
  allowedRoutes: readonly string[]
  onNavigate?: () => void
}) {
  const visible = visibleSections(role, allowedRoutes)

  return (
    <>
      {visible.map((section, i) => (
        <React.Fragment key={section.label}>
          {i > 0 ? <div className="mx-3 my-0.5 border-t border-[#EDEFF3]" /> : null}
          <Section section={section} current={pathname} onNavigate={onNavigate} />
        </React.Fragment>
      ))}
    </>
  )
}

/* ---------------------------------------------------------------------------
 * Collapsed icon rail
 * ------------------------------------------------------------------------ */

/**
 * z-60 clears every elevated thing a page can put on screen: sticky table
 * headers (z-20), sticky first columns and hover cards (z-30), and the sidebar
 * itself (z-40). The number was never the original problem, though — see below.
 */
const FLYOUT_PANEL =
  "z-[60] min-w-[184px] overflow-y-auto rounded-md border border-[#EDEFF3] bg-white p-1.5 shadow-lg"

/** Gap, in px, between the rail's right edge and the fly-out. */
const FLYOUT_GAP = 6

/** Tab-order members of a subtree, in document order. */
function focusablesIn(root: Element | null | undefined) {
  return root
    ? Array.from(
        root.querySelectorAll<HTMLElement>("a[href], button:not([disabled])"),
      )
    : []
}

/**
 * Hover/focus plumbing for one row of the icon rail.
 *
 * Two things fight the fly-out, and they need different fixes:
 *
 * 1. The rail sits inside an `overflow-y-auto` <nav>, which clips on *both*
 *    axes — so the panel is `position: fixed`, anchored off the row's measured
 *    rect rather than absolutely positioned inside it.
 * 2. `<aside>` is `position: sticky`, and sticky *always* establishes a
 *    stacking context (unlike relative/absolute, which only do so with a
 *    z-index). That capped the panel's z-index inside the aside's own
 *    `z-index: auto` layer, which paints before <main> — so page tables covered
 *    the fly-out no matter how high its z-index went. The fix is to **portal
 *    the panel to document.body**, where its z-index competes at the root.
 *
 * The portal costs us the containment the handlers relied on: DOM `contains()`
 * no longer sees the panel, and native hover doesn't either. So the panel gets
 * its own copy of the handlers (`panelProps`) and `close()` checks both refs.
 */
function useFlyout(align: "top" | "bottom" = "top") {
  const rowRef = React.useRef<HTMLDivElement>(null)
  const panelRef = React.useRef<HTMLDivElement>(null)
  const [open, setOpen] = React.useState(false)
  const [pos, setPos] = React.useState({ left: 0, offset: 0 })
  const closeTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null)

  const cancelClose = () => {
    if (closeTimer.current) {
      clearTimeout(closeTimer.current)
      closeTimer.current = null
    }
  }
  React.useEffect(() => cancelClose, [])

  const show = () => {
    cancelClose()
    const rect = rowRef.current?.getBoundingClientRect()
    if (rect) {
      setPos({
        left: rect.right + FLYOUT_GAP,
        offset:
          align === "bottom" ? window.innerHeight - rect.bottom : rect.top,
      })
    }
    setOpen(true)
  }

  // Brief grace period so crossing the gap to the panel doesn't flicker it shut.
  const hide = () => {
    cancelClose()
    closeTimer.current = setTimeout(() => setOpen(false), 80)
  }

  const close = () => {
    cancelClose()
    setOpen(false)
  }

  // Focus moving *within* the trigger/panel pair must not close the fly-out.
  const onBlur = (e: React.FocusEvent) => {
    const to = e.relatedTarget as Node | null
    if (rowRef.current?.contains(to) || panelRef.current?.contains(to)) return
    close()
  }

  // Portaling moves the panel to the end of <body>, so Tab no longer walks
  // from the trigger into the panel's links on its own — we hand focus across
  // both boundaries by hand, then return it to the rail on the way out.
  const triggerEl = () => focusablesIn(rowRef.current)[0]

  const onTriggerKeyDown = (e: React.KeyboardEvent) => {
    if (!open) return
    // The portal is still a React *child* of this row, so its key events bubble
    // here too. Let the panel's own handler own them — otherwise the Tab branch
    // below would yank focus back to the first link on every keystroke.
    if (panelRef.current?.contains(e.target as Node)) return
    if (e.key === "Escape") {
      e.stopPropagation()
      close()
      return
    }
    if (e.key === "Tab" && !e.shiftKey) {
      const first = focusablesIn(panelRef.current)[0]
      // Tooltips have no focusables — let Tab move on normally.
      if (first) {
        e.preventDefault()
        first.focus()
      }
    }
  }

  const onPanelKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.stopPropagation()
      close()
      triggerEl()?.focus()
      return
    }
    if (e.key !== "Tab") return
    const items = focusablesIn(panelRef.current)
    const i = items.indexOf(document.activeElement as HTMLElement)
    if (e.shiftKey && i === 0) {
      e.preventDefault()
      close()
      triggerEl()?.focus()
    } else if (!e.shiftKey && i === items.length - 1) {
      // Off the end of the fly-out: carry on down the rail, one past the icon
      // that opened it.
      e.preventDefault()
      const rail = focusablesIn(rowRef.current?.closest("aside"))
      const trigger = triggerEl()
      const next = trigger ? rail[rail.indexOf(trigger) + 1] : undefined
      close()
      next?.focus()
    }
  }

  const hoverAndFocus = {
    onMouseEnter: show,
    onMouseLeave: hide,
    // React's onFocus/onBlur are focusin/focusout, so they bubble from the
    // trigger and from every link inside the panel.
    onFocus: show,
    onBlur,
  }

  const triggerProps = { ref: rowRef, ...hoverAndFocus, onKeyDown: onTriggerKeyDown }
  const panelProps = {
    ref: panelRef,
    ...hoverAndFocus,
    onKeyDown: onPanelKeyDown,
    style: {
      position: "fixed" as const,
      left: pos.left,
      maxHeight: `calc(100vh - ${pos.offset + 12}px)`,
      ...(align === "bottom" ? { bottom: pos.offset } : { top: pos.offset }),
    },
  }

  return { open, setOpen, triggerProps, panelProps }
}

type FlyoutPanelProps = ReturnType<typeof useFlyout>["panelProps"]

/** The fly-out itself, rendered into <body> so no ancestor can clip it or trap
 *  its z-index. Only ever mounted while `open`, so `document` is always there. */
function FlyoutPanel({
  id,
  role,
  panelProps,
  className,
  children,
}: {
  id?: string
  role?: string
  panelProps: FlyoutPanelProps
  className?: string
  children: React.ReactNode
}) {
  return createPortal(
    <div id={id} role={role} {...panelProps} className={cn(FLYOUT_PANEL, className)}>
      {children}
    </div>,
    document.body,
  )
}

/**
 * ClassName + style for a rail icon tile. The ACTIVE tile is filled with the
 * blue→teal gradient (white glyph on top) rather than the old flat blue tint, so
 * it matches the spine on the fly-out it opens. A gradient can't be expressed as
 * a background-color utility, hence the paired inline style.
 */
function railIconProps(active: boolean) {
  return {
    className: cn(
      "flex size-10 items-center justify-center rounded-md transition-colors",
      active
        ? "text-white"
        : "text-[#9AA1AD] hover:bg-[#F4F6F9] hover:text-[#1E2858]",
    ),
    style: active ? { backgroundImage: RAIL_ACCENT_FILL } : undefined,
  }
}

/** A rail row that is itself a link (direct-link section, admin gear): icon +
 *  a plain label tooltip on hover/focus. */
function RailIconLink({
  href,
  label,
  icon: Icon,
  active,
  align = "top",
}: {
  href: string
  label: string
  icon: React.ComponentType<{ className?: string }>
  active: boolean
  align?: "top" | "bottom"
}) {
  const { open, triggerProps, panelProps } = useFlyout(align)
  const tooltipId = React.useId()

  return (
    <div className="flex justify-center py-[3px]" {...triggerProps}>
      <Link
        href={href}
        aria-label={label}
        aria-current={active ? "page" : undefined}
        aria-describedby={open ? tooltipId : undefined}
        {...railIconProps(active)}
      >
        <Icon className="size-[18px]" />
      </Link>
      {open ? (
        <FlyoutPanel
          id={tooltipId}
          role="tooltip"
          panelProps={panelProps}
          className="min-w-0 whitespace-nowrap px-3 py-1.5 text-sm text-[#1E2858]"
        >
          {label}
        </FlyoutPanel>
      ) : null}
    </div>
  )
}

/** A rail row for a section with children: the icon is BOTH a link to the
 *  section's default sub-page AND the trigger for a fly-out listing the section
 *  label and every sub-page, so nothing is more than one hover away.
 *  `items` arrives already filtered to routes the user may reach, so the
 *  default target is picked from that list and can never point at a gated page. */
function RailSection({
  section,
  current,
}: {
  section: NavSection & { items: NavItem[] }
  current: string
}) {
  const { label, icon: Icon, items, defaultHref } = section
  const active = items.some((item) => isActive(current, item.href))
  const target =
    items.find((item) => item.href === defaultHref)?.href ?? items[0].href
  const { open, setOpen, triggerProps, panelProps } = useFlyout()
  const panelId = React.useId()

  return (
    <div className="flex justify-center py-[3px]" {...triggerProps}>
      <Link
        href={target}
        aria-label={label}
        aria-current={active ? "page" : undefined}
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        // Navigating dismisses the fly-out; hover/focus re-opens it.
        onClick={() => setOpen(false)}
        {...railIconProps(active)}
      >
        <Icon className="size-[18px]" />
      </Link>
      {open ? (
        <FlyoutPanel id={panelId} panelProps={panelProps}>
          {/* Navy, not the muted gray the in-rail category labels use — inside
              the fly-out this is the panel's own heading. */}
          <div className="px-2 pb-1 pt-0.5 text-[12px] font-medium uppercase tracking-wider text-[#1E2858]">
            {label}
          </div>
          {/* Blue→teal rule under the heading — the panel's one piece of brand
              colour, carrying the same two stops as the active rail icon. */}
          <div
            aria-hidden="true"
            className="mx-2 mb-1.5 h-0.5 rounded-full"
            style={{ backgroundImage: RAIL_ACCENT_UNDERLINE }}
          />
          <ul className="space-y-0.5">
            {items.map(({ href, label: itemLabel }) => {
              const itemActive = isActive(current, href)
              return (
                <li key={href}>
                  <Link
                    href={href}
                    aria-current={itemActive ? "page" : undefined}
                    className={cn(
                      // overflow-hidden clips the accent line to the rounded
                      // corners AND hides it off-edge until hover; pl-3 keeps
                      // the label clear of the 3px line.
                      "group/nav-item relative block overflow-hidden rounded-md py-1 pl-3 pr-2 text-sm transition-colors",
                      itemActive
                        ? "font-medium text-[#1E2858]"
                        : "text-[#5B6472] hover:bg-[var(--rail-hover)] hover:text-[#1E2858]",
                    )}
                    // The hover wash has to travel as a CSS variable — an inline
                    // style cannot express `:hover`, and the tint is derived
                    // from the TEAL token rather than hard-coded.
                    style={{
                      ...({ "--rail-hover": RAIL_HOVER_TINT } as React.CSSProperties),
                      ...(itemActive ? { backgroundColor: RAIL_ACTIVE_TINT } : null),
                    }}
                  >
                    {/* Teal accent line. Parked off the left edge and slid in on
                        hover; the active row keeps it out permanently. */}
                    <span
                      aria-hidden="true"
                      className={cn(
                        "absolute inset-y-0 left-0 w-[3px] transition-transform duration-150 ease-out motion-reduce:transition-none",
                        itemActive
                          ? "translate-x-0"
                          : "-translate-x-full group-hover/nav-item:translate-x-0",
                      )}
                      style={{ backgroundColor: TEAL }}
                    />
                    {itemLabel}
                  </Link>
                </li>
              )
            })}
          </ul>
        </FlyoutPanel>
      ) : null}
    </div>
  )
}

function RailContents({
  pathname,
  role,
  allowedRoutes,
}: {
  pathname: string
  role: ViewAsRole | null
  allowedRoutes: readonly string[]
}) {
  return (
    <>
      {visibleSections(role, allowedRoutes).map((section) =>
        section.items.length > 0 ? (
          <RailSection key={section.label} section={section} current={pathname} />
        ) : (
          <RailIconLink
            key={section.label}
            href={section.href!}
            label={section.label}
            icon={section.icon}
            active={isActive(pathname, section.href!)}
          />
        ),
      )}
    </>
  )
}

/**
 * COLLAPSED only: the expand handle, styled as an edge tab rather than another
 * ghost icon — a filled, bordered, shadowed little tab mounted flush against the
 * rail's right border (rounded on the left, square and border-less on the right)
 * so it reads as "a panel pulls open here" instead of "here is one more icon".
 *
 * NB the rail is WHITE, not navy, so the contrast has to come from a tinted fill
 * + border + shadow; a light fill alone would vanish into the background.
 *
 * It keeps the lower placement — this renders directly above the footer rule,
 * not vertically centered on the edge — and carries the same hover/focus fly-out
 * tooltip the rail icons use, so the label appears in the same place, in the same
 * style, above page content.
 */
function RailExpandTab({
  onExpand,
  controls,
}: {
  onExpand: () => void
  controls: string
}) {
  const { open, triggerProps, panelProps } = useFlyout("bottom")
  const tooltipId = React.useId()

  return (
    <div className="flex justify-end pb-2" {...triggerProps}>
      <button
        type="button"
        onClick={onExpand}
        aria-label="Expand menu"
        aria-expanded={false}
        aria-controls={controls}
        aria-describedby={open ? tooltipId : undefined}
        className="flex h-7 w-6 shrink-0 items-center justify-center rounded-l-md border border-r-0 border-[#CFDBEF] bg-[#EEF2FB] text-[#1E2858] shadow-[-1px_1px_2px_rgba(30,40,88,0.10)] transition-colors hover:border-[#1E2858] hover:bg-[#1E2858] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0355A7]"
      >
        <ChevronsRight className="size-4" />
      </button>
      {open ? (
        <FlyoutPanel
          id={tooltipId}
          role="tooltip"
          panelProps={panelProps}
          className="min-w-0 whitespace-nowrap px-3 py-1.5 text-sm text-[#1E2858]"
        >
          Expand menu
        </FlyoutPanel>
      ) : null}
    </div>
  )
}

/** Collapsed counterpart of <UserPanel/>: an avatar whose fly-out carries the
 *  email + sign-out, with the admin gear stacked underneath — the user cluster
 *  reduced to icons. The collapse chevron sits above the rule, not in here. */
function RailUserPanel({
  email,
  showAdmin,
  pathname,
}: {
  email: string
  showAdmin?: boolean
  pathname?: string
}) {
  const { open, setOpen, triggerProps, panelProps } = useFlyout("bottom")
  const panelId = React.useId()
  const initial = email.trim().charAt(0).toUpperCase() || "?"

  return (
    <div className="space-y-0.5">
      <div className="flex justify-center py-[3px]" {...triggerProps}>
        <button
          type="button"
          aria-label={`Signed in as ${email}`}
          aria-expanded={open}
          aria-controls={open ? panelId : undefined}
          onClick={() => setOpen((v) => !v)}
          className="flex size-8 items-center justify-center rounded-full bg-[#EEF2FB] text-sm font-medium text-[#1E2858] transition-colors hover:bg-[#E2E9F7]"
        >
          {initial}
        </button>
        {open ? (
          <FlyoutPanel id={panelId} panelProps={panelProps}>
            <div className="px-2 pb-1.5 pt-0.5 text-xs text-[#9AA1AD]">
              Signed in as
              <div className="truncate text-[#5B6472]">{email}</div>
            </div>
            <form action={signOutAction}>
              <Button
                type="submit"
                variant="ghost"
                size="sm"
                className="w-full justify-start text-[#5B6472] hover:bg-[#F4F6F9] hover:text-[#1E2858]"
              >
                <LogOut className="size-4" />
                Sign out
              </Button>
            </form>
          </FlyoutPanel>
        ) : null}
      </div>
      {showAdmin ? (
        <RailIconLink
          href="/admin"
          label="Admin"
          icon={Settings}
          active={pathname ? isActive(pathname, "/admin") : false}
          align="bottom"
        />
      ) : null}
    </div>
  )
}

/** Square "IQ" logomark — the standalone mark the rail wears when collapsed.
 *  `favicon-512.png` already *is* that mark (rounded navy→blue tile, no
 *  "Rose & Co" wordmark), so no cropping or synthesis was needed.
 *
 *  size-10 deliberately matches the active section icon's tile footprint (see
 *  `railIconProps`), so the mark sits at the same visual weight as the rail
 *  beneath it rather than reading as a smaller afterthought. */
function BrandMark() {
  return (
    /* eslint-disable-next-line @next/next/no-img-element */
    <img
      src="/favicon-512.png"
      alt="Rose &amp; Co IQ"
      className="size-10 shrink-0 object-contain"
    />
  )
}

function Brand() {
  return (
    /* Horizontal Rose & Co IQ lockup — navy on transparent, sits on the light sidebar. */
    /* eslint-disable-next-line @next/next/no-img-element */
    <img
      src="/roseco-iq-logo_3.png"
      alt="Rose &amp; Co IQ Dashboards"
      className="h-auto w-full max-w-[160px] object-contain"
    />
  )
}

export function Sidebar({
  userEmail,
  role,
  allowedRoutes = [],
  defaultCollapsed = true,
}: {
  userEmail?: string | null
  role?: ViewAsRole | null
  /** Routes the effective role may reach (from the Roles matrix). */
  allowedRoutes?: readonly string[]
  /** Remembered collapse state, read from the cookie by the root layout so the
   *  server renders the sidebar at its final width (no expand/collapse flash).
   *  Defaults to collapsed — see `isSidebarCollapsed`. */
  defaultCollapsed?: boolean
}) {
  const pathname = usePathname() || "/"
  const [mobileOpen, setMobileOpen] = React.useState(false)
  // Desktop-only. The mobile sheet always shows the full nav.
  const [collapsed, setCollapsed] = React.useState(defaultCollapsed)
  const navId = React.useId()

  const toggleCollapsed = () => {
    const next = !collapsed
    setCollapsed(next)
    persistSidebarCollapsed(next)
  }

  // EXPANDED only. A quiet ghost chevron that sits inline in the footer control
  // row, a peer of Sign out and the admin gear. Desktop only: the mobile sheet
  // never receives it. (Collapsed uses the edge tab below instead.)
  const collapseToggle = (
    <button
      type="button"
      onClick={toggleCollapsed}
      aria-label="Collapse sidebar"
      aria-expanded
      aria-controls={navId}
      title="Collapse sidebar"
      className="flex size-8 shrink-0 items-center justify-center rounded-md text-[#9AA1AD] transition-colors hover:bg-[#F4F6F9] hover:text-[#1E2858]"
    >
      <ChevronsLeft className="size-4" />
    </button>
  )
  // Admin is gated by the same matrix (checked against the Admin hub route);
  // super_user is always allowed by the canAccessRoute backstop.
  const showAdmin = canAccessRoute(role ?? null, "/admin", allowedRoutes)

  // Close the mobile sheet on route change.
  React.useEffect(() => {
    setMobileOpen(false)
  }, [pathname])

  // Hide the entire shell on auth-flow pages so /login and /auth/callback
  // render edge-to-edge. The "/no-access" landing is also shell-less — a
  // role-less user has no nav items to show anyway.
  if (
    pathname === "/login" ||
    pathname === "/no-access" ||
    pathname.startsWith("/auth/")
  ) {
    return null
  }

  return (
    <>
      {/* Mobile top bar — visible below md */}
      <header className="sticky top-0 z-30 flex h-12 items-center gap-2 border-b border-[#EDEFF3] bg-white px-3 md:hidden">
        <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
          <SheetTrigger
            render={
              <Button variant="ghost" size="icon-sm" aria-label="Open navigation" />
            }
          >
            <Menu className="size-5" />
          </SheetTrigger>
          <SheetContent side="left" className="w-72 bg-white p-0">
            <SheetHeader className="border-b border-[#EDEFF3] bg-white">
              <SheetTitle className="flex items-center justify-center">
                <Brand />
              </SheetTitle>
            </SheetHeader>
            <nav className="flex-1 overflow-y-auto py-2">
              <NavContents
                pathname={pathname}
                role={role ?? null}
                allowedRoutes={allowedRoutes}
                onNavigate={() => setMobileOpen(false)}
              />
            </nav>
            {userEmail ? (
              <div className="border-t border-[#EDEFF3] p-3">
                <UserPanel email={userEmail} showAdmin={showAdmin} pathname={pathname} />
              </div>
            ) : null}
          </SheetContent>
        </Sheet>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/rose-logo.png" alt="Rose &amp; Co." className="size-8 object-contain" />
      </header>

      {/* Desktop sidebar — visible at md+. Width is inline so it can animate
          between the full width and the icon rail. */}
      <aside
        style={{
          width: collapsed ? SIDEBAR_COLLAPSED_WIDTH : SIDEBAR_EXPANDED_WIDTH,
        }}
        className="z-40 hidden shrink-0 flex-col border-r border-[#EDEFF3] bg-white transition-[width] duration-200 ease-in-out motion-reduce:transition-none md:sticky md:top-0 md:flex md:h-screen"
      >
        {/* Logo header, faint bottom divider — the full lockup shrinks to the
            square IQ mark on the rail. Nothing sits above it: the collapse
            toggle lives down in the footer so the top stays clean. */}
        <div
          className={cn(
            "flex items-center justify-center border-b border-[#EDEFF3] bg-white",
            collapsed ? "px-2 py-3" : "px-4 pb-4 pt-5",
          )}
        >
          {collapsed ? <BrandMark /> : <Brand />}
        </div>
        <nav id={navId} className="flex-1 overflow-y-auto py-2">
          {collapsed ? (
            <RailContents
              pathname={pathname}
              role={role ?? null}
              allowedRoutes={allowedRoutes}
            />
          ) : (
            <NavContents
              pathname={pathname}
              role={role ?? null}
              allowedRoutes={allowedRoutes}
            />
          )}
        </nav>
        {/* Collapsed only: the expand handle sits directly ABOVE the footer rule
            (not centered on the edge), mounted at the rail's right border.
            Expanded keeps its chevron inline in the Sign out · gear · chevron
            row below the rule. */}
        {collapsed ? (
          <RailExpandTab onExpand={toggleCollapsed} controls={navId} />
        ) : null}
        {userEmail ? (
          <div
            className={cn(
              "border-t border-[#EDEFF3]",
              collapsed ? "px-1 py-2" : "px-3 py-3",
            )}
          >
            {collapsed ? (
              <RailUserPanel
                email={userEmail}
                showAdmin={showAdmin}
                pathname={pathname}
              />
            ) : (
              <UserPanel
                email={userEmail}
                showAdmin={showAdmin}
                pathname={pathname}
                collapseToggle={collapseToggle}
              />
            )}
          </div>
        ) : (
          /* Signed-out desktop shell. Collapsed, this is just the rule — the
             chevron above it is the whole footer. */
          <div
            className={cn(
              "flex items-center border-t border-[#EDEFF3] text-xs text-[#9AA1AD]",
              collapsed ? "justify-center px-1" : "justify-between px-4 py-3",
            )}
          >
            {collapsed ? null : (
              <>
                <span>v0.1 · Internal</span>
                {collapseToggle}
              </>
            )}
          </div>
        )}
      </aside>
    </>
  )
}

function UserPanel({
  email,
  showAdmin,
  pathname,
  collapseToggle,
}: {
  email: string
  showAdmin?: boolean
  pathname?: string
  /** Desktop-only collapse chevron; omitted in the mobile sheet. */
  collapseToggle?: React.ReactNode
}) {
  const adminActive =
    pathname === "/admin" || (pathname?.startsWith("/admin/") ?? false)
  return (
    <div className="space-y-2">
      <div className="px-2 text-xs text-[#9AA1AD]" title={email}>
        Signed in as
        <div className="truncate text-[#5B6472]">{email}</div>
      </div>
      {/* Sign out takes the remaining width; the Admin gear (super-users only)
          and the collapse chevron sit at the far right — bottom-right of the
          sidebar. */}
      <div className="flex items-center gap-1.5">
        <form action={signOutAction} className="flex-1">
          <Button
            type="submit"
            variant="ghost"
            size="sm"
            className="w-full justify-start text-[#5B6472] hover:bg-[#F4F6F9] hover:text-[#1E2858]"
          >
            <LogOut className="size-4" />
            Sign out
          </Button>
        </form>
        {showAdmin ? (
          <Link
            href="/admin"
            aria-label="Admin"
            aria-current={adminActive ? "page" : undefined}
            className={cn(
              "flex size-8 shrink-0 items-center justify-center rounded-md transition-colors",
              adminActive
                ? "bg-[#EEF2FB] text-[#1E2858]"
                : "text-[#5B6472] hover:bg-[#F4F6F9] hover:text-[#1E2858]",
            )}
          >
            <Settings className="size-4" />
          </Link>
        ) : null}
        {collapseToggle}
      </div>
    </div>
  )
}
