import { type NextRequest, NextResponse } from "next/server"
import { getSupabaseServerClient } from "@/lib/supabase-server"
import { loadAiSettings } from "@/lib/ai/agent"
import { generateDeepAnalysis } from "@/lib/ai/analysis"
import { collectTranscripts, transcriptionKeyFor } from "@/lib/ai/transcribe"
import { fetchAccountSnapshot, type AccountSnapshot } from "@/lib/instagram-account"
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

/** Metric fields Instagram re-reports for a post that is already analysed. */
const LIVE_METRICS = ["views", "reach", "saved", "shares", "like_count", "comments_count"] as const

/**
 * How many posts an analysis covers. POST and PATCH must agree on this: if the
 * refresh reads a wider window than the analysis wrote, every post in the gap
 * looks brand new and the page sits permanently flagged as out of date.
 */
const ANALYSIS_WINDOW = 60

/**
 * Refresh the numbers only — views, reach, engagement rate and followers — on
 * the latest saved analysis. No model call: the verdicts stay exactly as they
 * were, only the metrics they sit next to move. Returns whether anything
 * actually changed, so the UI can offer a full re-run when it did.
 */
export async function PATCH(request: NextRequest) {
  try {
    const { userId } = await request.json()
    if (!userId) return NextResponse.json({ error: "Missing userId" }, { status: 400 })

    const supabase = await getSupabaseServerClient()

    const { data: row, error: readError } = await supabase
      .from("post_analyses")
      .select("*")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle()

    if (readError) throw readError
    if (!row) return NextResponse.json({ error: "No saved analysis to refresh yet." }, { status: 404 })

    const { data: user } = await supabase
      .from("users")
      .select("access_token")
      .eq("id", userId)
      .single()

    if (!user?.access_token) {
      return NextResponse.json({ error: "Instagram not connected" }, { status: 401 })
    }

    const savedPosts: any[] = Array.isArray(row.posts) ? row.posts : []

    // The same window the analysis was written against — see ANALYSIS_WINDOW.
    // Reading only the default 25 would freeze every row past that, since those
    // posts never appear in `live` to be re-pointed at fresh numbers.
    const [live, account] = await Promise.all([
      fetchOwnPosts(user.access_token, ANALYSIS_WINDOW),
      fetchAccountSnapshot(user.access_token),
    ])

    const { granted, firstError, throttled } = await attachInsights(user.access_token, live)
    if (!granted) {
      console.warn(
        `[analysis] refresh got no insights back for ${live.length} posts — views and reach cannot move:`,
        JSON.stringify(firstError ?? "no error reported"),
      )
    }

    const bySavedId = new Map(live.filter((p) => p.id).map((p) => [p.id!, p]))
    const savedIds = new Set(savedPosts.map((p) => p?.id).filter(Boolean))

    let changed = false
    const posts = savedPosts.map((post) => {
      const fresh = post?.id ? bySavedId.get(post.id) : undefined
      if (!fresh) return post

      const next = { ...post }
      for (const key of LIVE_METRICS) {
        const value = fresh[key]
        if (typeof value === "number" && value !== post[key]) {
          next[key] = value
          changed = true
        }
      }
      // Instagram's CDN URLs expire, so the thumbnails are worth re-pointing
      // on the same pass that refreshes the numbers.
      if (fresh.thumbnail_url) next.thumbnail_url = fresh.thumbnail_url
      if (fresh.media_url) next.media_url = fresh.media_url
      return next
    })

    // Posts published since the analysis ran. They are deliberately NOT added
    // to the table — an unscored row would break the score column — but their
    // count is what makes a full re-run worth offering.
    //
    // Only what is genuinely NEWER counts. An unseen id is not enough on its
    // own: the moment the refresh reads a wider window than the analysis wrote,
    // or an old analysis is opened against a since-grown account, every post in
    // the gap is unseen and the page would sit flagged as out of date forever.
    const newestAnalysed = savedPosts
      .map((p) => (p?.timestamp ? new Date(p.timestamp).getTime() : 0))
      .reduce((a, b) => Math.max(a, b), 0)

    const newPosts = live.filter(
      (p) =>
        p.id &&
        !savedIds.has(p.id) &&
        (!newestAnalysed || (p.timestamp ? new Date(p.timestamp).getTime() > newestAnalysed : false)),
    ).length

    const priorAccount = row.account as AccountSnapshot | null
    const mergedAccount = account
      ? {
          ...account,
          notes: [
            ...account.notes,
            ...(priorAccount?.notes ?? []).filter((note) => !account.notes.includes(note)),
          ],
        }
      : priorAccount

    const { data, error } = await supabase
      .from("post_analyses")
      .update({
        posts,
        account: mergedAccount,
        // A token that lost the scope still leaves the previously fetched
        // numbers on screen, so the caption-only warning stays off.
        has_insights: granted || row.has_insights,
      })
      .eq("id", row.id)
      .select()
      .single()

    if (error) throw error
    // `insights` reports this pass specifically, not the sticky `has_insights`
    // column — a refresh that moved nothing because Instagram returned no
    // metrics must not be announced as "Metrics updated".
    return NextResponse.json({
      analysis: data,
      changed,
      new_posts: newPosts,
      insights: granted,
      throttled,
    })
  } catch (error: any) {
    console.error("[analysis] PATCH error:", error)
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
      fetchOwnPosts(user.access_token, ANALYSIS_WINDOW),
      fetchAccountSnapshot(user.access_token),
    ])

    if (!posts.length) {
      return NextResponse.json(
        { error: "No posts came back from Instagram — nothing to analyse yet." },
        { status: 400 },
      )
    }

    const { granted, firstError, throttled } = await attachInsights(user.access_token, posts)
    if (!granted) {
      console.log(
        `[analysis] no insights returned for ${posts.length} posts —`,
        throttled
          ? "Instagram is rate limiting this account:"
          : "the token likely predates instagram_business_manage_insights:",
        JSON.stringify(firstError ?? "no error reported"),
      )
      // Scoring a whole period with no numbers produces a caption-only reading
      // that looks like a broken analysis. When the cause is throttling it is
      // temporary, so refuse the spend and say when to come back instead.
      if (throttled) {
        return NextResponse.json(
          {
            error:
              "Instagram is rate limiting this account, so no view or reach numbers came back. Wait about an hour and re-run — an analysis without metrics is not worth the tokens.",
          },
          { status: 429 },
        )
      }
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
