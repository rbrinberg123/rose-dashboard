/**
 * Reusable page header + body wrapper. Keeps spacing consistent across
 * dashboards and admin pages so we don't re-litigate margins on every page.
 */
export function PageShell({
  title,
  description,
  actions,
  children,
}: {
  title: string
  description?: string
  actions?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <div className="flex flex-col">
      <header className="flex h-14 items-center justify-between border-b border-border bg-background/50 px-6 backdrop-blur">
        <div className="min-w-0">
          <h1 className="truncate text-base font-semibold">{title}</h1>
          {description ? (
            <p className="truncate text-xs text-muted-foreground">{description}</p>
          ) : null}
        </div>
        {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
      </header>
      <div className="p-6">{children}</div>
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
