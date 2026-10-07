import type { Metadata } from "next"
import { redirect } from "next/navigation"

import { PageShell } from "@/components/page-shell"
import { ListTitleCard } from "@/components/page-masthead"
import { canAccessRoute } from "@/lib/access-control"
import { getEffectiveRole } from "@/lib/effective-identity"
import { getAllowedRoutes } from "@/lib/page-access"
import { CARD_CLASS, STATUS_PILL_LIGHT, TEXT_MUTED, TEXT_PRIMARY } from "@/lib/design"
import { AUTOMATIONS, type Automation, type AutomationKind } from "@/lib/automations/registry"

export const metadata: Metadata = { title: "Automations" }

const ROUTE = "/admin/automations"
const KIND_ORDER: AutomationKind[] = ["Event-driven", "Scheduled job", "Database trigger"]

/**
 * Admin → Automations — the catalogue of every automation, rendered from the
 * code-defined registry in lib/automations/registry.ts (the single source of
 * truth: adding an automation means adding an entry there). Super-user only
 * via ADMIN_ONLY_ROUTES; re-checked here. Read-only.
 */
export default async function AutomationsPage() {
  const role = await getEffectiveRole()
  const allowed = await getAllowedRoutes(role)
  if (!canAccessRoute(role, ROUTE, allowed)) redirect(allowed[0] ?? "/no-access")

  const active = AUTOMATIONS.filter((a) => a.status === "Active").length
  const planned = AUTOMATIONS.length - active

  return (
    <PageShell title="Automations" hideHeader canvas>
      <div className="mb-4">
        <ListTitleCard
          compact
          eyebrow="Admin"
          title="Automations"
          subtitle={`Every automation in the IQ dashboard — ${active} active, ${planned} planned. Defined in lib/automations/registry.ts; adding an automation means adding an entry there.`}
        />
      </div>

      <div className="flex flex-col gap-5">
        {KIND_ORDER.map((kind) => {
          const list = AUTOMATIONS.filter((a) => a.kind === kind)
          if (list.length === 0) return null
          return (
            <section key={kind}>
              <div className="mb-2 flex items-center gap-3">
                <h2 className="shrink-0 text-base font-medium" style={{ color: TEXT_PRIMARY }}>
                  {kind === "Event-driven" ? "Event-driven" : kind + "s"}
                </h2>
                <span className="text-xs tabular-nums" style={{ color: TEXT_MUTED }}>
                  {list.length}
                </span>
                <span className="h-px flex-1 bg-border" />
              </div>
              <div className={CARD_CLASS + " overflow-x-auto"}>
                <table className="w-full table-fixed text-[13px]">
                  <colgroup>
                    <col style={{ width: "17%" }} />
                    <col style={{ width: "19%" }} />
                    <col style={{ width: "27%" }} />
                    <col style={{ width: "21%" }} />
                    <col style={{ width: "16%" }} />
                  </colgroup>
                  <thead className="bg-slate-50 text-xs uppercase tracking-wide text-muted-foreground">
                    <tr>
                      <th className="px-3 py-2 text-left font-medium">Automation</th>
                      <th className="px-3 py-2 text-left font-medium">Trigger</th>
                      <th className="px-3 py-2 text-left font-medium">Effect</th>
                      <th className="px-3 py-2 text-left font-medium">Scope / conditions</th>
                      <th className="px-3 py-2 text-left font-medium">Applies to</th>
                    </tr>
                  </thead>
                  <tbody>
                    {list.map((a) => (
                      <Row key={a.id} a={a} />
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )
        })}
      </div>
    </PageShell>
  )
}

function Row({ a }: { a: Automation }) {
  const planned = a.status === "Planned"
  return (
    <tr className="border-b align-top last:border-0">
      <td className="px-3 py-2.5">
        <div className="font-medium" style={{ color: TEXT_PRIMARY }}>
          {a.name}
        </div>
        <span
          className="mt-1 inline-block rounded-full px-2 py-0.5 text-[11px] font-medium"
          style={{
            background: planned ? STATUS_PILL_LIGHT.neutral.bg : STATUS_PILL_LIGHT.positive.bg,
            color: planned ? STATUS_PILL_LIGHT.neutral.text : STATUS_PILL_LIGHT.positive.text,
          }}
        >
          {a.status}
        </span>
      </td>
      <td className="px-3 py-2.5" style={{ color: TEXT_MUTED }}>
        {a.trigger}
      </td>
      <td className="px-3 py-2.5" style={{ color: TEXT_PRIMARY }}>
        {a.effect}
        {a.notes && (
          <div className="mt-1 text-xs" style={{ color: TEXT_MUTED }}>
            {a.notes}
          </div>
        )}
      </td>
      <td className="px-3 py-2.5" style={{ color: TEXT_MUTED }}>
        {a.scope}
      </td>
      <td className="px-3 py-2.5" style={{ color: TEXT_MUTED }}>
        {a.applicability}
        {a.where.length > 0 && (
          <div className="mt-1 break-words font-mono text-[10.5px] leading-snug" style={{ color: TEXT_MUTED }}>
            {a.where.map((w) => (
              <div key={w}>{w}</div>
            ))}
          </div>
        )}
      </td>
    </tr>
  )
}
