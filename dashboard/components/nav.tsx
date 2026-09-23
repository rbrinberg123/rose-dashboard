"use client"

import * as React from "react"
import { createPortal } from "react-dom"
import Link from "next/link"
import { usePathname, useRouter } from "next/navigation"
import {
  Building2,
  Landmark,
  Users,
  CalendarDays,
  CalendarRange,
  Database,
  FileText,
  ListChecks,
  MessagesSquare,
  StickyNote,
  Contact2,
  Briefcase,
  Settings,
  Menu,
  Plus,
  LogOut,
  ChevronsLeft,
  ChevronsRight,
} from "lucide-react"
import { cn } from "@/lib/utils"
import {
  SIDEBAR_COLLAPSED_WIDTH,
  SIDEBAR_EXPANDED_WIDTH,
  TOP_BAR_HEIGHT,
  persistSidebarCollapsed,
} from "@/lib/sidebar"
import {
  CRM_TEAL,
  CRM_TEAL_HOVER_TINT,
  CRM_TEAL_TINT,
  RAIL_ACCENT_FILL,
  RAIL_ACCENT_UNDERLINE,
  RAIL_ACTIVE_TINT,
  RAIL_HOVER_TINT,
  STATUS_PILL_LIGHT,
  TEAL,
} from "@/lib/design"
import {
  CRM_ENTITY_LABELS,
  QUICK_ADD_ORDER,
  addNewHref,
  type CrmEntity,
} from "@/components/crm-add-new"
import {
  canAccessRoute,
  visibleCrmNavItems,
  type CrmNavItem,
  type ViewAsRole,
} from "@/lib/access-control"
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
      // Display name only — the route stays /clients/to-do (see the note in
      // app/clients/to-do/page.tsx). This label also drives the Clients tab in
      // the sectional nav strip, which reads the same `sections` array.
      { href: "/clients/to-do", label: "Outreach Status" },
      { href: "/clients/alerts", label: "Alerts" },
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

/* ---------------------------------------------------------------------------
 * CRM — the bottom-pinned, super-user-only block
 *
 * WHO may see it lives in lib/nav-crm.ts, as a pure function with unit tests.
 * What lives HERE is only how it is drawn: a teal OUTLINE rather than the navy
 * fill the reporting items take. Outlined rather than filled is the point — it
 * should read as a different KIND of destination, not as a more important one.
 * ------------------------------------------------------------------------ */

/** Icon per CRM href. Kept here because lib/nav-crm.ts stays React-free.
 *  Database, not CalendarDays: CalendarDays already means "Logistics" in this
 *  rail, and this entry is the CRM store rather than another scheduling view. */
const CRM_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  "/meetings": Database,
  // CalendarRange, not CalendarDays: CalendarDays already means "Logistics" in
  // this rail, and an event is a date RANGE rather than a single day.
  "/events": CalendarRange,
  // ListChecks: a worklist of things to tick off, and the only checkbox-shaped
  // icon in the rail — nothing else here could be mistaken for it.
  "/tasks": ListChecks,
  // MessagesSquare: a touchpoint is a logged CONVERSATION — and not necessarily
  // a phone call, despite the entity being Dynamics' `phonecall` (Virtual, Email,
  // In-Person and Social all land here). PhoneCall would name the plumbing
  // rather than the thing, and stacked speech bubbles read as "contact history".
  "/touchpoints": MessagesSquare,
  // StickyNote: a client-review note is a written jotting ABOUT the relationship,
  // not a record of an interaction — the only paper-shaped icon in the rail, and
  // visually distinct from the speech bubbles one row above it.
  "/notes": StickyNote,
  // Contact2: a single PERSON card. Users (the plural silhouette) already means
  // "People" in the reporting section of this rail, and a contact is one named
  // individual rather than a group — so the card, not the crowd.
  "/contacts": Contact2,
  // Briefcase: the client BOOK — one company Rose works for. Building2 would be
  // the obvious choice and is deliberately NOT reused: it already means the
  // "Clients" REPORTING section in this same rail (Statistics / Portfolio /
  // Detail / Outreach Status), and the whole point of this entry is that it is a
  // different thing — the CRM record, not the analytics view. Two rows sharing
  // one icon would say they are the same page.
  "/accounts": Briefcase,
}

type CrmItem = CrmNavItem & { icon: React.ComponentType<{ className?: string }> }

/** The CRM items to draw, with icons attached. Empty ⇒ nothing renders at all. */
function crmItemsFor(role: ViewAsRole | null, allowedRoutes: readonly string[]): CrmItem[] {
  return visibleCrmNavItems(role, allowedRoutes).map((item) => ({
    ...item,
    icon: CRM_ICONS[item.href] ?? Database,
  }))
}

/**
 * The "+" quick-add in the CRM block — a seven-item menu (New Client / Meeting /
 * Event / Task / Touch / Note / Contact).
 *
 * OPENS ON HOVER, through the rail's own `useFlyout`. That is the point: it is
 * the identical mechanism every other rail fly-out uses, so it inherits the
 * same open-on-mouseenter, the same 80ms close grace when the pointer crosses
 * the gap to the panel, the same fixed positioning off the trigger's measured
 * rect (`rect.right + FLYOUT_GAP`), the same portal out of the clipping <nav>,
 * and the same keyboard handling — focus opens it, Tab walks into the panel,
 * Escape closes and returns focus. No new pattern, no second set of timings.
 *
 * `align="bottom"` matches the CRM icons beside it: the block is pinned to the
 * bottom of the rail, so the panel is anchored from the bottom and grows upward
 * instead of running off-screen.
 *
 * FILLED teal, where the CRM destinations are OUTLINED teal — outlined means "a
 * place to go", filled means "a thing to do".
 *
 * LIVE (2026-09-23): each item navigates to that entity's page with ?new=1
 * (addNewHref), which opens the page's own Add New form — the same form, server
 * action and gates as the page button. See components/crm-add-new.tsx.
 */
function CrmQuickAdd({ variant }: { variant: "sidebar" | "rail" }) {
  const { open, triggerProps, panelProps } = useFlyout("bottom")
  const menuId = React.useId()

  const router = useRouter()
  // Opens that entity's LIVE create form: its page with ?new=1 (addNewHref).
  const pick = (entity: CrmEntity) => router.push(addNewHref(entity))

  return (
    <div className={variant === "rail" ? "flex justify-center" : "flex"} {...triggerProps}>
      <button
        type="button"
        // Disclosure, not role="menu": the panel carries a heading and a rule
        // above its items exactly like every other rail fly-out, and role="menu"
        // permits only menuitem children. aria-expanded + aria-controls is the
        // right pattern for that shape, and it is what the rest of the rail does.
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-label="Quick add a CRM record"
        className={cn(
          "flex shrink-0 items-center justify-center rounded-md text-white transition-opacity",
          "focus:outline-none focus-visible:ring-2 focus-visible:ring-[#1FB6A5]/50",
          variant === "rail" ? "size-6" : "size-[18px]",
          open ? "opacity-100" : "opacity-85",
        )}
        style={{ backgroundColor: CRM_TEAL }}
      >
        <Plus
          className={variant === "rail" ? "size-[14px]" : "size-[12px]"}
          aria-hidden="true"
        />
      </button>
      {open ? (
        <FlyoutPanel id={menuId} panelProps={panelProps}>
          <div className="px-2 pb-1 pt-0.5 text-[12px] font-medium uppercase tracking-wider text-[#1E2858]">
            Quick add
          </div>
          <div
            aria-hidden="true"
            className="mx-2 mb-1.5 h-0.5 rounded-full"
            style={{ backgroundImage: RAIL_ACCENT_UNDERLINE }}
          />
          <ul className="space-y-0.5">
            {QUICK_ADD_ORDER.map((entity) => (
              <li key={entity}>
                <button
                  type="button"
                  onClick={() => pick(entity)}
                  className="flex w-full items-center gap-2 rounded-md py-1 pl-3 pr-2 text-left text-sm text-[#5B6472] transition-colors hover:bg-[var(--rail-hover)] hover:text-[#1E2858]"
                  style={
                    { "--rail-hover": CRM_TEAL_HOVER_TINT } as React.CSSProperties
                  }
                >
                  <Plus
                    className="size-3.5 shrink-0"
                    style={{ color: CRM_TEAL }}
                    aria-hidden="true"
                  />
                  New {CRM_ENTITY_LABELS[entity]}
                </button>
              </li>
            ))}
          </ul>
        </FlyoutPanel>
      ) : null}
    </div>
  )
}

/** A route is "current" when it matches exactly or is an ancestor of the path.
 *  Exported as `isNavRouteActive` for `components/section-nav.tsx`, so the
 *  top-of-page strip marks the active tab by exactly the rule the sidebar uses. */
function isActive(current: string, href: string) {
  return current === href || current.startsWith(href + "/")
}
export { isActive as isNavRouteActive }

/* ---------------------------------------------------------------------------
 * The Alerts critical-count badge
 *
 * ONE nav item, two visual states. Collapsed, the rail shows only SECTION
 * icons — Alerts is a child of Clients — so the bubble rides the Clients icon,
 * which is the rail's only visible stand-in for it. Anywhere labels are shown
 * (expanded sidebar, mobile sheet, the rail's hover fly-out) it is a trailing
 * pill after the word "Alerts" instead.
 *
 * The count is computed server-side in app/clients/alerts/critical-count.ts off
 * the SAME scoping and severity rules as the page, arrives as one number on the
 * Sidebar's `alertCount` prop, and travels down by context rather than through
 * six layers of props.
 * ------------------------------------------------------------------------ */

/** The route the badge belongs to. Must match lib/page-registry.ts. */
const ALERTS_ROUTE = "/clients/alerts"

const AlertCountContext = React.createContext(0)

/**
 * Red badges cap their DISPLAY at "9+" so a three-digit number can't stretch
 * the rail, but the real number is what goes in the aria-label — a screen
 * reader should hear "12 critical", not "9+".
 */
function badgeText(count: number): string {
  return count > 9 ? "9+" : String(count)
}

/** "Alerts — 8 critical", or the plain label when there is nothing to say. */
function alertsAriaLabel(label: string, count: number): string {
  return count > 0 ? `${label} — ${count} critical` : label
}

// The app's critical red, from the shared token the Alerts page's own "Critical"
// pill uses (STATUS_PILL_LIGHT.atRisk.text) — so the badge and the rows it is
// counting are literally the same colour. White on it clears AA comfortably.
const ALERT_BADGE_RED = STATUS_PILL_LIGHT.atRisk.text

/**
 * A1 — classic notification bubble, pinned to the top-right of a rail icon.
 * The 2px white ring matches the rail background, so the bubble reads as
 * floating above the icon rather than clipped into it.
 *
 * Decorative: the count is already in the link's aria-label, so announcing it
 * again here would read it twice.
 */
function RailAlertBubble({ count }: { count: number }) {
  if (count <= 0) return null
  return (
    <span
      aria-hidden="true"
      className="pointer-events-none absolute -right-0.5 -top-0.5 flex min-w-[16px] items-center justify-center rounded-full px-[3px] text-[9.5px] font-semibold leading-none text-white ring-2 ring-white"
      style={{ height: 16, backgroundColor: ALERT_BADGE_RED }}
    >
      {badgeText(count)}
    </span>
  )
}

/** B1 — solid red count pill, trailing a nav label. Decorative, as above. */
function AlertCountPill({ count }: { count: number }) {
  if (count <= 0) return null
  return (
    <span
      aria-hidden="true"
      className="ml-auto flex min-w-[18px] items-center justify-center rounded-full px-1.5 text-[10.5px] font-semibold leading-none text-white"
      style={{ height: 17, backgroundColor: ALERT_BADGE_RED }}
    >
      {badgeText(count)}
    </span>
  )
}

/**
 * Drive visibility off the SAME allowed-routes set the proxy enforces with, so
 * the nav and the security gate can never disagree. Filter items the user can't
 * access, then drop any section left with no items (no empty headers).
 *
 * Exported as `visibleNavSections` for `components/section-nav.tsx` — the
 * top-of-page strip lists a section's siblings from this same filtered result,
 * so it can never show a tab the sidebar would hide.
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

export { visibleSections as visibleNavSections }

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
  const alertCount = React.useContext(AlertCountContext)

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
          const badge = itemHref === ALERTS_ROUTE ? alertCount : 0
          return (
            <li key={itemHref}>
              <Link
                href={itemHref}
                onClick={onNavigate}
                aria-current={active ? "page" : undefined}
                aria-label={badge > 0 ? alertsAriaLabel(itemLabel, badge) : undefined}
                className={cn(
                  "relative flex items-center gap-2 rounded-md py-[3px] pl-6 pr-2 text-sm transition-colors",
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
                <AlertCountPill count={badge} />
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
  const crm = crmItemsFor(role, allowedRoutes)

  return (
    <>
      {visible.map((section, i) => (
        <React.Fragment key={section.label}>
          {i > 0 ? <div className="mx-3 my-0.5 border-t border-[#EDEFF3]" /> : null}
          <Section section={section} current={pathname} onNavigate={onNavigate} />
        </React.Fragment>
      ))}

      {/* CRM, pinned to the bottom. `mt-auto` is what pushes it there — it needs
          the containing <nav> to be a flex column, which is why both navs carry
          `flex flex-col`. Renders nothing at all for a non-super-user: no
          divider, no label, no item. */}
      {crm.length > 0 ? (
        <div className="mt-auto pt-2">
          <CrmDivider />
          {crm.map((item) => (
            <CrmNavRow
              key={item.href}
              item={item}
              active={isActive(pathname, item.href)}
              onNavigate={onNavigate}
            />
          ))}
        </div>
      ) : null}
    </>
  )
}

/** The section break above the CRM block: a hairline rule with a small "CRM"
 *  caption sitting on it, so the block reads as its own area rather than as one
 *  more reporting section. */
function CrmDivider() {
  return (
    <div className="mx-3 mb-1 flex items-center gap-2">
      <span
        aria-hidden="true"
        className="h-px flex-1"
        style={{ backgroundColor: CRM_TEAL, opacity: 0.35 }}
      />
      <span
        aria-hidden="true"
        className="text-[10px] font-semibold uppercase tracking-[0.14em]"
        style={{ color: CRM_TEAL }}
      >
        CRM
      </span>
      <span
        aria-hidden="true"
        className="h-px flex-1"
        style={{ backgroundColor: CRM_TEAL, opacity: 0.35 }}
      />
      <CrmQuickAdd variant="sidebar" />
    </div>
  )
}

/**
 * One CRM row in the EXPANDED sidebar (and the mobile sheet): the icon in a teal
 * outlined box, the label tinted teal beside it.
 *
 * The outline is the whole treatment. Active does NOT switch to a filled navy
 * background the way the reporting rows do — it deepens the outline and adds the
 * faintest teal wash, so the entry still reads as outlined when it is the
 * current page.
 */
function CrmNavRow({
  item,
  active,
  onNavigate,
}: {
  item: CrmItem
  active: boolean
  onNavigate?: () => void
}) {
  const { href, label, icon: Icon } = item
  return (
    <div className="px-3 py-[5px]">
      <Link
        href={href}
        onClick={onNavigate}
        aria-current={active ? "page" : undefined}
        className={cn(
          "flex items-center gap-2 rounded-md px-2 py-1.5 text-[12px] font-medium uppercase tracking-wider transition-colors",
          // Mild hover wash on the NON-active row only — the active row already
          // carries the (stronger) CRM_TEAL_TINT and must not shift on hover.
          !active && "hover:bg-[var(--crm-hover)]",
        )}
        // Same trick as the reporting rows' `--rail-hover`: the tint travels as
        // a CSS custom property because an inline style cannot express `:hover`.
        style={{
          ...({ "--crm-hover": CRM_TEAL_HOVER_TINT } as React.CSSProperties),
          color: CRM_TEAL,
          backgroundColor: active ? CRM_TEAL_TINT : undefined,
        }}
      >
        <span
          aria-hidden="true"
          className="flex size-[26px] shrink-0 items-center justify-center rounded-md"
          style={{
            border: `1.5px solid ${CRM_TEAL}`,
            backgroundColor: "transparent",
            opacity: active ? 1 : 0.85,
          }}
        >
          <Icon className="size-[15px]" />
        </span>
        <span>{label}</span>
      </Link>
    </div>
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
function railIconProps(active: boolean, extraClass?: string) {
  return {
    className: cn(
      "flex size-10 items-center justify-center rounded-md transition-colors",
      active
        ? "text-white"
        : "text-[#9AA1AD] hover:bg-[#F4F6F9] hover:text-[#1E2858]",
      // `relative` is passed in by the one caller that pins a badge to the icon.
      extraClass,
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

  // Collapsed, this section icon is the ONLY visible surface for any page
  // inside it — so when Alerts is one of its (already access-filtered) children,
  // the bubble rides here. Hiding it in the fly-out would mean the badge only
  // appeared on hover, which defeats an at-a-glance cue.
  const alertCount = React.useContext(AlertCountContext)
  const badge = items.some((item) => item.href === ALERTS_ROUTE) ? alertCount : 0

  return (
    <div className="flex justify-center py-[3px]" {...triggerProps}>
      <Link
        href={target}
        aria-label={badge > 0 ? `${label} — ${badge} critical alerts` : label}
        aria-current={active ? "page" : undefined}
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        // Navigating dismisses the fly-out; hover/focus re-opens it.
        onClick={() => setOpen(false)}
        {...railIconProps(active, "relative")}
      >
        <Icon className="size-[18px]" />
        <RailAlertBubble count={badge} />
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
              const itemBadge = href === ALERTS_ROUTE ? alertCount : 0
              return (
                <li key={href}>
                  <Link
                    href={href}
                    aria-current={itemActive ? "page" : undefined}
                    aria-label={
                      itemBadge > 0 ? alertsAriaLabel(itemLabel, itemBadge) : undefined
                    }
                    className={cn(
                      // overflow-hidden clips the accent line to the rounded
                      // corners AND hides it off-edge until hover; pl-3 keeps
                      // the label clear of the 3px line.
                      "group/nav-item relative flex items-center gap-2 overflow-hidden rounded-md py-1 pl-3 pr-2 text-sm transition-colors",
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
                    <span className="truncate">{itemLabel}</span>
                    <AlertCountPill count={itemBadge} />
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
  const crm = crmItemsFor(role, allowedRoutes)

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

      {/* CRM, pinned to the bottom of the rail — same gate, same treatment, just
          the icon and a 3-letter caption at 58px wide. Nothing renders here for
          a non-super-user. */}
      {crm.length > 0 ? (
        <div className="mt-auto pt-2">
          <RailCrmDivider />
          {crm.map((item) => (
            <RailCrmIconLink
              key={item.href}
              item={item}
              active={isActive(pathname, item.href)}
            />
          ))}
        </div>
      ) : null}
    </>
  )
}

/** The rail's CRM section break: hairline rule with the caption under it. The
 *  rail is only 58px wide, so the label sits below the rule rather than inside
 *  it — three letters still fit comfortably. */
function RailCrmDivider() {
  return (
    <div className="px-2 pb-1">
      <span
        aria-hidden="true"
        className="block h-px w-full"
        style={{ backgroundColor: CRM_TEAL, opacity: 0.35 }}
      />
      <span
        aria-hidden="true"
        className="mt-1 block text-center text-[9px] font-semibold uppercase tracking-[0.12em]"
        style={{ color: CRM_TEAL }}
      >
        CRM
      </span>
      <div className="mt-1 flex justify-center">
        <CrmQuickAdd variant="rail" />
      </div>
    </div>
  )
}

/**
 * One CRM icon in the COLLAPSED rail. Same 40px box and same hover fly-out label
 * as every other rail icon — only the treatment differs: a 1.5px teal outline
 * over a transparent fill, teal glyph, and no navy gradient when active (the
 * active state deepens to a faint teal wash instead, so it stays outlined).
 *
 * ── THE IN-BOX LABEL ───────────────────────────────────────────────────────
 * This icon — and ONLY this icon — carries its name inside the box: a 6px
 * "Meetings" under the glyph. No other rail icon does; the rest rely on the
 * hover fly-out alone. It is deliberately an exception, for the one entry that
 * is not part of the reporting nav.
 *
 * Sizing inside a 40px box: the glyph drops to 14px and the caption sits under
 * it on a 7px line, which leaves the pair vertically centred with room to spare.
 * `leading-none` matters — the default line-height on 6px text would push the
 * caption into the border. The text is aria-hidden because the Link already
 * carries the same word as its aria-label, and a screen reader should hear it
 * once, not twice.
 */
function RailCrmIconLink({ item, active }: { item: CrmItem; active: boolean }) {
  const { href, label, icon: Icon } = item
  const { open, triggerProps, panelProps } = useFlyout("bottom")
  const tooltipId = React.useId()

  return (
    <div className="flex justify-center py-[3px]" {...triggerProps}>
      <Link
        href={href}
        aria-label={label}
        aria-current={active ? "page" : undefined}
        aria-describedby={open ? tooltipId : undefined}
        className={cn(
          "flex size-10 flex-col items-center justify-center gap-[1px] rounded-md transition-colors",
          // Mild hover wash on the NON-active tile only.
          !active && "hover:bg-[var(--crm-hover)]",
        )}
        style={{
          ...({ "--crm-hover": CRM_TEAL_HOVER_TINT } as React.CSSProperties),
          border: `1.5px solid ${CRM_TEAL}`,
          // `undefined`, NOT "transparent", for the inactive tile: an inline
          // background-color outranks the `hover:bg-*` class above and would
          // silently cancel the hover wash.
          backgroundColor: active ? CRM_TEAL_TINT : undefined,
          color: CRM_TEAL,
          opacity: active ? 1 : 0.85,
        }}
      >
        <Icon className="size-[14px]" />
        <span
          aria-hidden="true"
          className="text-[6px] font-semibold uppercase leading-none tracking-[0.04em]"
        >
          {label}
        </span>
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
  alertCount = 0,
}: {
  userEmail?: string | null
  role?: ViewAsRole | null
  /** Routes the effective role may reach (from the Roles matrix). */
  allowedRoutes?: readonly string[]
  /** Remembered collapse state, read from the cookie by the root layout so the
   *  server renders the sidebar at its final width (no expand/collapse flash).
   *  Defaults to collapsed — see `isSidebarCollapsed`. */
  defaultCollapsed?: boolean
  /** Critical (red) Alerts for THIS viewer, from the root layout. 0 hides every
   *  badge. See app/clients/alerts/critical-count.ts for how it is counted. */
  alertCount?: number
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
    // The Alerts count travels by context rather than through NavContents,
    // RailContents, Section and RailSection as a prop nothing between them uses.
    <AlertCountContext.Provider value={alertCount}>
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
            <nav className="flex flex-1 flex-col overflow-y-auto py-2">
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
            toggle lives down in the footer so the top stays clean.

            COLLAPSED takes its height from TOP_BAR_HEIGHT rather than padding,
            so the rail's logo box and the page's sectional-nav strip are the
            same height by construction. `items-center` keeps the 40px IQ mark
            centred in whatever that height is. EXPANDED keeps its padding-driven
            height: the full lockup is 160x98, far taller than the band, so
            forcing it into TOP_BAR_HEIGHT would shrink the wordmark. */}
        <div
          style={collapsed ? { height: TOP_BAR_HEIGHT } : undefined}
          className={cn(
            "flex items-center justify-center border-b border-[#EDEFF3] bg-white",
            collapsed ? "px-2" : "px-4 pb-4 pt-5",
          )}
        >
          {collapsed ? <BrandMark /> : <Brand />}
        </div>
        <nav id={navId} className="flex flex-1 flex-col overflow-y-auto py-2">
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
    </AlertCountContext.Provider>
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
