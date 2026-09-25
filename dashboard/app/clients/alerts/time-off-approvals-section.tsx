"use client"

/**
 * Alerts → "Time Off Approvals": pending dashboard time-off requests where the
 * viewer is on the requester's reviewing team, with inline Approve / Deny.
 *
 * A CLIENT component only because of the buttons — the rest of the Alerts page
 * is a server component. Styled like the other section cards, with an
 * ACTION-NEEDED (blue, informational) treatment rather than a severity: these
 * rows are never counted in the Critical tile or the nav badge.
 *
 * The rows come from loadAlerts (./load.ts). Approve / Deny call the same
 * server action as the Time Off drawer, which re-checks everything.
 */

import Link from "next/link"

import { ReviewControls } from "@/app/time-off-requests/review-controls"
import { TestBadge } from "@/components/test-badge"
import { CARD_CLASS, STATUS_PILL_LIGHT, TEXT_MUTED, TEXT_PRIMARY } from "@/lib/design"
import { formatDays } from "@/lib/time-off-requests/model"
import type { TimeOffApprovals } from "./load"

function span(start: string, end: string): string {
  const f = (ymd: string) =>
    new Date(`${ymd}T12:00:00Z`).toLocaleDateString("en-US", {
      timeZone: "UTC",
      weekday: "short",
      month: "short",
      day: "numeric",
    })
  return start === end ? f(start) : `${f(start)} – ${f(end)}`
}

function Pill({ label, bg, text }: { label: string; bg: string; text: string }) {
  return (
    <span
      className="inline-flex shrink-0 items-center whitespace-nowrap rounded-full font-medium"
      style={{ padding: "3px 10px", fontSize: 11.5, background: bg, color: text }}
    >
      {label}
    </span>
  )
}

export function TimeOffApprovalsSection({ data }: { data: TimeOffApprovals }) {
  if (!data.isReviewer) return null
  const blue = STATUS_PILL_LIGHT.new

  return (
    <section className={CARD_CLASS + " overflow-hidden"}>
      <div
        className="flex flex-wrap items-center gap-x-3 gap-y-2 px-3.5 py-3"
        style={{ borderBottom: "1px solid rgba(16,24,40,0.07)" }}
      >
        <h2 className="font-semibold" style={{ fontSize: 14, color: TEXT_PRIMARY }}>
          Time Off Approvals
        </h2>
        <Pill label="You review" bg={STATUS_PILL_LIGHT.neutral.bg} text={STATUS_PILL_LIGHT.neutral.text} />
        <div className="ml-auto flex items-center gap-2">
          {data.rows.length > 0 && (
            <Pill label={`${data.rows.length + data.truncated} action needed`} bg={blue.bg} text={blue.text} />
          )}
          <Link href="/time-off-requests" className="text-[11.5px] hover:underline" style={{ color: TEXT_MUTED }}>
            Open Time Off →
          </Link>
        </div>
        <div className="w-full" style={{ fontSize: 11.5, color: TEXT_MUTED }}>
          Pending time-off requests from people whose reviewing team you are on · earliest first ·
          not counted as critical
        </div>
      </div>

      {data.error ? (
        <div
          className="px-3.5 py-3"
          style={{ fontSize: 12, color: STATUS_PILL_LIGHT.atRisk.text, background: STATUS_PILL_LIGHT.atRisk.bg }}
        >
          Could not load this section — {data.error}
        </div>
      ) : data.rows.length === 0 ? (
        <div className="px-3.5 py-5" style={{ fontSize: 12.5, color: TEXT_MUTED }}>
          Nothing waiting for your review. 🎉
        </div>
      ) : (
        <div className="divide-y" style={{ borderColor: "rgba(16,24,40,0.05)" }}>
          {data.rows.map((r) => (
            <div key={r.id} className="flex flex-wrap items-start gap-3 px-3.5 py-2.5">
              <span
                aria-hidden="true"
                className="mt-[7px] inline-block shrink-0 rounded-full"
                style={{ width: 8, height: 8, background: blue.text }}
              />
              <div className="w-[190px] min-w-0 shrink-0">
                <div className="flex items-center gap-1.5">
                  <span className="truncate font-semibold" style={{ fontSize: 12.5, color: TEXT_PRIMARY }}>
                    {r.requester ?? "Unknown"}
                  </span>
                  {r.isTest && <TestBadge />}
                </div>
                <div className="truncate" style={{ fontSize: 11.5, color: TEXT_MUTED }}>
                  {r.requestType}
                </div>
              </div>
              <div className="min-w-0 flex-1">
                <div className="truncate" style={{ fontSize: 12.5, color: TEXT_PRIMARY }}>
                  {span(r.startDate, r.endDate)} · {formatDays(r.totalDays)}
                </div>
                {r.description && (
                  <div className="truncate" style={{ fontSize: 11.5, color: TEXT_MUTED }} title={r.description}>
                    {r.description}
                  </div>
                )}
              </div>
              <div className="shrink-0">
                <ReviewControls id={r.id} disabledReason={data.actBlockedReason} compact />
              </div>
            </div>
          ))}
          {data.truncated > 0 && (
            <div className="px-3.5 py-2" style={{ fontSize: 11.5, color: TEXT_MUTED }}>
              + {data.truncated} more not shown
            </div>
          )}
        </div>
      )}
    </section>
  )
}
