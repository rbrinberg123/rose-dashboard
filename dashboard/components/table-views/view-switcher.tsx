"use client"

/**
 * The saved-view switcher — the old View-preset dropdown, grown up.
 *
 * SHARED by every CRM table. Lists System views (the entity's built-ins plus
 * any saved shared ones) and the signed-in user's own Personal views, grouped
 * and labelled. Changing it navigates to `?view=<id>`, which re-runs the server
 * query, so filtering stays server-side.
 *
 * ── WHAT THIS COMPONENT DOES NOT DECIDE ────────────────────────────────────
 * Nothing here is a security boundary. It hides controls the caller cannot use
 * (Save as System for a non-super-user, any write while impersonating) purely so
 * the UI does not offer a doomed click. Every action re-checks server-side in
 * lib/table-views/saved-views.ts, which is where the rules actually live. The
 * personal views in `views` were already filtered to the caller's own by that
 * file's query — this component never receives anyone else's.
 */

import * as React from "react"
import { useRouter } from "next/navigation"
import { Check, Star, Trash2 } from "lucide-react"

import { Button } from "@/components/ui/button"
import type { ActionResult } from "@/lib/actions"
import type { SavedView, SavedViewScope, ViewConfig } from "@/lib/table-views/types"
import { BUILTIN_PREFIX } from "@/lib/table-views/types"

/**
 * The four writes, injected rather than imported.
 *
 * Each entity binds its own spec to the shared saved-view actions
 * (lib/table-views/saved-views.ts) in its own "use server" module, and hands the
 * bound versions in here. That keeps this component free of any one entity — and
 * keeps the authorisation rules in the single shared implementation.
 */
export type ViewActions = {
  create: (input: {
    name: string
    scope: SavedViewScope
    config: ViewConfig
  }) => Promise<ActionResult<{ id: string }>>
  update: (input: { id: string; config: ViewConfig }) => Promise<ActionResult>
  setDefault: (input: { id: string | null; scope: SavedViewScope }) => Promise<ActionResult>
  remove: (input: { id: string }) => Promise<ActionResult>
}

export function ViewSwitcher({
  views,
  activeViewId,
  /** The config as currently edited — may differ from the active view's saved one. */
  workingConfig,
  dirty,
  counts,
  canManageSystemViews,
  readOnly,
  onError,
  actions,
  basePath,
}: {
  /** Bound saved-view writes for this entity — see ViewActions. */
  actions: ViewActions
  /** e.g. "/meetings" — where the switcher navigates. */
  basePath: string
  views: SavedView[]
  activeViewId: string
  workingConfig: ViewConfig
  dirty: boolean
  counts: Record<string, number | null>
  canManageSystemViews: boolean
  /** True while impersonating — every write is refused server-side anyway. */
  readOnly: boolean
  onError: (msg: string) => void
}) {
  const router = useRouter()
  const [busy, startBusy] = React.useTransition()
  const [managing, setManaging] = React.useState(false)

  const active = views.find((v) => v.id === activeViewId)
  const system = views.filter((v) => v.scope === "system")
  const personal = views.filter((v) => v.scope === "personal" && v.mine)

  /** Run a server action, surface its error, refresh on success. */
  const run = React.useCallback(
    (fn: () => Promise<{ ok: boolean; error?: string }>, after?: () => void) => {
      startBusy(async () => {
        const res = await fn()
        if (!res.ok) {
          onError(res.error ?? "Something went wrong.")
          return
        }
        after?.()
        router.refresh()
      })
    },
    [onError, router],
  )

  const switchTo = React.useCallback(
    (id: string) => {
      startBusy(() => {
        router.push(`${basePath}?view=${encodeURIComponent(id)}`)
      })
    },
    [basePath, router],
  )

  /** Save over the active view. Only offered for a view the caller may edit. */
  const canSaveOver =
    !!active && !active.builtin && (active.scope === "personal" ? active.mine : canManageSystemViews)

  const onSave = React.useCallback(() => {
    if (!active) return
    run(() => actions.update({ id: active.id, config: workingConfig }))
  }, [actions, active, run, workingConfig])

  const onSaveAs = React.useCallback(
    (scope: "personal" | "system") => {
      const suggested =
        active && !active.builtin ? `${active.name} copy` : (active?.name ?? "My view")
      const name = window.prompt(
        scope === "system" ? "Name for the new System view" : "Name for the new Personal view",
        suggested,
      )
      if (name === null) return
      run(async () => {
        const res = await actions.create({ name, scope, config: workingConfig })
        if (res.ok) router.push(`${basePath}?view=${encodeURIComponent(res.data.id)}`)
        return res
      })
    },
    [actions, active, basePath, router, run, workingConfig],
  )

  const onSetDefault = React.useCallback(() => {
    if (!active || active.builtin) return
    run(() => actions.setDefault({ id: active.id, scope: active.scope }))
  }, [actions, active, run])

  const onDelete = React.useCallback(
    (v: SavedView) => {
      if (!window.confirm(`Delete the ${v.scope} view “${v.name}”? This cannot be undone.`)) return
      run(async () => {
        const res = await actions.remove({ id: v.id })
        // Deleting the view you are looking at would leave a stale ?view=; drop
        // back to the default chain by navigating with no id.
        if (res.ok && v.id === activeViewId) router.push(basePath)
        return res
      })
    },
    [actions, activeViewId, basePath, router, run],
  )

  const label = (v: SavedView) => {
    const n = counts[v.id]
    const count = n === null || n === undefined ? "—" : n.toLocaleString()
    return `${v.name}${v.isDefault ? " ★" : ""} (${count})`
  }

  return (
    <>
      <label htmlFor="mtg-view" className="sr-only">
        View
      </label>
      <select
        id="mtg-view"
        value={activeViewId}
        onChange={(e) => switchTo(e.target.value)}
        className="h-9 max-w-[280px] rounded-md border border-input bg-background px-2 text-sm"
      >
        <optgroup label="System views">
          {system.map((v) => (
            <option key={v.id} value={v.id}>
              {label(v)}
            </option>
          ))}
        </optgroup>
        {personal.length > 0 && (
          <optgroup label="My views">
            {personal.map((v) => (
              <option key={v.id} value={v.id}>
                {label(v)}
              </option>
            ))}
          </optgroup>
        )}
      </select>

      {/* Unsaved-change marker: the working config has drifted from the saved
          view, so the row count on screen no longer matches its label. */}
      {dirty && (
        <span
          title="This view has unsaved column/filter changes"
          className="text-[11px] font-medium text-amber-700"
        >
          edited
        </span>
      )}

      {!readOnly && (
        <div className="flex items-center gap-1">
          {canSaveOver && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={busy || !dirty}
              onClick={onSave}
              title={dirty ? `Save over “${active?.name}”` : "No changes to save"}
              className="cursor-pointer"
            >
              <Check /> Save
            </Button>
          )}

          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={busy}
            onClick={() => onSaveAs("personal")}
            title="Save these columns and filters as a new personal view"
            className="cursor-pointer"
          >
            Save as…
          </Button>

          {canManageSystemViews && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={busy}
              onClick={() => onSaveAs("system")}
              title="Save as a System view, shared with everyone"
              className="cursor-pointer"
            >
              Save as System
            </Button>
          )}

          {active && !active.builtin && !active.isDefault && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={busy}
              onClick={onSetDefault}
              title={
                active.scope === "system"
                  ? "Make this the System default for everyone"
                  : "Open this view by default"
              }
              className="cursor-pointer"
            >
              <Star /> Set default
            </Button>
          )}

          {(personal.length > 0 || (canManageSystemViews && system.some((v) => !v.builtin))) && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setManaging((m) => !m)}
              className="cursor-pointer"
            >
              Manage…
            </Button>
          )}
        </div>
      )}

      {readOnly && (
        <span className="text-[11px] text-muted-foreground">
          Viewing as another user — saved views are read-only
        </span>
      )}

      {managing && !readOnly && (
        <div className="absolute left-6 top-12 z-40 w-[420px] rounded-lg border bg-card p-3 shadow-lg">
          <div className="mb-2 text-sm font-semibold">Manage views</div>
          {personal.length === 0 && (
            <div className="py-1 text-[13px] text-muted-foreground">No personal views yet.</div>
          )}
          {personal.map((v) => (
            <ManageRow key={v.id} view={v} busy={busy} onDelete={onDelete} />
          ))}

          {canManageSystemViews && system.some((v) => !v.builtin) && (
            <>
              <div className="mt-3 mb-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                System views
              </div>
              {system
                .filter((v) => !v.builtin)
                .map((v) => (
                  <ManageRow key={v.id} view={v} busy={busy} onDelete={onDelete} />
                ))}
              <div className="mt-1 text-[11px] text-muted-foreground">
                Built-in views cannot be edited or deleted.
              </div>
            </>
          )}

          <div className="mt-3 flex justify-end">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setManaging(false)}
              className="cursor-pointer"
            >
              Close
            </Button>
          </div>
        </div>
      )}
    </>
  )
}

function ManageRow({
  view,
  busy,
  onDelete,
}: {
  view: SavedView
  busy: boolean
  onDelete: (v: SavedView) => void
}) {
  return (
    <div className="flex items-center gap-2 rounded px-1 py-1 text-[13px] hover:bg-muted/50">
      <span className="flex-1 truncate" title={view.name}>
        {view.name}
      </span>
      {view.isDefault && <span className="text-[11px] text-muted-foreground">default</span>}
      <button
        type="button"
        disabled={busy}
        onClick={() => onDelete(view)}
        aria-label={`Delete ${view.name}`}
        title="Delete"
        className="cursor-pointer text-muted-foreground hover:text-destructive disabled:opacity-40"
      >
        <Trash2 className="size-3.5" />
      </button>
    </div>
  )
}

/** True for the code-defined views, which have no row to edit. */
export function isBuiltinId(id: string): boolean {
  return id.startsWith(BUILTIN_PREFIX)
}
