// Post-patch check for sql/patches/2026-09-29_contracts_crm.sql.
// Run from dashboard/:  node scripts/verify-contracts.mjs
// Creates ONE is_test dashboard contract on the ZZ - Test Client (ZVZZT), checks
// the calculated columns, the view, the CHECKs, the origin guard (incl. that a
// Dynamics row can't be edited through it), then deletes it. Self-cleaning.
import { createClient } from "@supabase/supabase-js"
import fs from "node:fs"
const env = Object.fromEntries(fs.readFileSync(".env.local","utf8").split(/\r?\n/).filter(l=>l.includes("=")).map(l=>{const i=l.indexOf("=");return [l.slice(0,i),l.slice(i+1).replace(/^"|"$/g,"")]}))
const sb = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY)
const check = (label, cond, extra="") => { console.log(`${cond ? "PASS" : "FAIL"}  ${label} ${extra}`); if (!cond) process.exitCode = 1 }
const ZVZZT = "90c5fb5b-2e03-ef11-a1fd-0022481d27df"
const id = crypto.randomUUID()

const ins = await sb.from("contracts").insert({
  contract_id: id, origin: "dashboard", is_test: true, _raw: {},
  contract_name: "VERIFY SCRIPT contract", account_id: ZVZZT, scope: "Other", contract_status: "Draft",
  start_date: "2026-01-01", term_length_months: 24, termination_notice_days: 90,
  auto_renew: false, renewal_date: "2028-01-01", quarterly_retainer: 12500.5, currency: "USD",
}).select("term_end, notice_date").single()
check("insert dashboard test contract", !ins.error, ins.error?.message ?? "")
if (ins.error) process.exit(1)
check("term_end = 2028-01-01", ins.data.term_end === "2028-01-01", ins.data.term_end)
check("notice_date = 2027-10-03", ins.data.notice_date === "2027-10-03", ins.data.notice_date)

const v = await sb.from("v_admin_contracts_all").select("*").eq("contract_id", id).single()
check("view row (dashboard, test, ZVZZT, name)", v.data?.origin === "dashboard" && v.data?.is_test === true && v.data?.account_id === ZVZZT && !!v.data?.client_name, JSON.stringify(v.error ?? v.data?.client_name))

let u = await sb.from("contracts").update({ contract_status: "Active", term_length_months: 12 }).eq("contract_id", id).eq("origin", "dashboard").select("contract_id, term_end, notice_date")
check("guarded edit of dashboard row hits 1 row", u.data?.length === 1, JSON.stringify(u.error ?? ""))
check("recalculated after edit (2027-01-01 / 2026-10-03)", u.data?.[0]?.term_end === "2027-01-01" && u.data?.[0]?.notice_date === "2026-10-03", JSON.stringify(u.data?.[0] ?? ""))

const bad = await sb.from("contracts").update({ currency: "JPY" }).eq("contract_id", id)
check("currency CHECK refuses JPY", !!bad.error)
const bad2 = await sb.from("contracts").update({ contract_status: "Nope" }).eq("contract_id", id)
check("status CHECK refuses unknown", !!bad2.error)
const bad3 = await sb.from("contracts").update({ scope: "Nope" }).eq("contract_id", id)
check("scope CHECK refuses unknown", !!bad3.error)
const gen = await sb.from("contracts").update({ term_end: "2030-01-01" }).eq("contract_id", id)
check("term_end is not writable", !!gen.error)

await sb.from("contracts").update({ origin: "dynamics" }).eq("contract_id", id)
const o = await sb.from("contracts").select("origin").eq("contract_id", id).single()
check("origin lock keeps 'dashboard'", o.data?.origin === "dashboard")

const dyn = await sb.from("contracts").select("contract_id").eq("origin", "dynamics").limit(1).single()
const dynEdit = await sb.from("contracts").update({ contract_name: "SHOULD NOT APPLY" }).eq("contract_id", dyn.data.contract_id).eq("origin", "dashboard").select("contract_id")
check("guarded edit of a DYNAMICS row hits 0 rows", !dynEdit.error && dynEdit.data?.length === 0)

const fo = await sb.from("v_admin_contracts_filter_options").select("kind").limit(2000)
check("filter-options view readable", !fo.error && (fo.data?.length ?? 0) > 0, `(${fo.data?.length})`)
const sv = await sb.from("contract_saved_views").select("id", { count: "exact", head: true })
check("contract_saved_views readable", !sv.error)
const all = await sb.from("v_admin_contracts_all").select("contract_id", { count: "exact", head: true }).eq("origin", "dynamics")
check("Dynamics contracts in view", (all.count ?? 0) > 300, `(${all.count})`)

const del = await sb.from("contracts").delete().eq("contract_id", id).eq("origin", "dashboard").select("contract_id")
check("guarded delete removes it", del.data?.length === 1)
