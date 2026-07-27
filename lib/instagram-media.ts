const GRAPH = "https://graph.instagram.com"

// ============================================================
// Reading the connected account's own media, plus insights when the account
// granted `instagram_business_manage_insights`.
// ============================================================

export interface OwnPost {
  id?: string
  caption?: string
  media_type?: string
  media_product_type?: string
  timestamp?: string
  like_count?: number
  comments_count?: number
  permalink?: string
  thumbnail_url?: string
  media_url?: string
  /** Insights — only present when the account granted manage_insights. */
  views?: number
  reach?: number
  saved?: number
  shares?: number
}

export function isReel(post: OwnPost): boolean {
  return post.media_product_type === "REELS" || post.media_type === "VIDEO"
}

/**
 * Recent posts. Engagement counts are only returned for professional accounts,
 * so fall back to the basic field set if they're refused.
 */
export async function fetchOwnPosts(token: string, limit = 25): Promise<OwnPost[]> {
  const common = "id,caption,media_type,media_product_type,permalink,thumbnail_url,media_url,timestamp"
  const withEngagement = `${common},like_count,comments_count`

  for (const fields of [withEngagement, common]) {
    try {
      const res = await fetch(
        `${GRAPH}/me/media?fields=${fields}&limit=${limit}&access_token=${encodeURIComponent(token)}`,
        { cache: "no-store" },
      )
      const json = await res.json()
      if (json.error) {
        console.warn("[ig-media] media fetch failed:", JSON.stringify(json.error))
        continue
      }
      return Array.isArray(json.data) ? json.data : []
    } catch (e) {
      console.warn("[ig-media] media fetch threw:", e)
    }
  }
  return []
}

/**
 * Views/reach/saves for one post. Needs `instagram_business_manage_insights`;
 * accounts that connected before that scope was granted get nothing back.
 * Returns the API error (if any) so callers can explain the failure.
 */
export async function fetchMediaInsights(token: string, post: OwnPost): Promise<{ error?: any }> {
  if (!post.id) return { error: "no media id" }

  // `views` only applies to video/reels — asking for it on a still image fails
  // the whole request, so the metric set depends on the media type.
  const metrics = isReel(post) ? "views,reach,saved,shares" : "reach,saved,shares"

  try {
    const res = await fetch(
      `${GRAPH}/${post.id}/insights?metric=${metrics}&access_token=${encodeURIComponent(token)}`,
      { cache: "no-store" },
    )
    const json = await res.json()
    if (json.error) return { error: json.error }

    for (const entry of json.data ?? []) {
      const value = entry?.values?.[0]?.value
      if (typeof value !== "number") continue
      if (entry.name === "views") post.views = value
      else if (entry.name === "reach") post.reach = value
      else if (entry.name === "saved") post.saved = value
      else if (entry.name === "shares") post.shares = value
    }
    return {}
  } catch (e) {
    return { error: e }
  }
}

/** Enrich in parallel — 25 sequential round trips would blow the request budget. */
export async function attachInsights(
  token: string,
  posts: OwnPost[],
): Promise<{ granted: boolean; firstError?: any }> {
  const results = await Promise.allSettled(posts.map((post) => fetchMediaInsights(token, post)))
  const granted = posts.some((p) => p.views !== undefined || p.reach !== undefined)

  const firstError = results
    .map((r) => (r.status === "fulfilled" ? r.value.error : r.reason))
    .find((e) => e !== undefined)

  return { granted, firstError }
}
