import { type NextRequest, NextResponse } from "next/server"
import { getSupabaseServerClient } from "@/lib/supabase-server"

// ============================================================
// Per-conversation AI control: pause the agent for a while, stop it
// completely, or hand the chat back to it.
// ============================================================

export async function GET(request: NextRequest) {
  try {
    const conversationId = request.nextUrl.searchParams.get("conversationId")
    if (!conversationId) return NextResponse.json({ error: "Missing conversationId" }, { status: 400 })

    const supabase = await getSupabaseServerClient()
    const { data, error } = await supabase
      .from("conversations")
      .select("id, ai_enabled, ai_paused_until, ai_last_reason")
      .eq("id", conversationId)
      .single()

    if (error) throw error
    return NextResponse.json(data)
  } catch (error) {
    console.error("[ai-conversation] GET error:", error)
    return NextResponse.json({ error: "Failed to load AI state" }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const { conversationId, action, minutes } = await request.json()
    if (!conversationId) return NextResponse.json({ error: "Missing conversationId" }, { status: 400 })

    let update: Record<string, any>

    switch (action) {
      case "pause": {
        const mins = Number(minutes)
        if (!Number.isFinite(mins) || mins <= 0 || mins > 60 * 24 * 7) {
          return NextResponse.json({ error: "Invalid pause duration" }, { status: 400 })
        }
        const until = new Date(Date.now() + mins * 60_000)
        update = {
          ai_enabled: true,
          ai_paused_until: until.toISOString(),
          ai_last_reason: `paused ${mins}m by you`,
        }
        break
      }
      case "stop":
        update = { ai_enabled: false, ai_paused_until: null, ai_last_reason: "stopped by you" }
        break
      case "resume":
        update = { ai_enabled: true, ai_paused_until: null, ai_last_reason: "resumed by you" }
        break
      default:
        return NextResponse.json({ error: "Unknown action" }, { status: 400 })
    }

    const supabase = await getSupabaseServerClient()
    const { data, error } = await supabase
      .from("conversations")
      .update(update)
      .eq("id", conversationId)
      .select("id, ai_enabled, ai_paused_until, ai_last_reason")
      .single()

    if (error) throw error
    return NextResponse.json(data)
  } catch (error) {
    console.error("[ai-conversation] POST error:", error)
    return NextResponse.json({ error: "Failed to update AI state" }, { status: 500 })
  }
}
