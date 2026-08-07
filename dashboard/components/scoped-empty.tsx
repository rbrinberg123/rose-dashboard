/**
 * Friendly empty / blocked states shown to a data-scoped user (Level-2 client
 * scoping). Rendered by the client-page loaders in place of rows the user isn't
 * entitled to see — so the page never looks broken, just scoped.
 */

export function NoClientsAssigned() {
  return (
    <div className="rounded-lg border bg-card p-6 text-sm text-muted-foreground">
      <div className="font-medium text-foreground">No clients assigned to you</div>
      <p className="mt-1">
        You can see clients where you&apos;re on the account team. There are none
        yet — ask an administrator if you think this is wrong.
      </p>
    </div>
  )
}

export function ClientNotInScope() {
  return (
    <div className="rounded-lg border bg-card p-6 text-sm text-muted-foreground">
      <div className="font-medium text-foreground">Client not available</div>
      <p className="mt-1">
        This client isn&apos;t in your account-team assignments, so it isn&apos;t
        available to you.
      </p>
    </div>
  )
}

export function StatsRestricted() {
  return (
    <div className="rounded-lg border bg-card p-6 text-sm text-muted-foreground">
      <div className="font-medium text-foreground">Not available with scoped access</div>
      <p className="mt-1">
        Client Statistics reports totals across the entire client book, so it
        isn&apos;t shown when your client access is limited to your account team.
      </p>
    </div>
  )
}
