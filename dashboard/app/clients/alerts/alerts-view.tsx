import * as React from "react"
import Link from "next/link"
import { ChevronRight } from "lucide-react"

import { ListTitleCard } from "@/components/page-masthead"
import { StatCard } from "@/components/stat-card"
import { CARD_CLASS, STATUS_PILL_LIGHT, TEXT_MUTED, TEXT_PRIMARY } from "@/lib/design"
import {
  SEVERITY_LABEL,
  ageLabel,
  type AlertRow,
  type AlertSeverity,
} from "./alerts-policy"
import type { AlertsData, AlertsScopeChip, AlertsSection } from "./load"
import { TimeOffApprovalsSection } from "./time-off-approvals-section"

/**
 * The Alerts page surface. A SERVER component — the page is read-only with no
 * filters or interactivity, so there is nothing to hydrate and no reason to ship
 * this to the browser.
 *
 * Every colour here comes from the shared design tokens, so a severity reads the
 * same as the equivalent state elsewhere in the app:
 *   red    → STATUS_PILL_LIGHT.atRisk  (the "At Risk" tint)
 *   yellow → STATUS_PILL_LIGHT.watch   (the "Watch" tint)
 *   blue   → STATUS_PILL_LIGHT.new     (the neutral-informational tint)
 */

const SEVERITY_TINT: Record<AlertSeverity, { bg: string; text: string }> = {
  red: STATUS_PILL_LIGHT.atRisk,
  yellow: STATUS_PILL_LIGHT.watch,
  blue: STATUS_PILL_LIGHT.new,
}

/** The saturated dot colour — the pill's text colour, which is the dark end. */
const SEVERITY_DOT: Record<AlertSeverity, string> = {
  red: STATUS_PILL_LIGHT.atRisk.text,
  yellow: STATUS_PILL_LIGHT.watch.text,
  blue: STATUS_PILL_LIGHT.new.text,
}

// Three chips, no "unscoped" variant: every viewer is scoped, so a section is
// always one of these three. See the note at the top of ./load.ts.
const SCOPE_CHIP: Record<AlertsScopeChip, string> = {
  you: "Assigned to you",
  team: "Account team",
  host: "You host",
}

function Pill({
  label,
  bg,
  text,
  title,
}: {
  label: string
  bg: string
  text: string
  title?: string
}) {
  return (
    <span
      className="inline-flex shrink-0 items-center whitespace-nowrap rounded-full font-medium"
      style={{ padding: "3px 10px", fontSize: 11.5, background: bg, color: text }}
      title={title}
    >
      {label}
    </span>
  )
}

function SeverityDot({ severity }: { severity: AlertSeverity }) {
  return (
    <span
      aria-hidden="true"
      className="mt-[7px] inline-block shrink-0 rounded-full"
      style={{ width: 8, height: 8, background: SEVERITY_DOT[severity] }}
    />
  )
}

/** The severity legend — three dots and what they mean, once, under the header. */
function Legend({ threshold }: { threshold: number }) {
  const items: { severity: AlertSeverity; text: string }[] = [
    { severity: "red", text: "Critical — more than " + threshold + " days" },
    { severity: "yellow", text: "Needs attention — " + threshold + " days or fewer" },
    { severity: "blue", text: "Informational — listed, not scored" },
  ]
  return (
    <div
      className="flex flex-wrap items-center gap-x-5 gap-y-1.5"
      style={{ fontSize: 11.5, color: TEXT_MUTED }}
    >
      {items.map((i) => (
        <span key={i.severity} className="inline-flex items-center gap-1.5">
          <span
            aria-hidden="true"
            className="inline-block rounded-full"
            style={{ width: 8, height: 8, background: SEVERITY_DOT[i.severity] }}
          />
          {i.text}
        </span>
      ))}
    </div>
  )
}

/**
 * One alert row: severity dot · client (ticker + name) · item + meta · age
 * badge · severity pill · chevron. Red rows carry a faint tint and a matching
 * left edge so a critical row is findable without reading it.
 */
function AlertRowLine({ row }: { row: AlertRow }) {
  const tint = SEVERITY_TINT[row.severity]
  const age = ageLabel(row.ageDays)
  const isRed = row.severity === "red"

  const body = (
    <div
      className="flex items-start gap-3 px-3.5 py-2.5 transition-colors hover:bg-[rgba(16,24,40,0.02)]"
      style={
        isRed
          ? { background: "rgba(180,35,24,0.035)", boxShadow: "inset 2px 0 0 " + tint.text }
          : undefined
      }
    >
      <SeverityDot severity={row.severity} />

      {/* Client — ticker then name, the same pairing the CRM tables use. */}
      <div className="w-[190px] shrink-0 min-w-0">
        <div
          className="truncate font-semibold tabular-nums"
          style={{ fontSize: 12.5, color: TEXT_PRIMARY }}
        >
          {row.ticker ?? "—"}
        </div>
        <div className="truncate" style={{ fontSize: 11.5, color: TEXT_MUTED }}>
          {row.clientName ?? "Unknown client"}
        </div>
      </div>

      {/* The item itself, plus its meta line. */}
      <div className="min-w-0 flex-1">
        <div className="truncate" style={{ fontSize: 12.5, color: TEXT_PRIMARY }}>
          {row.title}
        </div>
        {row.meta.length > 0 && (
          <div className="truncate" style={{ fontSize: 11.5, color: TEXT_MUTED }}>
            {row.meta.join(" · ")}
          </div>
        )}
      </div>

      {/* Age badge — absent on informational rows, which have no age. */}
      <div className="w-[72px] shrink-0 text-right">
        {age && (
          <span
            className="tabular-nums"
            style={{ fontSize: 11.5, fontWeight: 500, color: isRed ? tint.text : TEXT_MUTED }}
          >
            {age}
          </span>
        )}
      </div>

      <Pill label={SEVERITY_LABEL[row.severity]} bg={tint.bg} text={tint.text} />

      <ChevronRight
        aria-hidden="true"
        className="mt-0.5 h-4 w-4 shrink-0"
        style={{ color: "#B6BCC7" }}
      />
    </div>
  )

  // The chevron goes to the client record — the one place every one of these
  // items can be acted on. Rows with no client id are not links (the chevron is
  // still drawn, so the rows stay aligned).
  return row.accountId ? (
    <Link
      href={"/client-detail?account_id=" + row.accountId}
      className="block focus:outline-none focus-visible:bg-[rgba(3,85,167,0.06)]"
    >
      {body}
    </Link>
  ) : (
    body
  )
}

function SectionCard({ section }: { section: AlertsSection }) {
  const { counts } = section
  const total = counts.red + counts.yellow + counts.blue

  return (
    <section className={CARD_CLASS + " overflow-hidden"}>
      <div
        className="flex flex-wrap items-center gap-x-3 gap-y-2 px-3.5 py-3"
        style={{ borderBottom: "1px solid rgba(16,24,40,0.07)" }}
      >
        <h2 className="font-semibold" style={{ fontSize: 14, color: TEXT_PRIMARY }}>
          {section.title}
        </h2>
        <Pill
          label={SCOPE_CHIP[section.scope]}
          bg={STATUS_PILL_LIGHT.neutral.bg}
          text={STATUS_PILL_LIGHT.neutral.text}
        />

        <div className="ml-auto flex items-center gap-2">
          {counts.red > 0 && (
            <Pill
              label={counts.red + " critical"}
              bg={SEVERITY_TINT.red.bg}
              text={SEVERITY_TINT.red.text}
            />
          )}
          {counts.yellow > 0 && (
            <Pill
              label={counts.yellow + " attention"}
              bg={SEVERITY_TINT.yellow.bg}
              text={SEVERITY_TINT.yellow.text}
            />
          )}
          {counts.blue > 0 && (
            <Pill
              label={String(counts.blue)}
              bg={SEVERITY_TINT.blue.bg}
              text={SEVERITY_TINT.blue.text}
            />
          )}
          <span className="tabular-nums" style={{ fontSize: 11.5, color: TEXT_MUTED }}>
            {total} {total === 1 ? "item" : "items"}
          </span>
        </div>

        <div className="w-full" style={{ fontSize: 11.5, color: TEXT_MUTED }}>
          {section.caption}
        </div>
      </div>

      {section.error ? (
        <div
          className="px-3.5 py-3"
          style={{ fontSize: 12, color: SEVERITY_TINT.red.text, background: SEVERITY_TINT.red.bg }}
        >
          Could not load this section — {section.error}
        </div>
      ) : section.rows.length === 0 ? (
        <div className="px-3.5 py-5" style={{ fontSize: 12.5, color: TEXT_MUTED }}>
          Nothing outstanding. 🎉
        </div>
      ) : (
        <div className="divide-y" style={{ borderColor: "rgba(16,24,40,0.05)" }}>
          {section.rows.map((r) => (
            <AlertRowLine key={r.key} row={r} />
          ))}
          {section.truncated > 0 && (
            <div className="px-3.5 py-2" style={{ fontSize: 11.5, color: TEXT_MUTED }}>
              + {section.truncated} more not shown
            </div>
          )}
        </div>
      )}
    </section>
  )
}

export function AlertsView({ data }: { data: AlertsData }) {
  const byKey = new Map(data.sections.map((s) => [s.key, s]))
  const tally = (key: AlertsSection["key"], sev: AlertSeverity) =>
    byKey.get(key)?.counts[sev] ?? 0
  const total = (key: AlertsSection["key"]) => {
    const c = byKey.get(key)?.counts
    return c ? c.red + c.yellow + c.blue : 0
  }

  // The summary strip. "Critical" and "Needs attention" are the scored sections
  // only (1–3); Hosting is informational and is counted in its own tile.
  // (A "Profiles in progress" tile sat between them until 2026-09-22 — see the
  // removal note in ./load.ts.)
  const critical =
    tally("collection", "red") + tally("pending_review", "red") + tally("open_claimed", "red")
  const attention =
    tally("collection", "yellow") +
    tally("pending_review", "yellow") +
    tally("open_claimed", "yellow")

  // One subtitle for everybody — there is no super-user variant, because there
  // is no super-user view of this page. See the note at the top of ./load.ts.
  const subtitle =
    "Your critical to-dos: feedback assigned to you, your account teams' reports, and the meetings you host." +
    (data.teamAccountCount != null
      ? " Account-team sections cover " +
        data.teamAccountCount +
        (data.teamAccountCount === 1 ? " client." : " clients.")
      : "")

  return (
    <>
      <div className="mb-4">
        <ListTitleCard eyebrow="Clients · Worklist" title="Alerts" subtitle={subtitle}>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <StatCard
              floating
              label="Critical"
              value={critical}
              valueColor={critical > 0 ? SEVERITY_TINT.red.text : undefined}
            />
            <StatCard
              floating
              label="Needs attention"
              value={attention}
              valueColor={attention > 0 ? SEVERITY_TINT.yellow.text : undefined}
            />
            <StatCard floating label="Feedback due" value={total("collection")} />
            <StatCard floating label="Hosting this week" value={total("hosting")} />
          </div>
          <div className="mt-3">
            <Legend threshold={10} />
          </div>
        </ListTitleCard>
      </div>

      {/* Two DIFFERENT empty states, kept apart on purpose: "you have nothing
          outstanding" and "we could not work out who you are" look identical on
          screen otherwise, and only one of them is good news. */}
      {data.viewerUnresolved && (
        <div
          className={CARD_CLASS + " mb-4 px-3.5 py-3"}
          style={{
            fontSize: 12.5,
            color: SEVERITY_TINT.yellow.text,
            background: SEVERITY_TINT.yellow.bg,
          }}
        >
          <strong>Your sign-in could not be matched to a CRM record</strong>, so Feedback
          collection and Hosting are showing nothing rather than nothing-outstanding. Ask an
          admin to check your user record in Dynamics.
        </div>
      )}

      {data.teamDenied && !data.viewerUnresolved && (
        <div
          className={CARD_CLASS + " mb-4 px-3.5 py-3"}
          style={{ fontSize: 12.5, color: TEXT_MUTED }}
        >
          You are not on any client&apos;s account team, so the three account-team sections
          below are empty. Team membership comes from the client record in Dynamics — ask an
          admin if that looks wrong.
        </div>
      )}

      <div className="flex flex-col gap-4">
        {/* Action-needed, so it leads — but it is not part of `sections` and
            never feeds the Critical tile or the nav badge. Renders nothing for
            a viewer who reviews nobody. */}
        <TimeOffApprovalsSection data={data.timeOff} />
        {data.sections.map((s) => (
          <SectionCard key={s.key} section={s} />
        ))}
      </div>
    </>
  )
}
