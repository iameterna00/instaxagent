import { type NextRequest, NextResponse } from "next/server"
import { getSupabaseServerClient } from "@/lib/supabase-server"
import { loadAiSettings } from "@/lib/ai/agent"
import { generateContentPlan } from "@/lib/ai/content"
import { collectTranscripts, transcriptionKeyFor } from "@/lib/ai/transcribe"
import { fetchAccountSnapshot } from "@/lib/instagram-account"
import { attachInsights, fetchOwnPosts } from "@/lib/instagram-media"

export const maxDuration = 300 // planning with high effort is slow


export async function GET(request: NextRequest) {
  try {
    const userId = request.nextUrl.searchParams.get("userId")
    if (!userId) return NextResponse.json({ error: "Missing userId" }, { status: 400 })

    const supabase = await getSupabaseServerClient()
    const { data, error } = await supabase
      .from("content_plans")
      .select("*")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(20)

    if (error) throw error
    return NextResponse.json(data ?? [])
  } catch (error: any) {
    console.error("[content] GET error:", error)
    return NextResponse.json({ error: describeFailure(error) }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { userId, goal, niche, audience, formats, referenceNotes, ideaCount } = body

    if (!userId) return NextResponse.json({ error: "Missing userId" }, { status: 400 })
    if (!goal || !String(goal).trim()) {
      return NextResponse.json({ error: "Describe what you want to achieve first" }, { status: 400 })
    }

    const supabase = await getSupabaseServerClient()

    const settings = await loadAiSettings(supabase, userId)
    if (!settings?.api_key) {
      return NextResponse.json(
        { error: "Add an API key in Automations → AI Agent first — the studio uses the same key." },
        { status: 400 },
      )
    }

    const { data: user } = await supabase
      .from("users")
      .select("username, access_token")
      .eq("id", userId)
      .single()

    if (!user) return NextResponse.json({ error: "User not found" }, { status: 404 })

    // Posts and the account snapshot are independent reads — run them together.
    const [posts, account] = await Promise.all([
      user.access_token ? fetchOwnPosts(user.access_token) : Promise.resolve([]),
      user.access_token ? fetchAccountSnapshot(user.access_token) : Promise.resolve(null),
    ])

    if (user.access_token && posts.length) {
      const { granted, firstError } = await attachInsights(user.access_token, posts)
      if (!granted) {
        console.log(
          "[content] no insights returned — the token likely predates instagram_business_manage_insights:",
          JSON.stringify(firstError ?? "no error reported"),
        )
      }
    }

    // Transcription is best-effort and cached: it must never fail a plan, and a
    // reel already in the cache costs nothing on a re-run.
    const transcription = await collectTranscripts(
      supabase,
      userId,
      transcriptionKeyFor(settings),
      posts,
    ).catch((e) => {
      console.warn("[content] transcription step failed:", e?.message || e)
      return null
    })

    if (transcription?.transcribedNow) {
      console.log(`[content] transcribed ${transcription.transcribedNow} new reel(s)`)
    }

    const result = await generateContentPlan(
      settings,
      {
        goal: String(goal).trim(),
        niche: niche ? String(niche).trim() : undefined,
        audience: audience ? String(audience).trim() : undefined,
        formats: Array.isArray(formats) ? formats.map(String) : [],
        referenceNotes: referenceNotes ? String(referenceNotes).trim() : undefined,
        ideaCount: Number(ideaCount) || 5,
      },
      {
        posts,
        username: user.username || "creator",
        account,
        transcripts: transcription?.transcripts,
      },
    )

    if (!result.ok) return NextResponse.json({ error: result.error }, { status: 502 })

    const { data, error } = await supabase
      .from("content_plans")
      .insert({
        user_id: userId,
        goal: String(goal).trim(),
        niche: niche || null,
        audience: audience || null,
        formats: Array.isArray(formats) ? formats : [],
        reference_notes: referenceNotes || null,
        provider: settings.provider,
        model: settings.model,
        analysis: result.plan.analysis,
        ideas: result.plan.ideas,
        posts_analyzed: posts.length,
        posts,
        // Snapshot the audience the plan was reasoned against, plus any notes
        // about what the API refused, so an old plan stays interpretable.
        account: account
          ? { ...account, notes: [...account.notes, ...(transcription?.notes ?? [])] }
          : transcription?.notes.length
            ? { profile: {}, notes: transcription.notes }
            : null,
        transcripts_used: transcription?.transcripts.size ?? 0,
      })
      .select()
      .single()

    if (error) throw error
    return NextResponse.json(data)
  } catch (error: any) {
    console.error("[content] POST error:", error)
    return NextResponse.json({ error: describeFailure(error) }, { status: 500 })
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const id = request.nextUrl.searchParams.get("id")
    if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 })

    const supabase = await getSupabaseServerClient()
    const { error } = await supabase.from("content_plans").delete().eq("id", id)
    if (error) throw error
    return NextResponse.json({ success: true })
  } catch (error: any) {
    console.error("[content] DELETE error:", error)
    return NextResponse.json({ error: describeFailure(error) }, { status: 500 })
  }
}

function describeFailure(error: any): string {
  const message: string = error?.message || String(error)
  if (message.includes("Supabase is not configured")) return message
  if (/media_transcripts/.test(message) || /\b(account|transcripts_used)\b/.test(message)) {
    return "Database is out of date — run scripts/11-transcripts-and-audience.sql in your Supabase SQL editor."
  }
  if (
    error?.code === "42P01" ||
    error?.code === "PGRST205" ||
    /content_plans/.test(message) ||
    /does not exist|schema cache/i.test(message)
  ) {
    return "The content_plans table is missing — run scripts/10-content-studio.sql in your Supabase SQL editor."
  }
  // 42703 undefined_column / PGRST204 unknown column in PostgREST's cache
  if (error?.code === "42703" || error?.code === "PGRST204") {
    return `Database is out of date (${message}) — run scripts/11-transcripts-and-audience.sql in your Supabase SQL editor.`
  }
  return message
}
