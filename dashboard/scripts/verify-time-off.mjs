// Post-patch check for sql/patches/2026-09-24_time_off_requests.sql.
// Run from dashboard/:  node scripts/verify-time-off.mjs
// Creates ONE is_test request (Mon 2026-11-02 .. Wed 2026-11-04, Tue = AM half),
// checks the function, total, view, edit re-derive and cascade delete, then removes it.
import { createClient } from "@supabase/supabase-js"
import fs from "node:fs"
const env = Object.fromEntries(fs.readFileSync(".env.local","utf8").split(/\r?\n/).filter(l=>l.includes("=")).map(l=>{const i=l.indexOf("=");return [l.slice(0,i),l.slice(i+1).replace(/^"|"$/g,"")]}))
const sb = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY)
const check = (label, cond, extra="") => { console.log(`${cond ? "PASS" : "FAIL"}  ${label} ${extra}`); if (!cond) process.exitCode = 1 }
const { data: u } = await sb.from("users").select("user_id, display_name").eq("is_active", true).limit(1).single()
const { data: req, error } = await sb.from("time_off_requests").insert({ requested_by_id: u.user_id, requested_by_name: u.display_name, request_type: "Vacation", start_date: "2026-11-02", end_date: "2026-11-04", is_test: true, description: "verify script" }).select("id").single()
check("insert request", !error, error?.message ?? "")
if (error) process.exit(1)
let r = await sb.rpc("time_off_set_days", { p_request_id: req.id, p_days: [{off_date:"2026-11-02",portion:"Full"},{off_date:"2026-11-03",portion:"AM"},{off_date:"2026-11-04",portion:"Full"}] })
check("set_days total = 2.5", Number(r.data) === 2.5, JSON.stringify(r.error ?? r.data))
const v = await sb.from("v_admin_time_off_all").select("*").eq("id", req.id).single()
check("view row (Dashboard, Pending, 2.5)", v.data?.source === "Dashboard" && v.data?.status === "Pending" && Number(v.data?.total_days) === 2.5, JSON.stringify(v.error ?? ""))
r = await sb.rpc("time_off_set_days", { p_request_id: req.id, p_days: [{off_date:"2026-11-02",portion:"PM"}] })
const days = await sb.from("time_off_days").select("off_date, portion").eq("request_id", req.id)
check("edit re-derive: 1 day row, total 0.5", Number(r.data) === 0.5 && days.data?.length === 1)
const bad = await sb.rpc("time_off_set_days", { p_request_id: req.id, p_days: [] })
check("empty days refused", !!bad.error)
const dyn = await sb.from("v_admin_time_off_all").select("id", { count: "exact", head: true }).eq("source", "Dynamics")
check("Dynamics history in view", (dyn.count ?? 0) > 400, `(${dyn.count})`)
await sb.from("time_off_requests").delete().eq("id", req.id)
const left = await sb.from("time_off_days").select("id").eq("request_id", req.id)
check("delete cascades to days", (left.data ?? []).length === 0)
