"use client"

import { useMemo, useState } from "react"
import Link from "next/link"
import { FileText } from "lucide-react"
import { ListTitleCard } from "@/components/page-masthead"
import { StatCard } from "@/components/stat-card"
import { CARD_CLASS } from "@/lib/design"
import { formatCurrency, formatDate } from "@/lib/format"
import { DaysLeftPill, AutoRenewFlag } from "@/components/contract-fields"
import type { ContractManagementRow } from "@/lib/types"

const NAVY = "#1E2858"
const TEAL = "#00B8B8"
const RED = "#C53030"
const AMBER = "#B7791F"
const GREEN = "#2D7A2D"
const GRAY_BG = "#E5E7EB"
const GRAY_FG = "#6B7280"
const RED_BG = "#FED7D7"
const AMBER_BG = "#FEEBC8"
const GREEN_BG = "#C6F6D5"

type FilterKey = "all" | "expiring" | "no-autorenew" | "no-contract"

function daysFromToday(dateStr: string | null): number | null {
  if (!dateStr) return null
  const d = new Date(dateStr + "T00:00:00")
  if (Number.isNaN(d.getTime())) return null
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  return Math.round((d.getTime() - today.getTime()) / (1000 * 60 * 60 * 24))
}

export function ContractManagementView({
  rows,
}: {
  rows: ContractManagementRow[]
}) {
  const [filter, setFilter] = useState<FilterKey>("all")

  const filteredRows = useMemo(() => {
    switch (filter) {
      case "expiring":
        return rows.filter(
          (r) => r.days_to_expiry !== null && r.days_to_expiry <= 90,
        )
      case "no-autorenew":
        return rows.filter(
          (r) => r.has_active_contract === true && r.auto_renew === false,
        )
      case "no-contract":
        return rows.filter((r) => r.has_active_contract === false)
      default:
        return rows
    }
  }, [rows, filter])

  const counts = useMemo(() => {
    const all = rows.length
    const expiring = rows.filter(
      (r) => r.days_to_expiry !== null && r.days_to_expiry <= 90,
    ).length
    const noAutoRenew = rows.filter(
      (r) => r.has_active_contract === true && r.auto_renew === false,
    ).length
    const noContract = rows.filter((r) => r.has_active_contract === false).length
    return { all, expiring, noAutoRenew, noContract }
  }, [rows])

  const kpis = useMemo(() => {
    const total = rows.length
    const withActive = rows.filter((r) => r.has_active_contract).length
    const expiringUnder30 = rows.filter(
      (r) => r.days_to_expiry !== null && r.days_to_expiry < 30,
    ).length
    const expiring30to90 = rows.filter(
      (r) =>
        r.days_to_expiry !== null &&
        r.days_to_expiry >= 30 &&
        r.days_to_expiry <= 90,
    ).length
    const noContract = rows.filter((r) => !r.has_active_contract).length
    const autoRenewOn = rows.filter(
      (r) => r.has_active_contract && r.auto_renew === true,
    ).length
    const autoRenewPct =
      withActive > 0 ? Math.round((autoRenewOn / withActive) * 100) : 0
    return {
      total,
      withActive,
      expiringUnder30,
      expiring30to90,
      noContract,
      autoRenewOn,
      autoRenewPct,
    }
  }, [rows])

  const pills: { key: FilterKey; label: string }[] = [
    { key: "all", label: `All clients (${counts.all})` },
    { key: "expiring", label: `Expiring soon (${counts.expiring})` },
    { key: "no-autorenew", label: `Auto-renew off (${counts.noAutoRenew})` },
    { key: "no-contract", label: `No contract (${counts.noContract})` },
  ]

  return (
    <>
      <div className="mb-6">
        <ListTitleCard
          title="Contract Management"
          subtitle="All active clients · sorted by soonest contract expiry"
        />
      </div>

      <div className="mb-6 grid grid-cols-2 gap-2 md:grid-cols-3 lg:grid-cols-5">
        <StatCard
          floating
          label="Active Clients"
          value={kpis.total.toLocaleString()}
          hint={`${kpis.withActive} with active contract`}
        />
        <StatCard
          floating
          label="Expiring < 30 days"
          value={kpis.expiringUnder30.toLocaleString()}
          hint="Action needed"
          valueColor={RED}
        />
        <StatCard
          floating
          label="Expiring 30–90 days"
          value={kpis.expiring30to90.toLocaleString()}
          hint="Approaching renewal"
          valueColor={AMBER}
        />
        <StatCard
          floating
          label="No Active Contract"
          value={kpis.noContract.toLocaleString()}
          hint="Active client, no contract"
        />
        <StatCard
          floating
          label="Auto-Renew On"
          value={`${kpis.autoRenewPct}%`}
          hint={`${kpis.autoRenewOn} of ${kpis.withActive} contracts`}
          valueColor={TEAL}
        />
      </div>

      <div className="mb-3 flex flex-wrap gap-2">
        {pills.map(({ key, label }) => {
          const active = filter === key
          return (
            <button
              key={key}
              type="button"
              onClick={() => setFilter(key)}
              className={
                "rounded-full border px-3 py-1 text-xs font-medium transition-colors " +
                (active
                  ? "bg-[#1E2858] text-white border-[#1E2858]"
                  : "bg-white border-border text-foreground hover:bg-slate-50")
              }
            >
              {label}
            </button>
          )
        })}
      </div>

      <p className="mb-3 text-xs italic text-muted-foreground">
        Days Left:{" "}
        <span
          className="not-italic inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium"
          style={{ backgroundColor: RED_BG, color: RED }}
        >
          &lt; 30 d
        </span>{" "}
        urgent ·{" "}
        <span
          className="not-italic inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium"
          style={{ backgroundColor: AMBER_BG, color: AMBER }}
        >
          30–89 d
        </span>{" "}
        approaching ·{" "}
        <span
          className="not-italic inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium"
          style={{ backgroundColor: GREEN_BG, color: GREEN }}
        >
          90+ d
        </span>{" "}
        healthy ·{" "}
        <span
          className="not-italic inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium"
          style={{ backgroundColor: GRAY_BG, color: GRAY_FG }}
        >
          No contract
        </span>
        . Auto-Renew: <span style={{ color: GREEN }}>●</span> on,{" "}
        <span style={{ color: RED }}>○</span> off.
      </p>

      <div className={`overflow-hidden ${CARD_CLASS}`}>
        <div className="flex flex-row items-center justify-between border-b px-4 py-3">
          <h2
            className="text-base font-semibold"
            style={{ color: NAVY }}
          >
            Contracts
          </h2>
          <span className="text-xs text-muted-foreground tabular-nums">
            {filteredRows.length} of {rows.length} clients
          </span>
        </div>
        <div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 text-left font-medium">Client</th>
                  <th className="px-3 py-2 text-center font-medium">
                    Contracts
                  </th>
                  <th className="px-3 py-2 text-right font-medium">
                    Quarterly $
                  </th>
                  <th className="px-3 py-2 text-left font-medium">Start</th>
                  <th className="px-3 py-2 text-left font-medium">Term</th>
                  <th className="px-3 py-2 text-left font-medium">Term End</th>
                  <th className="px-3 py-2 text-center font-medium">
                    Days Left
                  </th>
                  <th className="px-3 py-2 text-left font-medium">
                    Notice Date
                  </th>
                  <th className="px-3 py-2 text-left font-medium">Check-In</th>
                  <th className="px-3 py-2 text-center font-medium">
                    Auto-Renew
                  </th>
                  <th className="px-3 py-2 text-left font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {filteredRows.map((r) => {
                  const inactive = !r.has_active_contract
                  const noticeDays = daysFromToday(r.renewal_notice_date)
                  const noticeRed =
                    noticeDays !== null && noticeDays <= 30
                  const dash = (
                    <span className="text-muted-foreground">—</span>
                  )
                  const contractUrl = r.contract_url?.trim() || null
                  return (
                    <tr
                      key={r.account_id}
                      className={
                        "border-b last:border-0 " +
                        (inactive ? "bg-slate-50 opacity-60" : "")
                      }
                    >
                      <td className="px-3 py-2 text-left">
                        <span className="inline-flex items-center gap-1.5">
                          <Link
                            href={`/client-detail?account_id=${r.account_id}`}
                            className="font-medium text-[#1E2858] hover:underline"
                          >
                            {r.client_name}
                          </Link>
                          {contractUrl ? (
                            <a
                              href={contractUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              title="Open contract"
                              aria-label="Open contract"
                              className="text-muted-foreground transition-colors hover:text-[#1E2858]"
                            >
                              <FileText className="size-3.5" aria-hidden="true" />
                            </a>
                          ) : null}
                        </span>
                      </td>
                      <td
                        className="px-3 py-2 text-center tabular-nums"
                        style={{ color: inactive ? GRAY_FG : undefined }}
                      >
                        {r.total_contract_count}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {inactive ? dash : formatCurrency(r.quarterly_retainer)}
                      </td>
                      <td className="px-3 py-2 text-left">
                        {inactive ? dash : formatDate(r.contract_start_date)}
                      </td>
                      <td className="px-3 py-2 text-left">
                        {inactive
                          ? dash
                          : r.initial_term_length_label ?? "—"}
                      </td>
                      <td className="px-3 py-2 text-left">
                        {inactive ? dash : formatDate(r.initial_term_end)}
                      </td>
                      <td className="px-3 py-2 text-center">
                        <DaysLeftPill
                          days={inactive ? null : r.days_to_expiry}
                          hasContract={r.has_active_contract}
                          totalContractCount={r.total_contract_count}
                        />
                      </td>
                      <td
                        className="px-3 py-2 text-left"
                        style={{
                          color: !inactive && noticeRed ? RED : undefined,
                        }}
                      >
                        {inactive ? dash : formatDate(r.renewal_notice_date)}
                      </td>
                      <td className="px-3 py-2 text-left">
                        {inactive
                          ? dash
                          : formatDate(r.renewal_check_in_date)}
                      </td>
                      <td className="px-3 py-2 text-center text-base">
                        <AutoRenewFlag value={inactive ? null : r.auto_renew} />
                      </td>
                      <td className="px-3 py-2 text-left">
                        {inactive
                          ? dash
                          : r.contract_status_label ?? "—"}
                      </td>
                    </tr>
                  )
                })}
                {filteredRows.length === 0 && (
                  <tr>
                    <td
                      colSpan={11}
                      className="px-3 py-8 text-center text-sm text-muted-foreground"
                    >
                      No clients match this filter.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </>
  )
}
