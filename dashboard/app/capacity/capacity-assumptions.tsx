import * as React from "react"
import { Info } from "lucide-react"
import { CARD_CLASS, TEXT_PRIMARY, TEXT_MUTED, TEXT_SECONDARY } from "@/lib/design"

// ---- Shared capacity palette ------------------------------------------------
// One source of truth for the stacked-bar segment colors. The assumptions key
// and the Stage-3 chart both draw from here so they can never drift apart.
export const CAP_BOOKING = "#0355A7" // blue   — booking (attributed to booker)
export const CAP_HOSTING = "#1C8C9C" // teal   — hosting (attributed to host)
export const CAP_FEEDBACK = "#0E7C56" // green  — feedback collected (host)
export const CAP_ACCOUNT = "#7A5AF0" // violet — account management (distinct from booking blue)
export const CAP_OVERHEAD = "#E3E7ED" // gray   — unmodeled remainder
export const CAP_OVER = "#A32D2D" // red    — over capacity (accounted > available)

// ---- Modeled activity → hours rates ----------------------------------------
// The per-activity hour rates that turn raw meeting/role counts into hours.
// Listed in the panel so the model is fully transparent on the page itself.
const ACTIVITY_RATES: Array<{ label: string; hours: string; segment?: string }> = [
  { label: "Book a virtual meeting", hours: "1.0 h", segment: CAP_BOOKING },
  { label: "Book a live / in-person meeting", hours: "1.5 h", segment: CAP_BOOKING },
  { label: "Host a virtual meeting", hours: "1.5 h", segment: CAP_HOSTING },
  { label: "Host a live / in-person meeting", hours: "3.0 h", segment: CAP_HOSTING },
  {
    label: "Collect feedback (meeting marked “Closed - All in”, host-attributed)",
    hours: "1.0 h",
    segment: CAP_FEEDBACK,
  },
]

function RateRow({
  label,
  hours,
  segment,
}: {
  label: string
  hours: string
  segment?: string
}) {
  return (
    <div className="flex items-baseline gap-2 py-[3px]">
      {segment ? (
        <span
          className="mt-1 inline-block size-2 shrink-0 rounded-sm"
          style={{ background: segment }}
          aria-hidden="true"
        />
      ) : (
        <span className="mt-1 inline-block size-2 shrink-0" aria-hidden="true" />
      )}
      <span className="flex-1 text-[13.5px]" style={{ color: TEXT_SECONDARY }}>
        {label}
      </span>
      <span
        className="shrink-0 text-[13.5px] font-semibold tabular-nums"
        style={{ color: TEXT_PRIMARY }}
      >
        {hours}
      </span>
    </div>
  )
}

function Block({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div
        className="mb-1.5 text-[12px] font-semibold uppercase tracking-wide"
        style={{ color: TEXT_MUTED }}
      >
        {title}
      </div>
      {children}
    </div>
  )
}

/**
 * Assumptions panel for the Capacity page. States the full model on the page:
 * the available-hours basis, every activity → hours rate, how each activity is
 * attributed, and what Overhead / Over capacity mean. Also renders the color
 * key for the stacked bars built in Stage 3.
 */
export function CapacityAssumptions() {
  return (
    <div className={`p-5 ${CARD_CLASS}`}>
      <div className="mb-4 flex items-start gap-2.5">
        <span
          className="mt-0.5 flex size-7 items-center justify-center rounded-lg"
          style={{ background: "#EEF2FB", color: CAP_BOOKING }}
        >
          <Info className="size-4" />
        </span>
        <div>
          <div className="text-[15px] font-semibold" style={{ color: TEXT_PRIMARY }}>
            Assumptions
          </div>
          <div className="text-[12.5px]" style={{ color: TEXT_MUTED }}>
            How available hours and modeled-activity hours are estimated. These are
            planning assumptions, not tracked time.
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-x-8 gap-y-5 lg:grid-cols-2">
        {/* Basis */}
        <Block title="Available hours (basis)">
          <p className="text-[13.5px] leading-relaxed" style={{ color: TEXT_SECONDARY }}>
            An 8-hour day and 40-hour week. Available hours for the selected range ={" "}
            <span style={{ color: TEXT_PRIMARY, fontWeight: 600 }}>
              (weekdays in the range) × 8
            </span>
            . Weekends are excluded; holidays are not modeled.
          </p>
        </Block>

        {/* Account management */}
        <Block title="Account management">
          <p className="text-[13.5px] leading-relaxed" style={{ color: TEXT_SECONDARY }}>
            <span style={{ color: TEXT_PRIMARY, fontWeight: 600 }}>3 h per client per month</span>{" "}
            for each assigned role — Account Manager, Secondary Manager, and Associate
            — counted from the account role fields. Ranges shorter or longer than a
            month are prorated by the fraction of a month they cover.
          </p>
        </Block>

        {/* Activity rates */}
        <Block title="Activity → hours">
          <div className="flex flex-col">
            {ACTIVITY_RATES.map((r) => (
              <RateRow key={r.label} label={r.label} hours={r.hours} segment={r.segment} />
            ))}
          </div>
        </Block>

        {/* Attribution + overhead */}
        <div className="flex flex-col gap-5">
          <Block title="Attribution">
            <p className="text-[13.5px] leading-relaxed" style={{ color: TEXT_SECONDARY }}>
              Confirmed meetings only. Booking hours go to the booker; hosting and
              feedback hours go to the host. The virtual vs. live split uses the
              meeting type / in-person flag.
            </p>
          </Block>

          <Block title="Overhead & over capacity">
            <p className="text-[13.5px] leading-relaxed" style={{ color: TEXT_SECONDARY }}>
              <span style={{ color: TEXT_PRIMARY, fontWeight: 600 }}>Overhead</span> ={" "}
              available − accounted hours: time{" "}
              <span style={{ fontStyle: "italic" }}>not captured by these modeled
              activities</span>{" "}
              — not idle time. If accounted hours exceed available hours, the person is
              shown <span style={{ color: CAP_OVER, fontWeight: 600 }}>over capacity</span>{" "}
              (above 100%), not capped.
            </p>
          </Block>
        </div>
      </div>
    </div>
  )
}
