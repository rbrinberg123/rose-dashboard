/**
 * Shared segmented control. Styled to match the Scheduler page's view/day
 * toggles exactly (bordered card container, navy active button, hover-gray
 * inactive) so every toggle in the app reads identically. Presentational —
 * the caller owns the selected value and the onChange handler.
 */
export function SegmentedToggle<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T
  onChange: (v: T) => void
  options: Array<{ value: T; label: string }>
}) {
  return (
    <div className="flex h-9 items-center rounded-md border border-border bg-card p-0.5">
      {options.map((o) => {
        const active = o.value === value
        return (
          <button
            key={o.value}
            type="button"
            onClick={() => onChange(o.value)}
            className={
              "rounded px-2.5 py-1 text-xs font-medium transition-colors " +
              (active ? "bg-[#1E2858] text-white" : "text-foreground hover:bg-slate-50")
            }
          >
            {o.label}
          </button>
        )
      })}
    </div>
  )
}
