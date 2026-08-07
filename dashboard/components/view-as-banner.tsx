import { exitViewAsAction } from "@/app/view-as-actions"

/**
 * Slim banner pinned to the top of every page while a super-user is using
 * "View as" testing mode (person OR role). It is the ONE reliable exit from
 * impersonation — so it is rendered in the root layout OUTSIDE the sidebar
 * (which hides itself on some pages) and stays visible on scroll. The Exit
 * button posts to exitViewAsAction, which authorizes off the REAL role, so it
 * works even while viewing as a person/role that can't reach Admin.
 *
 * The layout builds `label` (e.g. "Viewing as Jane Smith — Logistics") and only
 * renders this when impersonation is active, so the app has ZERO footprint
 * until "View as" is turned on.
 */
export function ViewAsBanner({ label }: { label: string }) {
  return (
    <div className="sticky top-0 z-50 flex items-center justify-center gap-3 border-b border-amber-300 bg-amber-100 px-4 py-1.5 text-sm text-amber-900">
      <span className="font-medium">
        <span aria-hidden="true">👁 </span>
        {label}
      </span>
      <span className="text-amber-700">·</span>
      <span className="hidden text-amber-800 sm:inline">Super-user testing mode</span>
      <form action={exitViewAsAction} className="contents">
        <button
          type="submit"
          className="rounded-md bg-amber-900 px-2.5 py-1 text-xs font-semibold text-amber-50 transition-colors hover:bg-amber-800"
        >
          Exit view
        </button>
      </form>
    </div>
  )
}
