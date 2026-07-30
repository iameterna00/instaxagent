import { type NextRequest, NextResponse } from "next/server"
import { getSupabaseServerClient } from "@/lib/supabase-server"
import { DEFAULT_AI_SETTINGS, normalizeSettings } from "@/lib/ai/agent"
import { defaultModelFor, isKnownProvider, PROVIDERS } from "@/lib/ai/providers"
import type { AudienceMode } from "@/lib/types"

const AUDIENCE_MODES: AudienceMode[] = ["all", "followers", "following", "mutuals"]

/** Keys themselves never leave the server — the UI only learns whether one is set. */
function toPublicSettings(settings: ReturnType<typeof normalizeSettings>) {
  const { api_key, transcription_api_key, ...rest } = settings
  return {
    ...rest,
    has_api_key: Boolean(api_key),
    // A key is effectively present when the main provider is OpenAI, since
    // transcription falls back to that credential.
    has_transcription_key: Boolean(transcription_api_key) || (settings.provider === "openai" && Boolean(api_key)),
  }
}

/**
 * Turn a Supabase/Postgres failure into something the panel can show, so setup
 * mistakes are self-diagnosing instead of a flat "failed to save".
 */
function describeFailure(error: any, verb: "load" | "save"): string {
  const message: string = error?.message || String(error)

  if (message.includes("Supabase is not configured")) return message

  // Missing table: 42P01 straight from Postgres, PGRST205 when PostgREST cannot
  // find it in its schema cache (what you get before the migration is run).
  if (
    error?.code === "42P01" ||
    error?.code === "PGRST205" ||
    /ai_settings/.test(message) ||
    /does not exist|schema cache/i.test(message)
  ) {
    return "The ai_settings table is missing — run scripts/09-ai-agent.sql in your Supabase SQL editor."
  }
  // 42703 undefined_column / PGRST204 unknown column in cache
  if (error?.code === "42703" || error?.code === "PGRST204") {
    const script = /transcription/.test(message) ? "11-transcripts-and-audience.sql" : "09-ai-agent.sql"
    return `Database is out of date (${message}) — run scripts/${script} in your Supabase SQL editor.`
  }
  return `Could not ${verb} AI settings: ${message}`
}

function clamp(value: any, min: number, max: number, fallback: number): number {
  const n = Number(value)
  if (!Number.isFinite(n)) return fallback
  return Math.min(max, Math.max(min, Math.round(n)))
}

export async function GET(request: NextRequest) {
  try {
    const userId = request.nextUrl.searchParams.get("userId")
    if (!userId) return NextResponse.json({ error: "Missing userId" }, { status: 400 })

    const supabase = await getSupabaseServerClient()
    const { data, error } = await supabase.from("ai_settings").select("*").eq("user_id", userId).single()

    // PGRST116 = no row matched, which is normal for a user who hasn't set the
    // agent up yet. Anything else (missing table, bad credentials) is a real
    // fault and must not be disguised as "not configured yet".
    if (error && error.code !== "PGRST116") throw error

    if (!data) {
      // No row yet — hand back the defaults so the form has something to render.
      return NextResponse.json({
        ...DEFAULT_AI_SETTINGS,
        user_id: Number(userId),
        api_key: undefined,
        has_api_key: false,
      })
    }

    return NextResponse.json(toPublicSettings(normalizeSettings(data)))
  } catch (error: any) {
    console.error("[ai-settings] GET error:", error)
    return NextResponse.json({ error: describeFailure(error, "load") }, { status: 500 })
  }
}

export async function PUT(request: NextRequest) {
  try {
    const body = await request.json()
    const { userId } = body
    if (!userId) return NextResponse.json({ error: "Missing userId" }, { status: 400 })

    const supabase = await getSupabaseServerClient()
    const { data: existing, error: readError } = await supabase
      .from("ai_settings")
      .select("*")
      .eq("user_id", userId)
      .single()

    if (readError && readError.code !== "PGRST116") throw readError
    const current = existing ? normalizeSettings(existing) : { ...DEFAULT_AI_SETTINGS, user_id: Number(userId) }

    const provider = isKnownProvider(body.provider) ? body.provider : current.provider

    // Switching providers invalidates the old model — fall back to that provider's default.
    let model: string = typeof body.model === "string" && body.model ? body.model : current.model
    const providerModels = PROVIDERS.find((p) => p.id === provider)?.models.map((m) => m.id) ?? []
    if (!providerModels.includes(model)) model = defaultModelFor(provider)

    const update: Record<string, any> = {
      user_id: Number(userId),
      is_enabled: typeof body.is_enabled === "boolean" ? body.is_enabled : current.is_enabled,
      provider,
      model,
      system_prompt: typeof body.system_prompt === "string" ? body.system_prompt : current.system_prompt,
      audience_mode: AUDIENCE_MODES.includes(body.audience_mode) ? body.audience_mode : current.audience_mode,
      blocklist: Array.isArray(body.blocklist)
        ? body.blocklist.map((v: any) => String(v).trim().replace(/^@/, "")).filter(Boolean).slice(0, 500)
        : current.blocklist,
      pause_on_human_reply:
        typeof body.pause_on_human_reply === "boolean" ? body.pause_on_human_reply : current.pause_on_human_reply,
      human_takeover_minutes:
        body.human_takeover_minutes === undefined
          ? current.human_takeover_minutes
          : clamp(body.human_takeover_minutes, 0, 60 * 24 * 7, current.human_takeover_minutes),
      history_limit:
        body.history_limit === undefined ? current.history_limit : clamp(body.history_limit, 2, 50, current.history_limit),
      max_reply_chars:
        body.max_reply_chars === undefined
          ? current.max_reply_chars
          : clamp(body.max_reply_chars, 50, 1000, current.max_reply_chars),
      reply_delay_seconds:
        body.reply_delay_seconds === undefined
          ? current.reply_delay_seconds
          : clamp(body.reply_delay_seconds, 0, 8, current.reply_delay_seconds),
      typing_indicator: typeof body.typing_indicator === "boolean" ? body.typing_indicator : current.typing_indicator,
      transcription_enabled:
        typeof body.transcription_enabled === "boolean" ? body.transcription_enabled : current.transcription_enabled,
      updated_at: new Date().toISOString(),
    }

    // api_key: absent or "" leaves the stored key alone; null clears it.
    if (body.api_key === null) {
      update.api_key = null
    } else if (typeof body.api_key === "string" && body.api_key.trim()) {
      update.api_key = body.api_key.trim()
    }

    // Same contract for the transcription key.
    if (body.transcription_api_key === null) {
      update.transcription_api_key = null
    } else if (typeof body.transcription_api_key === "string" && body.transcription_api_key.trim()) {
      update.transcription_api_key = body.transcription_api_key.trim()
    }

    // Turning the agent on without a key would silently do nothing.
    const keyAfterUpdate = "api_key" in update ? update.api_key : current.api_key
    if (update.is_enabled && !keyAfterUpdate) {
      return NextResponse.json({ error: "Add an API key before turning the AI agent on" }, { status: 400 })
    }

    const { data, error } = await supabase
      .from("ai_settings")
      .upsert(update, { onConflict: "user_id" })
      .select()
      .single()

    if (error) throw error
    return NextResponse.json(toPublicSettings(normalizeSettings(data)))
  } catch (error: any) {
    console.error("[ai-settings] PUT error:", error)
    return NextResponse.json({ error: describeFailure(error, "save") }, { status: 500 })
  }
}
