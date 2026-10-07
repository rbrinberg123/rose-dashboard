import "server-only"

/**
 * The itinerary PDF — Rose & Company HOUSE / PRINT style.
 *
 * ── PALETTE ────────────────────────────────────────────────────────────────
 * The colours below are the Rose & Co Style Guide's PRINT palette and are used
 * ONLY in this file. The app's on-screen UI uses the IQ palette (lib/design.ts)
 * and must never import from here.
 *
 * Runs server-side only (route handler); @react-pdf/renderer is kept out of
 * every client bundle (Next.js serves it as a server external package).
 *
 * It draws only what buildPdfModel (lib/events-planner/core.ts) returns — the
 * audience rules (no internal notes for clients, etc.) live there and are
 * unit-tested; nothing here reads the itinerary directly.
 */

import fs from "node:fs"
import path from "node:path"
import { Document, Image, Page, StyleSheet, Text, View, renderToBuffer } from "@react-pdf/renderer"

import type { PdfDay, PdfModel, PdfPerson, PdfRow } from "../core"

/* ---- Rose & Co print palette (PDF only) ---------------------------------- */
const ROSE_BLUE = "#0853A4"
const DARK_GREY = "#474C54"
const COOL_GREY = "#F1F4F8"
const LIGHT_BLUE = "#D3E1FD"
const CELESTIAL = "#3889C9"
const CELESTIAL_LIGHT = "#92C0E3"
const WHITE = "#FFFFFF"

/**
 * The Rose wordmark (white, for the blue cover). No print wordmark exists in
 * the repo yet; drop one at this path and it is used automatically. Until then
 * the cover shows a clearly marked placeholder — never a drawn logo.
 */
const WORDMARK_PATH = path.join(process.cwd(), "public", "brand", "rose-wordmark-white.png")

function wordmark(): string | null {
  try {
    return fs.existsSync(WORDMARK_PATH) ? WORDMARK_PATH : null
  } catch {
    return null
  }
}

const s = StyleSheet.create({
  page: {
    fontFamily: "Helvetica",
    fontSize: 10,
    color: DARK_GREY,
    paddingTop: 44,
    paddingBottom: 54,
    paddingHorizontal: 44,
  },
  sectionLabel: {
    position: "absolute",
    top: 22,
    left: 44,
    fontSize: 7.5,
    fontFamily: "Helvetica-Bold",
    color: ROSE_BLUE,
    letterSpacing: 1.2,
  },
  title: { fontSize: 26, fontFamily: "Helvetica-Bold", color: ROSE_BLUE, marginBottom: 4 },
  subtitle: { fontSize: 11, color: DARK_GREY, marginBottom: 16 },
  h2: { fontSize: 14, fontFamily: "Helvetica-Bold", color: ROSE_BLUE, marginTop: 14, marginBottom: 6 },
  footer: {
    position: "absolute",
    bottom: 22,
    left: 44,
    right: 44,
    borderTopWidth: 0.5,
    borderTopColor: CELESTIAL_LIGHT,
    paddingTop: 5,
    flexDirection: "row",
    justifyContent: "space-between",
    fontSize: 7,
    color: DARK_GREY,
  },
  small: { fontSize: 8.5 },
  muted: { color: "#6F7680" },
  italic: { fontFamily: "Helvetica-Oblique" },
  bold: { fontFamily: "Helvetica-Bold" },
  // tables
  tr: { flexDirection: "row", borderBottomWidth: 0.5, borderBottomColor: "#DDE3EA" },
  th: { fontSize: 8, fontFamily: "Helvetica-Bold", color: ROSE_BLUE, paddingVertical: 4, paddingHorizontal: 5 },
  td: { fontSize: 9.5, paddingVertical: 5, paddingHorizontal: 5 },
})

/* ---- shared chrome ----------------------------------------------------- */

function Footer({ m }: { m: PdfModel }) {
  return (
    <View style={s.footer} fixed>
      <Text>
        {m.title}
        {m.confidential ? "  ·  Confidential" : ""}
        {m.draft ? "  ·  DRAFT" : m.version ? `  ·  v${m.version}` : ""}
        {m.audience === "internal" ? "  ·  Rose internal" : ""}
      </Text>
      <Text render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`} />
    </View>
  )
}

function ContentPage({ m, label, children }: { m: PdfModel; label: string; children: React.ReactNode }) {
  return (
    <Page size="LETTER" style={s.page}>
      <Text style={s.sectionLabel} fixed>
        {label}
      </Text>
      {children}
      <Footer m={m} />
    </Page>
  )
}

/* ---- cover ------------------------------------------------------------- */

function Cover({ m }: { m: PdfModel }) {
  const logo = wordmark()
  return (
    <Page size="LETTER" style={{ backgroundColor: ROSE_BLUE, color: WHITE, fontFamily: "Helvetica", padding: 60, justifyContent: "center", alignItems: "center" }}>
      {m.clientName && <Text style={{ fontSize: 13, letterSpacing: 2, marginBottom: 14 }}>{m.clientName.toUpperCase()}</Text>}
      <Text style={{ fontSize: 30, fontFamily: "Helvetica-Bold", textAlign: "center", marginBottom: 10 }}>{m.title}</Text>
      {m.subtitle && <Text style={{ fontSize: 13, textAlign: "center", marginBottom: 10 }}>{m.subtitle}</Text>}
      <Text style={{ fontSize: 14, marginBottom: 6 }}>{m.dateRange}</Text>
      {m.cities.length > 0 && <Text style={{ fontSize: 12, color: LIGHT_BLUE }}>{m.cities.join("  ·  ")}</Text>}
      {m.audience !== "client" && <Text style={{ fontSize: 10, marginTop: 12, color: LIGHT_BLUE }}>{m.audienceLabel}</Text>}
      <View style={{ marginTop: 60, alignItems: "center" }}>
        {logo ? (
          // eslint-disable-next-line jsx-a11y/alt-text -- react-pdf Image has no alt
          <Image src={logo} style={{ width: 170 }} />
        ) : (
          <View style={{ borderWidth: 1, borderColor: CELESTIAL_LIGHT, borderStyle: "dashed", paddingVertical: 10, paddingHorizontal: 16 }}>
            <Text style={{ fontSize: 8, color: CELESTIAL_LIGHT }}>[ ROSE & CO WORDMARK — PLACEHOLDER ]</Text>
          </View>
        )}
        <Text style={{ fontSize: 9, marginTop: 14 }}>Prepared by Rose & Company · {m.generatedOn}</Text>
        {m.confidential && <Text style={{ fontSize: 8, marginTop: 4, color: CELESTIAL_LIGHT }}>Confidential</Text>}
      </View>
    </Page>
  )
}

/* ---- at a glance ------------------------------------------------------- */

function Glance({ m }: { m: PdfModel }) {
  const g = m.glance
  const nDays = m.days.length
  return (
    <ContentPage m={m} label="ITINERARY · AT A GLANCE">
      <Text style={s.title}>At a glance</Text>
      <Text style={s.subtitle}>
        {g.totals.meetings} meeting{g.totals.meetings === 1 ? "" : "s"} with {g.totals.institutions} institution
        {g.totals.institutions === 1 ? "" : "s"} over {nDays} day{nDays === 1 ? "" : "s"}
        {g.totals.cities ? ` in ${g.totals.cities} cit${g.totals.cities === 1 ? "y" : "ies"}` : ""}.
      </Text>

      <View style={[s.tr, { backgroundColor: LIGHT_BLUE }]}>
        <Text style={[s.th, { width: "26%" }]}>Date</Text>
        <Text style={[s.th, { width: "26%" }]}>City</Text>
        <Text style={[s.th, { width: "18%" }]}>First</Text>
        <Text style={[s.th, { width: "18%" }]}>Last</Text>
        <Text style={[s.th, { width: "12%", textAlign: "right" }]}>Meetings</Text>
      </View>
      {g.days.map((d, k) => (
        <View key={k} style={[s.tr, k % 2 ? { backgroundColor: COOL_GREY } : {}]} wrap={false}>
          <Text style={[s.td, { width: "26%" }]}>{d.date}</Text>
          <Text style={[s.td, { width: "26%" }]}>{d.city ?? "—"}</Text>
          <Text style={[s.td, { width: "18%" }]}>{d.first ?? "—"}</Text>
          <Text style={[s.td, { width: "18%" }]}>{d.last ?? "—"}</Text>
          <Text style={[s.td, { width: "12%", textAlign: "right" }]}>{d.meetings}</Text>
        </View>
      ))}

      {g.party.length > 0 && (
        <>
          <Text style={s.h2}>Travelling party</Text>
          {g.party.map((p, k) => (
            <Text key={k} style={{ marginBottom: 3 }}>
              <Text style={s.bold}>{p.name}</Text>
              {[p.title, p.company].filter(Boolean).length ? `  ·  ${[p.title, p.company].filter(Boolean).join(", ")}` : ""}
            </Text>
          ))}
        </>
      )}

      {g.hotels.length > 0 && (
        <>
          <Text style={s.h2}>Hotels</Text>
          {g.hotels.map((h, k) => (
            <Text key={k} style={{ marginBottom: 3 }}>
              <Text style={s.bold}>{h.night}</Text>
              {`  ·  ${h.name}`}
              {h.address ? `, ${h.address}` : ""}
              {h.phone ? `  ·  ${h.phone}` : ""}
              {h.confirmation ? `  ·  Conf. ${h.confirmation}` : ""}
            </Text>
          ))}
        </>
      )}

      {m.clientNotes && (
        <>
          <Text style={s.h2}>Notes</Text>
          <Text>{m.clientNotes}</Text>
        </>
      )}
    </ContentPage>
  )
}

/* ---- day pages --------------------------------------------------------- */

// Helvetica (a PDF standard font) has no "→", so the model writes "to" / "–".
const COLS = { time: "22%", item: "33%", where: "24%", who: "21%" }

function PeopleCell({ people }: { people: PdfPerson[] }) {
  if (!people.length) return <Text style={[s.td, { width: COLS.who }]} />
  return (
    <View style={{ width: COLS.who, paddingVertical: 5, paddingHorizontal: 5 }}>
      {people.map((p, k) => (
        <Text key={k} style={{ fontSize: 9, marginBottom: 1.5 }}>
          {p.name}
          {p.title ? <Text style={s.muted}>{`, ${p.title}`}</Text> : null}
        </Text>
      ))}
    </View>
  )
}

function Row({ r }: { r: PdfRow }) {
  const meeting = r.kind === "meeting"
  const bg = r.kind === "travel" ? LIGHT_BLUE : r.kind === "stay" || r.kind === "block" ? COOL_GREY : WHITE
  return (
    <View
      wrap={false}
      style={[
        s.tr,
        {
          backgroundColor: bg,
          borderLeftWidth: meeting ? 3 : 0,
          borderLeftColor: ROSE_BLUE,
          opacity: r.cancelled ? 0.6 : 1,
        },
        r.kind === "block" ? { borderStyle: "dashed", borderWidth: 0.75, borderColor: CELESTIAL } : {},
      ]}
    >
      <View style={{ width: COLS.time, paddingVertical: 5, paddingHorizontal: 5 }}>
        <Text style={{ fontSize: 9.5, fontFamily: meeting ? "Helvetica-Bold" : "Helvetica" }}>{r.time}</Text>
        {r.timeEt && <Text style={[s.small, s.muted]}>{r.timeEt}</Text>}
        {r.tentative && <Text style={[s.small, { color: CELESTIAL }]}>Tentative</Text>}
        {r.cancelled && <Text style={[s.small, { color: CELESTIAL }]}>Cancelled</Text>}
      </View>
      <View style={{ width: COLS.item, paddingVertical: 5, paddingHorizontal: 5 }}>
        <Text style={{ fontSize: meeting ? 10.5 : 9.5, fontFamily: meeting ? "Helvetica-Bold" : "Helvetica", color: meeting ? ROSE_BLUE : DARK_GREY }}>
          {r.title}
        </Text>
        {r.subtitle && <Text style={[s.small, s.muted]}>{r.subtitle}</Text>}
        {r.detail && <Text style={s.small}>{r.detail}</Text>}
        {r.notes && <Text style={[s.small, s.italic, { marginTop: 2 }]}>{r.notes}</Text>}
      </View>
      <Text style={[s.td, { width: COLS.where, fontSize: 9 }]}>{r.location ?? ""}</Text>
      <PeopleCell people={r.people} />
    </View>
  )
}

function DayPage({ m, d }: { m: PdfModel; d: PdfDay }) {
  return (
    <ContentPage m={m} label={`ITINERARY · ${d.label}`}>
      {/* Day header + column heads repeat on every continuation page. */}
      <View fixed style={{ marginBottom: 6 }}>
        <View style={{ backgroundColor: ROSE_BLUE, paddingVertical: 8, paddingHorizontal: 10, flexDirection: "row", justifyContent: "space-between" }}>
          <Text style={{ color: WHITE, fontSize: 15, fontFamily: "Helvetica-Bold" }}>{d.dateLong}</Text>
          <Text style={{ color: LIGHT_BLUE, fontSize: 10 }}>{[d.city, d.zoneLabel].filter(Boolean).join("  ·  ")}</Text>
        </View>
        <View style={[s.tr, { backgroundColor: COOL_GREY }]}>
          <Text style={[s.th, { width: COLS.time }]}>Time</Text>
          <Text style={[s.th, { width: COLS.item }]}>Item</Text>
          <Text style={[s.th, { width: COLS.where }]}>Location</Text>
          <Text style={[s.th, { width: COLS.who }]}>Attendees</Text>
        </View>
      </View>
      <Text style={[s.small, s.muted, { marginBottom: 6 }]}>
        {d.city ? `${d.city}. ` : ""}All times {d.zoneLabel}
        {d.zoneLabel !== "Eastern Time" ? ", with Eastern alongside" : ""}.
        {d.notes ? ` ${d.notes}` : ""}
      </Text>
      {d.rows.length === 0 ? (
        <Text style={s.muted}>Nothing scheduled.</Text>
      ) : (
        d.rows.map((r, k) => <Row key={k} r={r} />)
      )}
    </ContentPage>
  )
}

/* ---- logistics / appendix / internal ----------------------------------- */

function Logistics({ m }: { m: PdfModel }) {
  const l = m.logistics
  const any = l.cars.length || l.hotels.length || l.rose.length || l.clientAssistants.length
  if (!any) return null
  const line = (parts: (string | null)[]) => parts.filter(Boolean).join("  ·  ")
  return (
    <ContentPage m={m} label="ITINERARY · LOGISTICS">
      <Text style={s.title}>Logistics contacts</Text>
      <Text style={s.subtitle}>Who to call on the day.</Text>
      {l.rose.length > 0 && (
        <>
          <Text style={s.h2}>Rose & Company on site</Text>
          {l.rose.map((r, k) => (
            <Text key={k} style={{ marginBottom: 3 }}>
              <Text style={s.bold}>{r.name}</Text>
              {r.phone || r.email ? `  ·  ${line([r.phone, r.email])}` : ""}
            </Text>
          ))}
        </>
      )}
      {l.clientAssistants.length > 0 && (
        <>
          <Text style={s.h2}>Client office</Text>
          {l.clientAssistants.map((a, k) => (
            <Text key={k} style={{ marginBottom: 3 }}>
              <Text style={s.bold}>{a.name}</Text>
              {`  ·  ${line([a.title, a.phone, a.email])}`}
            </Text>
          ))}
        </>
      )}
      {l.cars.length > 0 && (
        <>
          <Text style={s.h2}>Cars and drivers</Text>
          {l.cars.map((c, k) => (
            <Text key={k} style={{ marginBottom: 3 }}>
              <Text style={s.bold}>{c.when}</Text>
              {`  ·  ${line([c.company, c.driver, c.phone])}`}
            </Text>
          ))}
        </>
      )}
      {l.hotels.length > 0 && (
        <>
          <Text style={s.h2}>Hotels</Text>
          {l.hotels.map((h, k) => (
            <Text key={k} style={{ marginBottom: 3 }}>
              <Text style={s.bold}>{h.name}</Text>
              {h.phone || h.address ? `  ·  ${line([h.phone, h.address])}` : ""}
            </Text>
          ))}
        </>
      )}
    </ContentPage>
  )
}

function Appendix({ m }: { m: PdfModel }) {
  if (!m.appendix?.length) return null
  return (
    <ContentPage m={m} label="ITINERARY · INVESTORS">
      <Text style={s.title}>Investor appendix</Text>
      <Text style={s.subtitle}>Who you are meeting at each institution.</Text>
      {m.appendix.map((a, k) => (
        <View key={k} wrap={false} style={{ marginBottom: 10 }}>
          <Text style={[s.bold, { color: ROSE_BLUE, fontSize: 11, marginBottom: 3 }]}>{a.institution}</Text>
          {a.people.map((p, j) => (
            <Text key={j} style={{ marginBottom: 2 }}>
              {p.name}
              {p.title ? <Text style={s.muted}>{`, ${p.title}`}</Text> : null}
            </Text>
          ))}
        </View>
      ))}
    </ContentPage>
  )
}

function InternalNotes({ m }: { m: PdfModel }) {
  if (!m.internal) return null
  const { itineraryNotes, notes } = m.internal
  return (
    <ContentPage m={m} label="INTERNAL — DO NOT DISTRIBUTE">
      <Text style={s.title}>Internal notes</Text>
      <Text style={s.subtitle}>Internal — do not distribute.</Text>
      {itineraryNotes && <Text style={{ marginBottom: 10 }}>{itineraryNotes}</Text>}
      {notes.length === 0 && !itineraryNotes ? <Text style={s.muted}>No internal notes.</Text> : null}
      {notes.map((n, k) => (
        <View key={k} wrap={false} style={{ marginBottom: 8 }}>
          <Text style={s.bold}>
            {n.when}  ·  {n.title}
          </Text>
          <Text>{n.note}</Text>
        </View>
      ))}
    </ContentPage>
  )
}

/* ---- document ---------------------------------------------------------- */

export function ItineraryDocument({ m }: { m: PdfModel }) {
  return (
    <Document title={m.title} author="Rose & Company" subject={m.audienceLabel} creator="Rose & Co IQ">
      <Cover m={m} />
      <Glance m={m} />
      {m.days.map((d, k) => (
        <DayPage key={k} m={m} d={d} />
      ))}
      <Logistics m={m} />
      <Appendix m={m} />
      <InternalNotes m={m} />
    </Document>
  )
}

export async function renderItineraryPdf(m: PdfModel): Promise<Buffer> {
  return renderToBuffer(<ItineraryDocument m={m} />)
}
