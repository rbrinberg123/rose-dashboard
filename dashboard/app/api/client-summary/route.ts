import { NextResponse } from "next/server"
import Anthropic from "@anthropic-ai/sdk"
import { getSupabaseServer } from "@/lib/supabase"
import {
  ClientSummaryError,
  SUMMARY_MODEL,
  generateAndCacheClientSummary,
} from "@/lib/client-summary"

/**
 * Generate, return, AND cache an AI relationship summary for ONE client.
 * Shares all generation logic with the nightly batch via lib/client-summary.ts.
 *
 * Server-only: reads ANTHROPIC_API_KEY (never exposed to the browser) and the
 * service_role Supabase client. force-dynamic so it is never cached.
 *
 * Trigger from a browser:  /api/client-summary?account_id=<uuid>
 */

export const dynamic = "force-dynamic"

export async function GET(request: Request) {
  const accountId = new URL(request.url).searchParams.get("account_id")
  if (!accountId) {
    return NextResponse.json(
      { error: "Missing required query param: account_id" },
      { status: 400 },
    )
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json(
      { error: "ANTHROPIC_API_KEY is not set on the server." },
      { status: 500 },
    )
  }

  const sb = getSupabaseServer()
  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

  try {
    const result = await generateAndCacheClientSummary(sb, anthropic, accountId)
    return NextResponse.json({
      account_id: result.accountId,
      client_name: result.clientName,
      summary: result.summary,
      cached: true,
      ai_summary_generated_at: result.generatedAt,
      // Echoed so you can sanity-check the inputs while testing.
      debug: {
        model: SUMMARY_MODEL,
        months_active: result.monthsActive,
        trailing_12m_meetings: result.trailing12m,
        upcoming_confirmed_meetings: result.upcomingConfirmed,
        recent_touchpoints: result.recentTouchpoints,
        client_data: result.clientData,
      },
    })
  } catch (err) {
    if (err instanceof ClientSummaryError) {
      return NextResponse.json({ error: err.message }, { status: err.status })
    }
    throw err
  }
}
