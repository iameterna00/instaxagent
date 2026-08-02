import { type NextRequest, NextResponse } from "next/server"
import { getSupabaseServerClient } from "@/lib/supabase-server"
import { loadAiSettings } from "@/lib/ai/agent"
import { generateDeepAnalysis } from "@/lib/ai/analysis"
import { collectTranscripts, transcriptionKeyFor } from "@/lib/ai/transcribe"
import { fetchAccountSnapshot } from "@/lib/instagram-account"
import { attachInsights, fetchOwnPosts } from "@/lib/instagram-media"

export const maxDuration = 300 // scoring a whole period at high effort is slow

/** Latest saved analysis, so the page has something to render before a re-run. */
export async function GET(request: NextRequest) {
  try {
    const userId = request.nextUrl.searchParams.get("userId")
    if (!userId) return NextResponse.json({ error: "Missing userId" }, { status: 400 })

    const supabase = await getSupabaseServerClient()
    const { data, error } = await supabase
      .from("post_analyses")
      .select("*")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(1)

    if (error) throw error
    return NextResponse.json(data?.[0] ?? null)
  } catch (error: any) {
    console.error("[analysis] GET error:", error)
    return NextResponse.json({ error: describeFailure(error) }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const { userId } = await request.json()
    if (!userId) return NextResponse.json({ error: "Missing userId" }, { status: 400 })

    const supabase = await getSupabaseServerClient()

    const settings = await loadAiSettings(supabase, userId)
    if (!settings?.api_key) {
      return NextResponse.json(
        { error: "Add an API key in Automations → AI Agent first — Deep Analysis uses the same key." },
        { status: 400 },
      )
    }

    const { data: user } = await supabase
      .from("users")
      .select("username, access_token")
      .eq("id", userId)
      .single()

    if (!user) return NextResponse.json({ error: "User not found" }, { status: 404 })
    if (!user.access_token) {
      return NextResponse.json({ error: "Instagram not connected" }, { status: 401 })
    }

    // Posts and the account snapshot are independent reads — run them together.
    const [posts, account] = await Promise.all([
      fetchOwnPosts(user.access_token),
      fetchAccountSnapshot(user.access_token),
    ])

    if (!posts.length) {
      return NextResponse.json(
        { error: "No posts came back from Instagram — nothing to analyse yet." },
        { status: 400 },
      )
    }

    const { granted, firstError } = await attachInsights(user.access_token, posts)
    if (!granted) {
      console.log(
        "[analysis] no insights returned — the token likely predates instagram_business_manage_insights:",
        JSON.stringify(firstError ?? "no error reported"),
      )
    }

    // Transcription is best-effort and cached: it must never fail an analysis,
    // and a reel already in the cache costs nothing on a re-run.
    const transcription = await collectTranscripts(
      supabase,
      userId,
      transcriptionKeyFor(settings),
      posts,
    ).catch((e) => {
      console.warn("[analysis] transcription step failed:", e?.message || e)
      return null
    })

    const generated = await generateDeepAnalysis(settings, {
      posts,
      username: user.username || "creator",
      account,
      transcripts: transcription?.transcripts,
    })

    if (!generated.ok) return NextResponse.json({ error: generated.error }, { status: 502 })

    const { data, error } = await supabase
      .from("post_analyses")
      .insert({
        user_id: userId,
        provider: settings.provider,
        model: settings.model,
        summary: generated.result.summary,
        posts: generated.result.posts,
        posts_analyzed: generated.result.posts.length,
        // Snapshot the audience the analysis was reasoned against, plus any
        // notes about what the API refused, so an old row stays interpretable.
        account: account
          ? { ...account, notes: [...account.notes, ...(transcription?.notes ?? [])] }
          : null,
        has_insights: granted,
      })
      .select()
      .single()

    if (error) throw error
    return NextResponse.json(data)
  } catch (error: any) {
    console.error("[analysis] POST error:", error)
    return NextResponse.json({ error: describeFailure(error) }, { status: 500 })
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const id = request.nextUrl.searchParams.get("id")
    if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 })

    const supabase = await getSupabaseServerClient()
    const { error } = await supabase.from("post_analyses").delete().eq("id", id)
    if (error) throw error
    return NextResponse.json({ success: true })
  } catch (error: any) {
    console.error("[analysis] DELETE error:", error)
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
    /post_analyses/.test(message) ||
    /does not exist|schema cache/i.test(message)
  ) {
    return "The post_analyses table is missing — run scripts/12-deep-analysis.sql in your Supabase SQL editor."
  }
  return message
}
