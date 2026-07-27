import { type NextRequest, NextResponse } from "next/server"
import { getSupabaseServerClient } from "@/lib/supabase-server"
import { attachInsights, fetchOwnPosts, isReel } from "@/lib/instagram-media"

/**
 * Cheap pre-flight for the Content Studio: can we read this account's posts,
 * and does the token actually carry insights access? Costs no AI tokens, so it
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
    const posts = await fetchOwnPosts(user.access_token, 3)
    if (!posts.length) {
      return NextResponse.json({
        ok: false,
        postsFound: 0,
        insightsGranted: false,
        reason: "No posts came back from Instagram — the token may be expired. Try logging out and reconnecting.",
      })
    }

    const { granted, firstError } = await attachInsights(user.access_token, posts)
    const sample = posts.find((p) => p.views !== undefined || p.reach !== undefined)

    return NextResponse.json({
      ok: granted,
      postsFound: posts.length,
      reelsFound: posts.filter(isReel).length,
      insightsGranted: granted,
      sample: granted ? { views: sample?.views, reach: sample?.reach } : undefined,
      reason: granted
        ? "Insights are working — regenerate a plan to get performance-aware analysis."
        : "Posts are readable but insights are not. Add instagram_business_manage_insights to your Meta app use case, then log out and reconnect Instagram so a fresh token carries it.",
      apiError: granted ? undefined : firstError?.message ?? firstError?.error_user_msg ?? undefined,
    })
  } catch (error: any) {
    console.error("[content-check] error:", error)
    return NextResponse.json({ error: error?.message || "Check failed" }, { status: 500 })
  }
}
