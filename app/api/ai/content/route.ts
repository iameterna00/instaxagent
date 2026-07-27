import { type NextRequest, NextResponse } from "next/server"
import { getSupabaseServerClient } from "@/lib/supabase-server"
import { loadAiSettings } from "@/lib/ai/agent"
import { generateContentPlan, isReel, type OwnPost } from "@/lib/ai/content"

export const maxDuration = 300 // planning with high effort is slow

const GRAPH = "https://graph.instagram.com"

/**
 * Pull the creator's own recent posts. Engagement counts are only returned for
 * professional accounts, so fall back to the basic field set if they're refused.
 */
async function fetchOwnPosts(token: string): Promise<OwnPost[]> {
  const common = "id,caption,media_type,media_product_type,permalink,thumbnail_url,media_url,timestamp"
  const withEngagement = `${common},like_count,comments_count`

  for (const fields of [withEngagement, common]) {
    try {
      const res = await fetch(`${GRAPH}/me/media?fields=${fields}&limit=25&access_token=${encodeURIComponent(token)}`, {
        cache: "no-store",
      })
      const json = await res.json()
      if (json.error) {
        console.warn("[content] media fetch failed:", JSON.stringify(json.error))
        continue
      }
      return Array.isArray(json.data) ? json.data : []
    } catch (e) {
      console.warn("[content] media fetch threw:", e)
    }
  }
  return []
}

/**
 * Views/reach/saves for one post. Needs `instagram_business_manage_insights`;
 * accounts that connected before that scope was added simply get nothing back,
 * and the plan falls back to caption-only analysis.
 */
async function fetchMediaInsights(token: string, post: OwnPost): Promise<void> {
  if (!post.id) return

  // `views` only applies to video/reels — asking for it on a still image fails
  // the whole request, so the metric set depends on the media type.
  const metrics = isReel(post) ? "views,reach,saved,shares" : "reach,saved,shares"

  try {
    const res = await fetch(
      `${GRAPH}/${post.id}/insights?metric=${metrics}&access_token=${encodeURIComponent(token)}`,
      { cache: "no-store" },
    )
    const json = await res.json()
    if (json.error) return
    for (const entry of json.data ?? []) {
      const value = entry?.values?.[0]?.value
      if (typeof value !== "number") continue
      if (entry.name === "views") post.views = value
      else if (entry.name === "reach") post.reach = value
      else if (entry.name === "saved") post.saved = value
      else if (entry.name === "shares") post.shares = value
    }
  } catch {
    // Insights are a bonus, never a hard requirement.
  }
}

/** Enrich in parallel — 25 sequential round trips would blow the request budget. */
async function attachInsights(token: string, posts: OwnPost[]): Promise<boolean> {
  await Promise.allSettled(posts.map((post) => fetchMediaInsights(token, post)))
  return posts.some((p) => p.views !== undefined || p.reach !== undefined)
}

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

    const posts = user.access_token ? await fetchOwnPosts(user.access_token) : []
    const hasInsights = user.access_token && posts.length ? await attachInsights(user.access_token, posts) : false
    if (posts.length && !hasInsights) {
      console.log("[content] no insights returned — account likely predates the manage_insights scope")
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
      posts,
      user.username || "creator",
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
  if (
    error?.code === "42P01" ||
    error?.code === "PGRST205" ||
    /content_plans/.test(message) ||
    /does not exist|schema cache/i.test(message)
  ) {
    return "The content_plans table is missing — run scripts/10-content-studio.sql in your Supabase SQL editor."
  }
  return message
}
