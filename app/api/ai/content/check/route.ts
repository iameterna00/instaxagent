import { type NextRequest, NextResponse } from "next/server"
import { getSupabaseServerClient } from "@/lib/supabase-server"
import { loadAiSettings } from "@/lib/ai/agent"
import { transcriptionKeyFor } from "@/lib/ai/transcribe"
import { fetchAccountProfile } from "@/lib/instagram-account"
import { attachInsights, fetchOwnPosts, isReel } from "@/lib/instagram-media"

/**
 * Cheap pre-flight for the Content Studio: can we read this account's posts,
 * does the token carry insights access, is the follower count visible, and is
 * transcription set up? Costs no AI tokens and no transcription spend, so it
 * answers "did adding the permission work?" without running a full plan.
 */
export async function GET(request: NextRequest) {
  try {
    const userId = request.nextUrl.searchParams.get("userId")
    if (!userId) return NextResponse.json({ error: "Missing userId" }, { status: 400 })

    const supabase = await getSupabaseServerClient()
    const { data: user } = await supabase.from("users").select("username, access_token").eq("id", userId).single()

    if (!user?.access_token) {
      return NextResponse.json({ ok: false, reason: "Instagram is not connected" }, { status: 200 })
    }

    // Three posts is enough to prove access without hammering the API.
    const [posts, profile, settings] = await Promise.all([
      fetchOwnPosts(user.access_token, 3),
      fetchAccountProfile(user.access_token),
      loadAiSettings(supabase, userId).catch(() => null),
    ])

    const followersCount = profile?.followers_count
    const canTranscribe = Boolean(settings && transcriptionKeyFor(settings))

    if (!posts.length) {
      return NextResponse.json({
        ok: false,
        postsFound: 0,
        insightsGranted: false,
        followersCount,
        canTranscribe,
        reason: "No posts came back from Instagram — the token may be expired. Try logging out and reconnecting.",
      })
    }

    const { granted, firstError } = await attachInsights(user.access_token, posts)
    const sample = posts.find((p) => p.views !== undefined || p.reach !== undefined)

    // Each capability is reported separately: insights, follower count and
    // transcription fail for different reasons and have different fixes.
    const missing: string[] = []
    if (!granted) {
      missing.push(
        "Post insights are off — add instagram_business_manage_insights to your Meta app use case, then log out and reconnect Instagram so a fresh token carries it.",
      )
    }
    if (followersCount === undefined) {
      missing.push("Follower count is not readable, so the plan cannot size its strategy to your audience.")
    }
    if (!canTranscribe) {
      missing.push(
        "No transcription key, so the planner cannot hear your reels — add an OpenAI key under Automations → AI Agent.",
      )
    }

    return NextResponse.json({
      ok: granted && followersCount !== undefined && canTranscribe,
      postsFound: posts.length,
      reelsFound: posts.filter(isReel).length,
      insightsGranted: granted,
      followersCount,
      canTranscribe,
      sample: granted ? { views: sample?.views, reach: sample?.reach } : undefined,
      reason: missing.length
        ? missing.join(" ")
        : `Everything is connected — ${followersCount?.toLocaleString("en-US")} followers, insights readable, transcription ready.`,
      apiError: granted ? undefined : firstError?.message ?? firstError?.error_user_msg ?? undefined,
    })
  } catch (error: any) {
    console.error("[content-check] error:", error)
    return NextResponse.json({ error: error?.message || "Check failed" }, { status: 500 })
  }
}
