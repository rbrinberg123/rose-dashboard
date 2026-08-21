"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { ChevronRight } from "lucide-react"
import { cn } from "@/lib/utils"
import {
  BRAND_BLUE,
  BRAND_NAVY,
  RAIL_ACCENT_UNDERLINE,
  TEXT_MUTED,
  TEXT_PRIMARY,
  TEXT_TERTIARY,
} from "@/lib/design"
import type { ViewAsRole } from "@/lib/access-control"
import { TOP_BAR_HEIGHT } from "@/lib/sidebar"
import { isNavRouteActive, visibleNavSections } from "@/components/nav"

/**
 * SECTIONAL NAV STRIP — one shared component, one mount point.
 *
 * A slim orientation band above every page's hero ribbon: the current section's
 * name as an eyebrow, then a tab per sibling page in that section, with the
 * active page underlined in the brand blue→teal gradient.
 *
 * DESIGNED TO BE REMOVED IN ONE STEP. Everything lives in this file; nothing is
 * scattered across pages. To back it out: delete this file, drop the
 * `<SectionNav .../>` line + its import from `app/layout.tsx`, and (optionally)
 * un-export `visibleNavSections` / `isNavRouteActive` in `components/nav.tsx`.
 * No page component knows this exists.
 *
 * The section list is NOT duplicated here — it is derived from the same
 * `sections` array and the same `canAccessRoute` filter the sidebar renders
 * from, so a page added to (or revoked from) the nav shows up here with no
 * further edit, and the strip can never offer a tab the proxy would block.
 */
export function SectionNav({
  role,
  allowedRoutes,
}: {
  role: ViewAsRole | null
  allowedRoutes: readonly string[]
}) {
  const pathname = usePathname()
  if (!pathname) return null

  // Which section owns this URL? Match against the ACCESS-FILTERED item lists,
  // then keep the longest match: `/clients/to-do` must win over a hypothetical
  // `/clients`, since `isNavRouteActive` matches ancestors too.
  let section: ReturnType<typeof visibleNavSections>[number] | null = null
  let activeHref: string | null = null
  for (const candidate of visibleNavSections(role, allowedRoutes)) {
    for (const item of candidate.items) {
      if (!isNavRouteActive(pathname, item.href)) continue
      if (activeHref && item.href.length <= activeHref.length) continue
      section = candidate
      activeHref = item.href
    }
  }

  // No strip when the page isn't a nav section's child (detail pages reached by
  // drilling in, /admin, /login, the unlinked finance routes), and none for a
  // section with a single reachable page — a lone tab is noise, not navigation.
  // Direct-link sections (Institutions, Contracts) carry no items and so fall
  // out here too.
  if (!section || section.items.length < 2) return null

  // Where the section NAME points. Same rule the collapsed rail's section icon
  // uses, so the breadcrumb and the rail agree on "the Clients page": the
  // section's declared `defaultHref`, falling back to the first page the viewer
  // can actually reach. `items` is already access-filtered, so neither branch
  // can produce a route the proxy would block.
  const sectionHome =
    section.items.find((i) => i.href === section.defaultHref)?.href ??
    section.items[0].href

  return (
    <nav
      aria-label={`${section.label} pages`}
      // Height is the RAIL WIDTH, so the rail's logo box is a square at the
      // corner and this band's bottom rule continues the sidebar header's
      // across the top. Contents are centred in the band, not pinned to it.
      style={{ height: TOP_BAR_HEIGHT }}
      className="flex items-center border-b border-[#EAF0F7] bg-background px-6"
    >
      {/* One line: section label leading, tabs to its right. `items-baseline`
          on both rows sits the larger label and the smaller tabs on a shared
          baseline instead of centring two different type sizes against each
          other, so nothing rides high or low relative to its neighbours.

          Every child carries the SAME `pt-[7px] pb-[5px]`, never bottom-only
          padding. The bottom gutter is the active tab's underline; with nothing
          balancing it the padded box centres while the TEXT sits ~3.8px above
          the band's midline — that is what read as "not centred". The extra
          pixel on top (7 vs 5) is the optical correction: Geist reports a 1px
          descent that none of these labels actually use, so an exactly
          symmetric 6/6 still leaves the real ink band 0.8px high. Measured ink
          offset is now +0.2px off the midline. Don't collapse this back to
          `pb-` only, and keep the three children identical or they will
          stop sharing a baseline. */}
      <div className="flex min-w-0 flex-wrap items-baseline gap-x-4">
        {/* The section name is itself the breadcrumb's first crumb — it links to
            the section's landing page. Plain sans, uppercase, letter-spaced:
            navy and weight 800 carry the "section title" role on their own, so
            no serif, icon or gradient is involved. Colour travels as CSS
            variables because an inline `color` would outrank any `hover:`
            class, and the palette tokens shouldn't be re-typed as literals just
            to get a hover. */}
        <Link
          href={sectionHome}
          className="shrink-0 pt-[7px] pb-[5px] text-[14px] font-extrabold uppercase leading-[1.4] text-[var(--section-label)] transition-colors hover:text-[var(--section-label-hover)]"
          style={
            {
              letterSpacing: "0.12em",
              // Navy at rest, lifting to the brand blue on hover — the reverse
              // of the old pairing, so the hover stays visible now that the
              // resting colour is the darker of the two.
              "--section-label": BRAND_NAVY,
              "--section-label-hover": BRAND_BLUE,
            } as React.CSSProperties
          }
        >
          {section.label}
        </Link>
        {/* Breadcrumb separator: section › pages. Taller than the tab text so it
            anchors the row, but washed out to ~55% of the muted grey so it never
            competes with either side. `align-middle` centres it on the label's
            x-height — the row is baseline-aligned, and an un-nudged icon would
            hang off the baseline instead. The gap-x-4 on the row gives it 16px
            of air on both sides. */}
        <span
          aria-hidden="true"
          className="shrink-0 pt-[7px] pb-[5px] text-[14px] leading-[1.4]"
          style={{ color: `color-mix(in srgb, ${TEXT_TERTIARY} 55%, white)` }}
        >
          {/* align-middle lands on baseline + half x-height, which measures
              1.3px BELOW the text's optical centre; the 1px transform nudge
              closes that without touching layout (measured +0.3px after). */}
          <ChevronRight className="inline-block size-[18px] -translate-y-px align-middle" />
        </span>
        {/* items-baseline so every tab's underline lands on one line even if the
            row wraps on a narrow viewport. */}
        <ul className="flex flex-wrap items-baseline gap-x-5">
          {section.items.map((item) => {
            const active = item.href === activeHref
            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "relative block pt-[7px] pb-[5px] text-[13px] leading-[1.4] transition-colors",
                    active ? "font-semibold" : "font-medium hover:text-[#1A2233]",
                  )}
                  style={{ color: active ? TEXT_PRIMARY : TEXT_MUTED }}
                >
                  {item.label}
                  {active ? (
                    /* Same blue→teal token the rail's fly-out rule and the
                       masthead accent strip are built from. */
                    <span
                      aria-hidden="true"
                      className="absolute inset-x-0 bottom-0 h-[2px] rounded-full"
                      style={{ backgroundImage: RAIL_ACCENT_UNDERLINE }}
                    />
                  ) : null}
                </Link>
              </li>
            )
          })}
        </ul>
      </div>
    </nav>
  )
}
