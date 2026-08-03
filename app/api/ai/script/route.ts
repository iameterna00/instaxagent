import { type NextRequest, NextResponse } from "next/server"
import { getSupabaseServerClient } from "@/lib/supabase-server"
import { loadAiSettings } from "@/lib/ai/agent"
import { generateScriptAnalysis } from "@/lib/ai/script"
import { collectTranscripts, transcriptionKeyFor } from "@/lib/ai/transcribe"
import { fetchAccountSnapshot } from "@/lib/instagram-account"
import { attachInsights, fetchOwnPosts } from "@/lib/instagram-media"

export const maxDuration = 300 // scoring line by line at high effort is slow

/** Past analyses, newest first — the tab renders the last one without a re-run. */
export async function GET(request: NextRequest) {
  try {
    const userId = request.nextUrl.searchParams.get("userId")
    if (!userId) return NextResponse.json({ error: "Missing userId" }, { status: 400 })

    const supabase = await getSupabaseServerClient()
    const { data, error } = await supabase
      .from("script_analyses")
      .select("*")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(20)

    if (error) throw error
    return NextResponse.json(data ?? [])
  } catch (error: any) {
    console.error("[script] GET error:", error)
    return NextResponse.json({ error: describeFailure(error) }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const { userId, script, format } = await request.json()
    if (!userId) return NextResponse.json({ error: "Missing userId" }, { status: 400 })
    if (!script || !String(script).trim()) {
      return NextResponse.json({ error: "Paste a script to analyse first" }, { status: 400 })
    }

    const supabase = await getSupabaseServerClient()

    const settings = await loadAiSettings(supabase, userId)
    if (!settings?.api_key) {
      return NextResponse.json(
        { error: "Add an API key in Automations → AI Agent first — script analysis uses the same key." },
        { status: 400 },
      )
    }

    const { data: user } = await supabase
      .from("users")
      .select("username, access_token")
      .eq("id", userId)
      .single()

    if (!user) return NextResponse.json({ error: "User not found" }, { status: 404 })

    // The whole point is scoring against their own posts, but a script can
    // still be reviewed without them — the model is told to say so.
    const [posts, account] = await Promise.all([
      user.access_token ? fetchOwnPosts(user.access_token) : Promise.resolve([]),
      user.access_token ? fetchAccountSnapshot(user.access_token) : Promise.resolve(null),
    ])

    if (user.access_token && posts.length) {
      await attachInsights(user.access_token, posts)
    }

    // Transcripts are what make VOICE MATCH meaningful. Best-effort and cached:
    // never fail an analysis over them.
    const transcription = await collectTranscripts(
      supabase,
      userId,
      transcriptionKeyFor(settings),
      posts,
    ).catch((e) => {
      console.warn("[script] transcription step failed:", e?.message || e)
      return null
    })

    const generated = await generateScriptAnalysis(
      settings,
      { script: String(script), format: format ? String(format) : undefined },
      {
        posts,
        username: user.username || "creator",
        account,
        transcripts: transcription?.transcripts,
      },
    )

    if (!generated.ok) return NextResponse.json({ error: generated.error }, { status: 502 })

    const { result } = generated
    const { data, error } = await supabase
      .from("script_analyses")
      .insert({
        user_id: userId,
        script: String(script),
        format: format ? String(format) : null,
        provider: settings.provider,
        model: settings.model,
        score: result.score ?? null,
        verdict: result.verdict ?? null,
        retention_estimate: result.retention_estimate ?? null,
        scores: result.scores,
        lines: result.lines,
        keep: result.keep,
        fix: result.fix,
        rewrite: result.rewrite,
        rewrite_score: result.rewrite_score ?? null,
        rewrite_runtime: result.rewrite_runtime ?? null,
        posts_analyzed: posts.length,
        transcripts_used: transcription?.transcripts.size ?? 0,
      })
      .select()
      .single()

    if (error) throw error
    return NextResponse.json(data)
  } catch (error: any) {
    console.error("[script] POST error:", error)
    return NextResponse.json({ error: describeFailure(error) }, { status: 500 })
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const id = request.nextUrl.searchParams.get("id")
    if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 })

    const supabase = await getSupabaseServerClient()
    const { error } = await supabase.from("script_analyses").delete().eq("id", id)
    if (error) throw error
    return NextResponse.json({ success: true })
  } catch (error: any) {
    console.error("[script] DELETE error:", error)
    return NextResponse.json({ error: describeFailure(error) }, { status: 500 })
  }
}

function describeFailure(error: any): string {
  const message: string = error?.message || String(error)
  if (message.includes("Supabase is not configured")) return message
  if (
    error?.code === "42P01" ||
    error?.code === "PGRST205" ||
    error?.code === "42703" ||
    error?.code === "PGRST204" ||
    /script_analyses/.test(message) ||
    /does not exist|schema cache/i.test(message)
  ) {
    return "The script_analyses table is missing — run scripts/13-script-analysis.sql in your Supabase SQL editor."
  }
  return message
}
