"use client"

/**
 * The itinerary builder: header + tabs (Schedule · Attendees · Invites ·
 * Export · Activity). Re-sync from CRM is shown but not live yet.
 */

import * as React from "react"
import Link from "next/link"
import { ArrowLeft, CalendarRange, FileDown, History, Mail, RefreshCw, Eye } from "lucide-react"

import { ListTitleCard } from "@/components/page-masthead"
import { Button } from "@/components/ui/button"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { STATUS_PILL_LIGHT, TEXT_MUTED } from "@/lib/design"
import { HOME_TZ, formatDateRange } from "@/lib/events-planner/core"
import type { BuilderItinerary, TypeOption } from "@/lib/events-planner/types"
import { ItineraryStatusPill } from "../status-pill"
import { DeleteItineraryButton } from "./delete-button"
import { AttendeesTab } from "./attendees-tab"
import { BuilderProvider, useBuilder } from "./builder-context"
import { ScheduleTab } from "./schedule-tab"
import { SettingsButton } from "./settings-dialog"
import { FinaliseButton, HealthButton } from "./health-panel"
import { ExportTab } from "./export-tab"
import { InvitesTab } from "./invites-tab"
import { ActivityTab } from "./activity-tab"
import { zoneLabel } from "./item-panel"

export function BuilderView(props: {
  initial: BuilderItinerary
  meetingTypes: TypeOption[]
  eventTypes: TypeOption[]
  readOnly: boolean
  canEstimate: boolean
}) {
  const [tab, setTab] = React.useState("schedule")
  const toSchedule = React.useCallback(() => setTab("schedule"), [])
  return (
    <BuilderProvider {...props} onJump={toSchedule}>
      <Builder tab={tab} setTab={setTab} />
    </BuilderProvider>
  )
}

function Builder({ tab, setTab }: { tab: string; setTab: (t: string) => void }) {
  const { itin, eventTypes, readOnly } = useBuilder()

  const meetings = itin.items.filter((i) => i.item_type === "meeting" && i.status !== "cancelled").length
  const zones = [...new Set(itin.days.map((d) => d.timezone))]
  const zoneText = zones.length === 1 && zones[0] === HOME_TZ ? "Eastern time" : `${zones.map(zoneLabel).join(" · ")} (Eastern alongside)`
  const typeName = eventTypes.find((t) => t.id === itin.event_type_id)?.name
  const notYet = "Coming in a later phase"

  return (
    <div className="space-y-4">
      <Link href="/admin/events" className="flex w-fit items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-3.5" /> All itineraries
      </Link>

      <ListTitleCard
        compact
        eyebrow={itin.client_name ?? "Events Planner"}
        title={itin.title}
        subtitle={[formatDateRange(itin.start_date, itin.end_date), typeName, `${meetings} meeting${meetings === 1 ? "" : "s"}`, zoneText]
          .filter(Boolean)
          .join(" · ")}
        rightSlot={
          <div className="flex flex-wrap items-center justify-end gap-2">
            <ItineraryStatusPill status={itin.status} />
            <SettingsButton />
            <Button variant="outline" size="sm" disabled title={notYet}>
              <RefreshCw className="size-4" /> Re-sync from CRM
            </Button>
            <Button variant="outline" size="sm" onClick={() => setTab("export")}>
              <Eye className="size-4" /> Preview PDF
            </Button>
            <HealthButton />
            <FinaliseButton />
            {!readOnly && <DeleteItineraryButton id={itin.id} title={itin.title} />}
          </div>
        }
      />

      {itin.status === "in_review" && itin.version > 0 && (
        <div
          className="rounded-lg px-4 py-2.5 text-sm"
          style={{ background: STATUS_PILL_LIGHT.watch.bg, color: STATUS_PILL_LIGHT.watch.text }}
        >
          This itinerary was edited after it was finalised, so it is back in review. Finalise it again before sending invites
          or the PDF.
        </div>
      )}
      {readOnly && (
        <div className="rounded-lg border border-border bg-white px-4 py-2.5 text-sm" style={{ color: TEXT_MUTED }}>
          Read-only while you are using “View as”.
        </div>
      )}

      <Tabs value={tab} onValueChange={(v) => setTab(String(v))}>
        <TabsList variant="line" className="mb-3">
          <TabsTrigger value="schedule">
            <CalendarRange /> Schedule
          </TabsTrigger>
          <TabsTrigger value="attendees">Attendees ({itin.attendees.length})</TabsTrigger>
          <TabsTrigger value="invites">
            <Mail /> Invites
          </TabsTrigger>
          <TabsTrigger value="export">
            <FileDown /> Export
          </TabsTrigger>
          <TabsTrigger value="activity">
            <History /> Activity
          </TabsTrigger>
        </TabsList>
        <TabsContent value="schedule">
          <ScheduleTab />
        </TabsContent>
        <TabsContent value="attendees">
          <AttendeesTab />
        </TabsContent>
        <TabsContent value="invites">
          <InvitesTab />
        </TabsContent>
        <TabsContent value="export">
          <ExportTab />
        </TabsContent>
        <TabsContent value="activity">
          <ActivityTab />
        </TabsContent>
      </Tabs>
    </div>
  )
}
