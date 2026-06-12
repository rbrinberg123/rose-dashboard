import { cn } from "@/lib/utils"
import { CANVAS } from "@/lib/design"

/**
 * Reusable page header + body wrapper. Keeps spacing consistent across
 * dashboards and admin pages so we don't re-litigate margins on every page.
 */
export function PageShell({
  title,
  description,
  actions,
  children,
  hideHeader = false,
  canvas = false,
}: {
  title: string
  description?: string
  actions?: React.ReactNode
  children: React.ReactNode
  /**
   * Opt out of the thin top header row (title/description divider) for pages
   * that supply their own heading (e.g. a gradient banner). Defaults to false,
   * so every other page keeps the standard header.
   */
  hideHeader?: boolean
  /**
   * Lay the soft off-white design-system canvas full-bleed behind the content
   * (so white cards float on it). Opt-in per page, so un-converted pages keep
   * their plain white background.
   */
  canvas?: boolean
}) {
  return (
    <div className={cn("flex flex-col", canvas && "min-h-screen")}>
      {hideHeader ? null : (
        <header className="flex h-14 items-center justify-between border-b border-border bg-background/50 px-6 backdrop-blur">
          <div className="min-w-0">
            <h1 className="truncate text-base font-semibold">{title}</h1>
            {description ? (
              <p className="truncate text-xs text-muted-foreground">{description}</p>
            ) : null}
          </div>
          {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
        </header>
      )}
      <div
        className={cn("p-6", canvas && "flex-1")}
        style={canvas ? { background: CANVAS } : undefined}
      >
        {children}
      </div>
    </div>
  )
}

export function PlaceholderBody({ what }: { what: string }) {
  return (
    <div className="flex h-64 items-center justify-center rounded-lg border border-dashed border-border bg-muted/20 text-sm text-muted-foreground">
      {what} — placeholder. Will be implemented in a later phase.
    </div>
  )
}
