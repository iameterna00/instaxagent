import { type NextRequest, NextResponse } from "next/server"
import { getSupabaseServerClient } from "@/lib/supabase-server"
import { buildSystemPrompt, normalizeSettings, truncate } from "@/lib/ai/agent"
import { generateReply } from "@/lib/ai/providers"

/**
 * Dry-run the agent against a sample DM so the owner can check the key, the
 * model and the prompt before switching it on. Nothing is sent to Instagram.
 */
export async function POST(request: NextRequest) {
  try {
    const { userId, message } = await request.json()
    if (!userId) return NextResponse.json({ error: "Missing userId" }, { status: 400 })

    const sample = typeof message === "string" && message.trim() ? message.trim() : "hey! do you have any openings this week?"

    const supabase = await getSupabaseServerClient()

    const { data: settingsRow } = await supabase.from("ai_settings").select("*").eq("user_id", userId).single()
    if (!settingsRow) {
      return NextResponse.json({ error: "Save your AI settings first" }, { status: 400 })
    }

    const settings = normalizeSettings(settingsRow)
    if (!settings.api_key) {
      return NextResponse.json({ error: "Add an API key first" }, { status: 400 })
    }

    const { data: user } = await supabase.from("users").select("username").eq("id", userId).single()
    const systemPrompt = buildSystemPrompt(settings, user?.username || "your account")

    const started = Date.now()
    const result = await generateReply({
      provider: settings.provider,
      apiKey: settings.api_key,
      model: settings.model,
      systemPrompt,
      history: [{ role: "user", content: sample }],
    })

    if (!result.ok || !result.text) {
      return NextResponse.json({ error: result.error || "Generation failed" }, { status: 502 })
    }

    return NextResponse.json({
      reply: truncate(result.text, settings.max_reply_chars),
      provider: settings.provider,
      model: settings.model,
      ms: Date.now() - started,
    })
  } catch (error) {
    console.error("[ai-test] error:", error)
    return NextResponse.json({ error: "Test failed" }, { status: 500 })
  }
}
