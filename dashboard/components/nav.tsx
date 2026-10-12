"use client"

import * as React from "react"
import { createPortal } from "react-dom"
import Link from "next/link"
import { usePathname, useRouter } from "next/navigation"
import {
  ChartColumn,
  Workflow,
  CalendarRange,
  Database,
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
  ChevronDown,
  ChevronRight,
  Layers,
  LayoutDashboard,
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
  CRM_TEAL_BORDER,
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
  MY_DASHBOARD_ROUTE,
  canAccessRoute,
  isHiddenRoute,
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
/** A labelled sub-section nested INSIDE a section (e.g. Productivity under
 *  Insights): its own small header, its items indented one level deeper. */
type NavSubgroup = { label: string; items: NavItem[] }
type NavSection = {
  label: string
  icon: React.ComponentType<{ className?: string }>
  // A section either lists child links (`items`) OR is itself a single clickable
  // link (`href`, no items) — the category row navigates directly.
  items?: NavItem[]
  /** Nested sub-sections, rendered after `items` (expanded sidebar, rail
   *  fly-out); each is access-filtered like `items`, and dropped when empty. */
  subgroups?: NavSubgroup[]
  href?: string
  // COLLAPSED RAIL ONLY: the sub-page this section's rail icon links to when
  // clicked. Must be one of `items`; if the user can't reach it the rail falls
  // back to the first sub-page they can. The expanded sidebar ignores it.
  defaultHref?: string
}

const sections: NavSection[] = [
  {
    // FIRST in the rail: the personal home page. Single clickable item.
    // Open to every signed-in user (ALWAYS_ALLOWED_ROUTES); each sees only
    // their own data.
    // Nav label "My Dash" (2026-10-12) — label only; the page is still My Dashboard.
    label: "My Dash",
    icon: LayoutDashboard,
    href: "/my-dashboard",
  },
  {
    // Displayed as "Client Insights" (2026-10-12; was "Insights", before that
    // "Clients"). Label only — same items and routes. Not the CRM block's
    // "Clients" (/accounts) record table. The collapsed-rail caption stays
    // "Insights" (RAIL_SHORT_LABEL below) until that is decided separately.
    label: "Client Insights",
    // ChartColumn (= bar-chart-3): reporting / analytics (2026-10-11; was Building2).
    icon: ChartColumn,
    defaultHref: "/portfolio",
    items: [
      { href: "/client-statistics", label: "Client Statistics" },
      // Directly below Client Statistics (2026-10-12).
      // Super-user only (ADMIN_ONLY_ROUTES): canAccessRoute hides it from every
      // other role, matching the proxy.
      { href: "/client-health", label: "Client Health" },
      { href: "/portfolio", label: "My Portfolio" },
      // Client Detail (/client-detail) is NOT a nav item (2026-10-11): it is
      // reached by clicking a client name / ticker (My Portfolio, Outreach
      // Status, the CRM tables …). Route and page unchanged.
      // Display name only — the route stays /clients/to-do (see the note in
      // app/clients/to-do/page.tsx). This label also drives the Clients tab in
      // the sectional nav strip, which reads the same `sections` array.
      { href: "/clients/to-do", label: "Outreach Status" },
      { href: "/clients/alerts", label: "Alerts" },
      // (/contract-management moved to the END of Workflows, 2026-10-12.)
      // LAST (2026-10-11) — moved here from its own top-level item. Route and
      // grant unchanged. /institution-detail stays unlinked (reached by
      // drilling in from the Directory); /institution-style ("Finder") is
      // reached from the Directory banner.
      { href: "/institutions", label: "Institutions" },
    ],
    // Productivity is NESTED inside Insights (2026-10-11), not a top-level
    // group: an indented sub-section with its own header. Menu nesting only —
    // the same four routes, each still filtered by canAccessRoute.
    // Labels renamed 2026-10-12 (routes unchanged): "Productivity" →
    // "Productivity Insights"; Statistics → Resource Statistics; Summary →
    // Summary by Person; Detail → Person Detail.
    subgroups: [
      {
        label: "Productivity Insights",
        items: [
          { href: "/people-statistics", label: "Resource Statistics" },
          { href: "/productivity", label: "Summary by Person" },
          { href: "/productivity-detail", label: "Person Detail" },
          { href: "/capacity", label: "Capacity" },
        ],
      },
    ],
  },
  {
    // Displayed as "Workflows" (2026-10-11; was "Logistics"). Label only — the
    // same items and routes.
    label: "Workflows",
    // Workflow: connected process steps (2026-10-11; was CalendarDays).
    icon: Workflow,
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
      // LAST (2026-10-12) — the /contract-management REPORT, moved here from the
      // end of Client Insights. Nav location only: the route and its
      // Roles-matrix grant are unchanged (canAccessRoute hides it from roles
      // without it). NOT Admin → Contract Management (/admin/contracts), which
      // stays a card on the Admin hub.
      { href: "/contract-management", label: "Contract Management" },
      // FB Coming Soon (/fb-coming-soon) was removed from the nav 2026-10-12.
      // The route, page and its ADMIN_ONLY_ROUTES gate are unchanged — it is
      // simply unlinked (reachable by URL, super-user only).
    ],
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
 *  Database: this entry is the CRM store of meetings, not another scheduling
 *  view. */
const CRM_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  "/meetings": Database,
  // CalendarRange: an event is a date RANGE rather than a single day.
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
  // Briefcase: the client BOOK — one company Rose works for: the CRM record, as
  // distinct from the Insights (analytics) section's chart icon.
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
 * The "Actions" submenu — Tasks, Touches and Notes, drawn as ONE collapsible
 * group to save vertical space in the CRM block. DRAWING ONLY: the items, their
 * order and their access gate still come from CRM_NAV_ITEMS / visibleCrmNavItems
 * in lib/access-control.ts, untouched. The group is placed where its first
 * visible child would have been, holds only children the viewer can reach, and
 * vanishes entirely when none survive.
 */
const CRM_ACTIONS_LABEL = "Actions"
const CRM_ACTIONS_HREFS: readonly string[] = ["/tasks", "/touchpoints", "/notes"]

type CrmEntry =
  | { kind: "item"; item: CrmItem }
  | { kind: "group"; items: CrmItem[] }

function groupCrmItems(crm: CrmItem[]): CrmEntry[] {
  const children = CRM_ACTIONS_HREFS.map((href) =>
    crm.find((item) => item.href === href),
  ).filter((item): item is CrmItem => item !== undefined)
  const entries: CrmEntry[] = []
  for (const item of crm) {
    if (!CRM_ACTIONS_HREFS.includes(item.href)) {
      entries.push({ kind: "item", item })
    } else if (item === children[0]) {
      entries.push({ kind: "group", items: children })
    }
  }
  return entries
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
 * The same red badge on the My Dashboard item: the number of rows that page
 * flags CRITICAL for this viewer (app/my-dashboard/critical-count.ts). Hidden
 * at 0. Same bubble (rail) / pill (labels) as Alerts.
 */
const MyDashboardCountContext = React.createContext(0)

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
  // Hidden (retired) pages are off the nav for EVERYONE, super users
  // included — reached only from Admin → Hidden Pages (isHiddenRoute).
  const allowed = (item: NavItem) =>
    !isHiddenRoute(item.href) && canAccessRoute(role, item.href, allowedRoutes)
  return sections
    .map((section) => ({
      ...section,
      items: (section.items ?? []).filter(allowed),
      subgroups: (section.subgroups ?? [])
        .map((g) => ({ ...g, items: g.items.filter(allowed) }))
        .filter((g) => g.items.length > 0),
    }))
    .filter((section) =>
      // Header-link sections (href, no items) show if the target is allowed;
      // list sections show only when at least one child (own or nested)
      // survived the filter.
      section.href
        ? canAccessRoute(role, section.href, allowedRoutes)
        : section.items.length > 0 || section.subgroups.length > 0,
    )
}

/** Every link a (visible) section holds — its own items, then each sub-group's. */
function allItemsOf(section: { items: NavItem[]; subgroups: NavSubgroup[] }): NavItem[] {
  return [...section.items, ...section.subgroups.flatMap((g) => g.items)]
}

/**
 * The groups the top-of-page section strip can show, flattened: each section's
 * own items as one group, and each nested sub-group as its own group labelled
 * "Section · Sub-group" — so a Productivity page's strip lists the four
 * Productivity tabs, not the Insights ones. Same access filtering as the nav.
 */
function visibleNavGroups(role: ViewAsRole | null, allowedRoutes: readonly string[]) {
  return visibleSections(role, allowedRoutes).flatMap((section) => [
    { label: section.label, items: section.items, defaultHref: section.defaultHref },
    ...section.subgroups.map((g) => ({ label: `${section.label} · ${g.label}`, items: g.items, defaultHref: undefined })),
  ])
}

export { visibleSections as visibleNavSections, visibleNavGroups }

function Section({
  section,
  current,
  onNavigate,
}: {
  section: NavSection
  current: string
  onNavigate?: () => void
}) {
  const { label, icon: Icon, items, href, subgroups } = section
  const alertCount = React.useContext(AlertCountContext)
  const dashCount = React.useContext(MyDashboardCountContext)

  // Header-as-link: a section with an href and no child items renders the
  // category row itself as a clickable Link, with the same active/hover
  // styling as the child links (active-accent bar included).
  if (href && (!items || items.length === 0) && (!subgroups || subgroups.length === 0)) {
    const active = isActive(current, href)
    return (
      <div className="px-3 py-[2px]">
        <Link
          href={href}
          onClick={onNavigate}
          aria-current={active ? "page" : undefined}
          aria-label={alertsAriaLabel(label, href === MY_DASHBOARD_ROUTE ? dashCount : 0)}
          className={cn(
            "relative flex items-center gap-2 rounded-md px-2 py-1 text-[12px] font-medium uppercase tracking-wider transition-colors",
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
          <AlertCountPill count={href === MY_DASHBOARD_ROUTE ? dashCount : 0} />
        </Link>
      </div>
    )
  }

  return (
    <div className="px-3 py-[2px]">
      {/* Non-clickable category label — static, no hover/navigation */}
      <div className="mb-px flex items-center gap-2 px-2 text-[12px] font-medium uppercase tracking-wider text-[#9AA1AD]">
        <Icon className="size-[18px] shrink-0" />
        <span>{label}</span>
      </div>
      <ul>
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
                  "relative flex items-center gap-2 rounded-md py-px pl-6 pr-2 text-sm transition-colors",
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
      {/* Nested sub-sections (e.g. Productivity inside Insights): a small,
          indented header, then its links indented one level deeper. */}
      {(subgroups ?? []).map((g) => (
        <div key={g.label} className="mt-0.5">
          <div className="mb-px pl-6 pr-2 text-[11px] font-medium uppercase tracking-wider text-[#9AA1AD]">
            {g.label}
          </div>
          <ul>
            {g.items.map(({ href: itemHref, label: itemLabel }) => {
              const active = isActive(current, itemHref)
              return (
                <li key={itemHref}>
                  <Link
                    href={itemHref}
                    onClick={onNavigate}
                    aria-current={active ? "page" : undefined}
                    className={cn(
                      "relative flex items-center gap-2 rounded-md py-px pl-9 pr-2 text-sm transition-colors",
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
      ))}
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
        <div className="mt-auto pt-1">
          <CrmDivider />
          {groupCrmItems(crm).map((entry) =>
            entry.kind === "group" ? (
              <CrmNavGroup
                key={CRM_ACTIONS_LABEL}
                items={entry.items}
                current={pathname}
                onNavigate={onNavigate}
              />
            ) : (
              <CrmNavRow
                key={entry.item.href}
                item={entry.item}
                active={isActive(pathname, entry.item.href)}
                onNavigate={onNavigate}
              />
            ),
          )}
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
  nested = false,
}: {
  item: CrmItem
  active: boolean
  onNavigate?: () => void
  /** Inside the "Actions" group: indented under its header. */
  nested?: boolean
}) {
  const { href, label, icon: Icon } = item
  return (
    <div className={nested ? "py-px pl-7 pr-3" : "px-3 py-px"}>
      <Link
        href={href}
        onClick={onNavigate}
        aria-current={active ? "page" : undefined}
        className={cn(
          "flex items-center gap-2 rounded-md px-2 py-1 text-[12px] font-medium uppercase tracking-wider transition-colors",
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
          className="flex size-[22px] shrink-0 items-center justify-center rounded-md"
          style={{
            border: `1px solid ${CRM_TEAL_BORDER}`,
            backgroundColor: "transparent",
            opacity: active ? 1 : 0.85,
          }}
        >
          <Icon className="size-[13px]" />
        </span>
        <span>{label}</span>
      </Link>
    </div>
  )
}

/**
 * The "Actions" group in the EXPANDED sidebar (and the mobile sheet): a header
 * drawn exactly like a CrmNavRow — but a button, not a link — that shows and
 * hides its indented children. No other nav group remembers an open/closed
 * state, so this one doesn't either: it starts open, and re-opens itself
 * whenever the current page is one of its children, so the active link can
 * never be hidden. While closed over an active child, the header takes the
 * active wash so the current page still shows.
 */
function CrmNavGroup({
  items,
  current,
  onNavigate,
}: {
  items: CrmItem[]
  current: string
  onNavigate?: () => void
}) {
  const childActive = items.some((item) => isActive(current, item.href))
  const [open, setOpen] = React.useState(true)
  const listId = React.useId()

  // Landing on a child route re-opens the group. Adjusted during render (React's
  // "reset state when a prop changes" pattern) rather than in an effect.
  const [seenPath, setSeenPath] = React.useState(current)
  if (seenPath !== current) {
    setSeenPath(current)
    if (childActive) setOpen(true)
  }

  const headerActive = childActive && !open
  const Chevron = open ? ChevronDown : ChevronRight

  return (
    <>
      <div className="px-3 py-px">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-controls={listId}
          className={cn(
            "flex w-full items-center gap-2 rounded-md px-2 py-1 text-left text-[12px] font-medium uppercase tracking-wider transition-colors",
            !headerActive && "hover:bg-[var(--crm-hover)]",
          )}
          style={{
            ...({ "--crm-hover": CRM_TEAL_HOVER_TINT } as React.CSSProperties),
            color: CRM_TEAL,
            backgroundColor: headerActive ? CRM_TEAL_TINT : undefined,
          }}
        >
          <span
            aria-hidden="true"
            className="flex size-[22px] shrink-0 items-center justify-center rounded-md"
            style={{
              border: `1px solid ${CRM_TEAL_BORDER}`,
              opacity: childActive ? 1 : 0.85,
            }}
          >
            <Layers className="size-[13px]" />
          </span>
          <span>{CRM_ACTIONS_LABEL}</span>
          <Chevron className="ml-auto size-4 shrink-0" aria-hidden="true" />
        </button>
      </div>
      {open ? (
        <div id={listId}>
          {items.map((item) => (
            <CrmNavRow
              key={item.href}
              item={item}
              active={isActive(current, item.href)}
              onNavigate={onNavigate}
              nested
            />
          ))}
        </div>
      ) : null}
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

/** A fly-out's category heading: navy uppercase label over the blue→teal rule.
 *  Shared by a section's own heading and its nested sub-groups (Productivity
 *  inside Insights) so the two can never drift apart. */
function FlyoutHeading({ label }: { label: string }) {
  return (
    <>
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
    </>
  )
}

/**
 * ClassName + style for a rail icon tile. The ACTIVE tile is filled with the
 * blue→teal gradient (white glyph on top) rather than the old flat blue tint, so
 * it matches the spine on the fly-out it opens. A gradient can't be expressed as
 * a background-color utility, hence the paired inline style.
 */
/* ---------------------------------------------------------------------------
 * TRIAL (2026-10-12) — icon-over-label TILES for the NON-CRM collapsed-rail
 * items (My Dashboard, Insights, Workflows, Admin): the same 42px box as the CRM
 * tiles, with a short caption under the icon. CRM tiles are untouched.
 *
 * WIDER-RAIL VARIANT — OFF (RAIL_FIT_WIDTH = false, reverted 2026-10-12 by
 * request; the labelled tiles stay). When true, the collapsed rail is sized to
 * its content (`width: max-content`) so the longest caption fits at a readable
 * 8px with light padding (~70px rail, every tile stretched to ~59px). Off = the
 * 58px rail, 42px tiles and 6.75px captions.
 *
 * TO REVERT IN ONE EDIT: set RAIL_LABEL_TILES = false. That restores the
 * previous rail exactly — the old values, kept here:
 *   rail width   SIDEBAR_COLLAPSED_WIDTH (58px, lib/sidebar.ts)
 *   non-CRM box  "flex size-9 items-center justify-center rounded-md transition-colors" (36px), icon size-[18px], no caption
 *   CRM box      "flex size-[42px] flex-col items-center justify-center gap-[1.5px] rounded-md transition-colors"
 *   CRM caption  "text-[6.75px] font-semibold uppercase leading-none tracking-[0.04em]"
 *   row          "flex justify-center py-px"
 *   rail footer  "px-1 py-2" (collapsed)
 * ------------------------------------------------------------------------- */
const RAIL_LABEL_TILES = true
/** The wider, content-sized rail with 8px captions (see above). Off. */
const RAIL_FIT_WIDTH = false
const RAIL_WIDE = RAIL_LABEL_TILES && RAIL_FIT_WIDTH
/** Captions under the icon — full single words that fit the 42px tile on one
 *  line (shorten one only if it genuinely won't fit; none of these need it). */
const RAIL_SHORT_LABEL: Record<string, string> = {
  "My Dash": "My Dash",
  // Section renamed "Client Insights" (2026-10-12); the rail caption is
  // deliberately still "Insights" — pending a separate decision.
  "Client Insights": "Insights",
  Workflows: "Workflow",
  Admin: "Admin",
}
const RAIL_ICON_CLASS = RAIL_LABEL_TILES ? "size-[17px]" : "size-[18px]"
/** One row of the rail: light side gutter in the trial. */
// Row padding py-px (2026-10-12: was py-[2px]) — 2px less per item so the
// full rail fits shorter, non-maximised windows without the scroll arrows.
const RAIL_ROW_CLASS = RAIL_WIDE ? "flex justify-center px-[5px] py-px" : "flex justify-center py-px"
const CRM_TILE_BOX_OLD =
  "flex size-[42px] flex-col items-center justify-center gap-[1.5px] rounded-md transition-colors"
/** The tile box: the fixed 42px CRM box; in the wider variant it fills the row
 *  and the widest caption sets the rail width. */
/* SIZING (2026-10-12): rail 58 -> 62px; tiles 42 -> 45px (square); glyphs
 * 16/15 -> 17/16px; captions 6.75 -> 7px; logo 40 -> 43px; rows py-px -> py-[2px];
 * footer avatar 28 -> 30px. Old values in the comments beside each. */
const RAIL_TILE_SIZED =
  "flex size-[45px] flex-col items-center justify-center gap-[1.5px] rounded-md transition-colors" // was size-[42px]
const RAIL_TILE_BOX = RAIL_FIT_WIDTH
  ? "flex h-[42px] w-full min-w-[42px] flex-col items-center justify-center gap-[2px] rounded-md px-[4px] transition-colors"
  : RAIL_TILE_SIZED
const CRM_CAPTION_OLD = "text-[6.75px] font-semibold uppercase leading-none tracking-[0.04em]"
/** Wider variant: one readable 8px caption style for every tile. */
const RAIL_CAPTION_WIDE = "whitespace-nowrap text-[8px] font-semibold uppercase leading-none tracking-[0.02em]"
/** Non-CRM caption: 6.75px with normal tracking so "DASHBOARD" fits 42px. */
const RAIL_CAPTION_CLASS = RAIL_FIT_WIDTH
  ? RAIL_CAPTION_WIDE
  : "whitespace-nowrap text-[7px] font-semibold uppercase leading-none tracking-normal" // was 6.75px
/** CRM caption at the current size (was CRM_CAPTION_OLD's 6.75px). */
const CRM_CAPTION = "text-[7px] font-semibold uppercase leading-none tracking-[0.04em]"

/** The caption under a non-CRM rail icon (trial) — nothing when the trial is off. */
function RailTileCaption({ label, active }: { label: string; active: boolean }) {
  if (!RAIL_LABEL_TILES) return null
  return (
    <span
      aria-hidden="true"
      className={cn(
        RAIL_CAPTION_CLASS,
        // Non-active caption (2026-10-12): one step deeper than the tile's
        // #9AA1AD (the icon keeps that) so it reads on the #F8F9FB resting fill;
        // on hover it follows the tile's #1E2858; active inherits white.
        !active && "text-[#7F8795] group-hover/railtile:text-[#1E2858]",
      )}
    >
      {RAIL_SHORT_LABEL[label] ?? label}
    </span>
  )
}

function railIconProps(active: boolean, extraClass?: string) {
  return {
    className: cn(
      RAIL_LABEL_TILES
        ? // Trial: the same tile as the CRM items, icon over a caption.
          RAIL_TILE_BOX
        : // 36px: a compact rail that still clears a comfortable tap target.
          "flex size-9 items-center justify-center rounded-md transition-colors",
      active
        ? "text-white"
        : // Non-active (2026-10-12): a soft resting fill one shade lighter than
          // the old hover (#F4F6F9), and a hover one shade darker — three gentle
          // steps: #F8F9FB rest → #EBEEF2 hover → active gradient (unchanged).
          "group/railtile bg-[#F8F9FB] text-[#9AA1AD] hover:bg-[#EBEEF2] hover:text-[#1E2858]",
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
  badge = 0,
}: {
  href: string
  label: string
  icon: React.ComponentType<{ className?: string }>
  active: boolean
  align?: "top" | "bottom"
  /** Red count bubble pinned to the icon; 0 hides it. */
  badge?: number
}) {
  // A LEAF (no sub-menu): a plain native tooltip, not a fly-out panel that
  // would only repeat the name (2026-10-12). Fly-outs are for sub-menus.
  void align
  return (
    <div className={RAIL_ROW_CLASS}>
      <Link
        href={href}
        title={label}
        aria-label={alertsAriaLabel(label, badge)}
        aria-current={active ? "page" : undefined}
        {...railIconProps(active, "relative")}
      >
        <Icon className={RAIL_ICON_CLASS} />
        <RailTileCaption label={label} active={active} />
        <RailAlertBubble count={badge} />
      </Link>
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
  section: NavSection & { items: NavItem[]; subgroups: NavSubgroup[] }
  current: string
}) {
  const { label, icon: Icon, items, defaultHref, subgroups } = section
  const every = allItemsOf(section)
  const active = every.some((item) => isActive(current, item.href))
  const target =
    every.find((item) => item.href === defaultHref)?.href ?? every[0].href
  const { open, setOpen, triggerProps, panelProps } = useFlyout()
  const panelId = React.useId()

  // Collapsed, this section icon is the ONLY visible surface for any page
  // inside it — so when Alerts is one of its (already access-filtered) children,
  // the bubble rides here. Hiding it in the fly-out would mean the badge only
  // appeared on hover, which defeats an at-a-glance cue.
  const alertCount = React.useContext(AlertCountContext)
  const badge = items.some((item) => item.href === ALERTS_ROUTE) ? alertCount : 0

  return (
    <div className={RAIL_ROW_CLASS} {...triggerProps}>
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
        <Icon className={RAIL_ICON_CLASS} />
        <RailTileCaption label={label} active={active} />
        <RailAlertBubble count={badge} />
      </Link>
      {open ? (
        <FlyoutPanel id={panelId} panelProps={panelProps}>
          <FlyoutHeading label={label} />
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
          {/* Nested sub-groups (Productivity inside Insights) get the SAME
              heading as the section, after a thin divider and extra top space
              so they read as their own group. Items keep the section's style. */}
          {subgroups.map((g) => (
            <div key={g.label}>
              <div aria-hidden="true" className="mx-2 mb-2.5 mt-2.5 h-px bg-[#E6E9EF]" />
              <FlyoutHeading label={g.label} />
              <ul className="space-y-0.5">
                {g.items.map(({ href, label: itemLabel }) => {
                  const itemActive = isActive(current, href)
                  return (
                    <li key={href}>
                      <Link
                        href={href}
                        aria-current={itemActive ? "page" : undefined}
                        className={cn(
                          "group/nav-item relative flex items-center gap-2 overflow-hidden rounded-md py-1 pl-3 pr-2 text-sm transition-colors",
                          itemActive
                            ? "font-medium text-[#1E2858]"
                            : "text-[#5B6472] hover:bg-[var(--rail-hover)] hover:text-[#1E2858]",
                        )}
                        style={{
                          ...({ "--rail-hover": RAIL_HOVER_TINT } as React.CSSProperties),
                          ...(itemActive ? { backgroundColor: RAIL_ACTIVE_TINT } : null),
                        }}
                      >
                        <span
                          aria-hidden="true"
                          className={cn(
                            "absolute inset-y-0 left-0 w-[3px] transition-transform duration-150 ease-out motion-reduce:transition-none",
                            itemActive ? "translate-x-0" : "-translate-x-full group-hover/nav-item:translate-x-0",
                          )}
                          style={{ backgroundColor: TEAL }}
                        />
                        <span className="truncate">{itemLabel}</span>
                      </Link>
                    </li>
                  )
                })}
              </ul>
            </div>
          ))}
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
  const dashCount = React.useContext(MyDashboardCountContext)

  return (
    <>
      {/* The non-CRM items (My Dash · Insights · Workflow) get a little extra
          breathing room between them — `gap-1` (4px) on this wrapper only; the
          CRM block below and the Admin row keep their own spacing. */}
      <div className="flex flex-col gap-1">
        {visibleSections(role, allowedRoutes).map((section) =>
          section.items.length > 0 || section.subgroups.length > 0 ? (
            <RailSection key={section.label} section={section} current={pathname} />
          ) : (
            <RailIconLink
              key={section.label}
              href={section.href!}
              label={section.label}
              icon={section.icon}
              active={isActive(pathname, section.href!)}
              badge={section.href === MY_DASHBOARD_ROUTE ? dashCount : 0}
            />
          ),
        )}
      </div>

      {/* CRM, pinned to the bottom of the rail — same gate, same treatment, just
          the icon and a 3-letter caption at 58px wide. Nothing renders here for
          a non-super-user. */}
      {crm.length > 0 ? (
        <div className="mt-auto pt-2">
          <RailCrmDivider />
          {groupCrmItems(crm).map((entry) =>
            entry.kind === "group" ? (
              <RailCrmGroup
                key={CRM_ACTIONS_LABEL}
                items={entry.items}
                current={pathname}
              />
            ) : (
              <RailCrmIconLink
                key={entry.item.href}
                item={entry.item}
                active={isActive(pathname, entry.item.href)}
              />
            ),
          )}
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
      {/* No "CRM" caption on the collapsed rail (2026-10-11) — the teal rule
          alone marks the block; the expanded sidebar keeps its label. */}
      <div className="mt-1.5 flex justify-center">
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
  // A LEAF: native tooltip only — its name is already printed on the tile, so a
  // fly-out panel would just repeat it (2026-10-12).
  return (
    <div className={RAIL_ROW_CLASS}>
      <Link
        href={href}
        title={label}
        aria-label={label}
        aria-current={active ? "page" : undefined}
        className={cn(
          RAIL_LABEL_TILES ? RAIL_TILE_BOX : CRM_TILE_BOX_OLD,
          // Mild hover wash on the NON-active tile only.
          !active && "hover:bg-[var(--crm-hover)]",
        )}
        style={{
          ...({ "--crm-hover": CRM_TEAL_HOVER_TINT } as React.CSSProperties),
          border: `1px solid ${CRM_TEAL_BORDER}`,
          // `undefined`, NOT "transparent", for the inactive tile: an inline
          // background-color outranks the `hover:bg-*` class above and would
          // silently cancel the hover wash.
          backgroundColor: active ? CRM_TEAL_TINT : undefined,
          color: CRM_TEAL,
          opacity: active ? 1 : 0.85,
        }}
      >
        <Icon className="size-4" />
        <span
          aria-hidden="true"
          className={RAIL_WIDE ? RAIL_CAPTION_WIDE : RAIL_LABEL_TILES ? CRM_CAPTION : CRM_CAPTION_OLD}
        >
          {label}
        </span>
      </Link>
    </div>
  )
}

/**
 * The "Actions" group in the COLLAPSED rail. The rail has no room to expand a
 * list in place, so it does what every other grouped rail row does (RailSection):
 * one tile whose hover/focus fly-out lists the children. The tile is a button,
 * not a link — clicking it toggles the fly-out rather than navigating. It is
 * drawn like a RailCrmIconLink and takes the active wash when the current page
 * is any of its children.
 */
function RailCrmGroup({ items, current }: { items: CrmItem[]; current: string }) {
  const active = items.some((item) => isActive(current, item.href))
  const { open, setOpen, triggerProps, panelProps } = useFlyout("bottom")
  const panelId = React.useId()

  return (
    <div className={RAIL_ROW_CLASS} {...triggerProps}>
      <button
        type="button"
        aria-label={CRM_ACTIONS_LABEL}
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        onClick={() => setOpen((v) => !v)}
        className={cn(
          RAIL_LABEL_TILES ? RAIL_TILE_BOX : CRM_TILE_BOX_OLD,
          !active && "hover:bg-[var(--crm-hover)]",
        )}
        style={{
          ...({ "--crm-hover": CRM_TEAL_HOVER_TINT } as React.CSSProperties),
          border: `1px solid ${CRM_TEAL_BORDER}`,
          backgroundColor: active ? CRM_TEAL_TINT : undefined,
          color: CRM_TEAL,
          opacity: active ? 1 : 0.85,
        }}
      >
        <Layers className="size-4" />
        <span
          aria-hidden="true"
          className={RAIL_WIDE ? RAIL_CAPTION_WIDE : RAIL_LABEL_TILES ? CRM_CAPTION : CRM_CAPTION_OLD}
        >
          {CRM_ACTIONS_LABEL}
        </span>
      </button>
      {open ? (
        <FlyoutPanel id={panelId} panelProps={panelProps}>
          <div className="px-2 pb-1 pt-0.5 text-[12px] font-medium uppercase tracking-wider text-[#1E2858]">
            {CRM_ACTIONS_LABEL}
          </div>
          <div
            aria-hidden="true"
            className="mx-2 mb-1.5 h-0.5 rounded-full"
            style={{ backgroundImage: RAIL_ACCENT_UNDERLINE }}
          />
          <ul className="space-y-0.5">
            {items.map(({ href, label, icon: Icon }) => {
              const itemActive = isActive(current, href)
              return (
                <li key={href}>
                  <Link
                    href={href}
                    onClick={() => setOpen(false)}
                    aria-current={itemActive ? "page" : undefined}
                    className={cn(
                      "flex w-full items-center gap-2 rounded-md py-1 pl-3 pr-2 text-sm transition-colors",
                      itemActive
                        ? "font-medium text-[#1E2858]"
                        : "text-[#5B6472] hover:bg-[var(--rail-hover)] hover:text-[#1E2858]",
                    )}
                    style={{
                      ...({ "--rail-hover": CRM_TEAL_HOVER_TINT } as React.CSSProperties),
                      ...(itemActive ? { backgroundColor: CRM_TEAL_TINT } : null),
                    }}
                  >
                    <span aria-hidden="true" className="flex shrink-0" style={{ color: CRM_TEAL }}>
                      <Icon className="size-3.5" />
                    </span>
                    {label}
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

/**
 * The profile / sign-out menu body — ONE definition shared by the collapsed
 * rail's avatar fly-out and the expanded footer's upward menu, so both read the
 * same (2026-10-12).
 */
function ProfileMenuBody({ email }: { email: string }) {
  return (
    <>
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
    </>
  )
}

/**
 * FOOTER LAYOUT (2026-10-12): the profile control and the collapse / expand
 * chevron share ONE row (was stacked). On the collapsed rail that row is
 * avatar (28px) + gap (3px) + chevron (20px) = 51px; it is used when the rail
 * gives at least 56px of usable width (the row plus a little air either side),
 * otherwise it falls back to the old stack (expand tab above the rule, avatar
 * below). The rail is 58px — 57px inside its border, the footer adds no side
 * padding in this layout — so the row is used.
 */
const RAIL_FOOTER_MIN_ROW_WIDTH = 56
const RAIL_FOOTER_SIDE_BY_SIDE = RAIL_WIDE || SIDEBAR_COLLAPSED_WIDTH - 1 >= RAIL_FOOTER_MIN_ROW_WIDTH

/** Collapsed counterpart of <UserPanel/>: an avatar whose fly-out (to the
 *  right) carries the email + sign-out, with the admin gear underneath. With
 *  `onExpand`, the expand chevron sits beside the avatar in the same row. */
function RailUserPanel({
  email,
  showAdmin,
  pathname,
  onExpand,
  controls,
}: {
  email: string
  showAdmin?: boolean
  pathname?: string
  /** Side-by-side footer: render the expand chevron next to the avatar. */
  onExpand?: () => void
  controls?: string
}) {
  const { open, setOpen, triggerProps, panelProps } = useFlyout("bottom")
  const panelId = React.useId()
  const initial = email.trim().charAt(0).toUpperCase() || "?"

  return (
    <div className="space-y-0.5">
      <div className={cn("flex items-center justify-center py-[3px]", onExpand && "gap-[3px]")}>
      <div className="flex" {...triggerProps}>
        <button
          type="button"
          aria-label={`Signed in as ${email}`}
          aria-expanded={open}
          aria-controls={open ? panelId : undefined}
          onClick={() => setOpen((v) => !v)}
          className={cn(
            "flex items-center justify-center rounded-full bg-[#EEF2FB] font-medium text-[#1E2858] transition-colors hover:bg-[#E2E9F7]",
            onExpand ? "size-[30px] text-xs" : "size-8 text-sm", // was size-7 (28px)
          )}
        >
          {initial}
        </button>
        {open ? (
          <FlyoutPanel id={panelId} panelProps={panelProps}>
            <ProfileMenuBody email={email} />
          </FlyoutPanel>
        ) : null}
      </div>
      {onExpand ? (
        <button
          type="button"
          onClick={onExpand}
          aria-label="Expand menu"
          aria-expanded={false}
          aria-controls={controls}
          title="Expand menu"
          className="flex h-7 w-5 shrink-0 items-center justify-center rounded-md border border-[#CFDBEF] bg-[#EEF2FB] text-[#1E2858] transition-colors hover:border-[#1E2858] hover:bg-[#1E2858] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0355A7]"
        >
          <ChevronsRight className="size-3.5" />
        </button>
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
      className="size-[43px] shrink-0 object-contain" // was size-10 (40px)
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
      className="h-auto w-full max-w-[136px] object-contain"
    />
  )
}

export function Sidebar({
  userEmail,
  role,
  allowedRoutes = [],
  defaultCollapsed = true,
  alertCount = 0,
  myDashboardCount = 0,
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
  /** Critical rows on My Dashboard for THIS viewer, from the root layout. 0
   *  hides the badge. See app/my-dashboard/critical-count.ts. */
  myDashboardCount?: number
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
    <MyDashboardCountContext.Provider value={myDashboardCount}>
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
          // Trial: collapsed = as wide as the longest caption needs (max-content);
          // interpolate-size lets the width transition animate to/from it.
          width: collapsed ? (RAIL_WIDE ? "max-content" : SIDEBAR_COLLAPSED_WIDTH) : SIDEBAR_EXPANDED_WIDTH,
          ...({ interpolateSize: "allow-keywords" } as React.CSSProperties),
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
            collapsed ? "px-2" : "px-4 pb-2.5 pt-3",
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
        {/* Stacked fallback (narrow rail) or no signed-in user: the expand tab
            stays above the rule. Otherwise it sits beside the avatar below. */}
        {collapsed && (!RAIL_FOOTER_SIDE_BY_SIDE || !userEmail) ? (
          <RailExpandTab onExpand={toggleCollapsed} controls={navId} />
        ) : null}
        {userEmail ? (
          <div
            className={cn(
              "border-t border-[#EDEFF3]",
              // Trial: no extra side padding, so the Admin tile lines up with
              // the rest (its row brings its own gutter). Old: "px-1 py-2".
              collapsed ? (RAIL_WIDE || RAIL_FOOTER_SIDE_BY_SIDE ? "py-2" : "px-1 py-2") : "px-3 py-2",
            )}
          >
            {collapsed ? (
              <RailUserPanel
                email={userEmail}
                showAdmin={showAdmin}
                pathname={pathname}
                onExpand={RAIL_FOOTER_SIDE_BY_SIDE ? toggleCollapsed : undefined}
                controls={navId}
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
    </MyDashboardCountContext.Provider>
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
  const [open, setOpen] = React.useState(false)
  const rootRef = React.useRef<HTMLDivElement>(null)
  const menuId = React.useId()
  const initial = email.trim().charAt(0).toUpperCase() || "?"

  // Close on an outside click or Escape. Listeners only while open.
  React.useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false)
    }
    document.addEventListener("mousedown", onDown)
    document.addEventListener("keydown", onKey)
    return () => {
      document.removeEventListener("mousedown", onDown)
      document.removeEventListener("keydown", onKey)
    }
  }, [open])

  // ONE row (2026-10-12; was "Signed in as" + a Sign out row): avatar + email
  // on the left opening the profile menu UPWARD (the footer is at the bottom,
  // so a downward menu would clip), the Admin gear, and the collapse chevron
  // pushed to the right edge.
  return (
    <div className="flex items-center gap-1.5">
      <div ref={rootRef} className="relative min-w-0 flex-1">
        <button
          type="button"
          aria-haspopup="menu"
          aria-expanded={open}
          aria-controls={open ? menuId : undefined}
          onClick={() => setOpen((v) => !v)}
          title={email}
          className="flex w-full min-w-0 items-center gap-2 rounded-md px-1.5 py-1 text-left transition-colors hover:bg-[#F4F6F9]"
        >
          <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-[#EEF2FB] text-xs font-medium text-[#1E2858]">
            {initial}
          </span>
          <span className="min-w-0 truncate text-xs text-[#5B6472]">{email}</span>
        </button>
        {open ? (
          <div
            id={menuId}
            className="absolute bottom-full left-0 z-50 mb-1.5 w-56 rounded-md border border-[#EDEFF3] bg-white p-1.5 shadow-lg"
          >
            <ProfileMenuBody email={email} />
          </div>
        ) : null}
      </div>
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
      {collapseToggle ? <div className="ml-auto shrink-0">{collapseToggle}</div> : null}
    </div>
  )
}
