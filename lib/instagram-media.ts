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

/** Instagram caps a media page well below 100 whatever `limit` asks for. */
const PAGE_SIZE = 25

/** A runaway cursor must not walk an entire account. 8 pages is 200 posts. */
const MAX_PAGES = 8

/**
 * Recent posts, following Instagram's paging cursor until `limit` is met.
 *
 * `limit` is NOT a page size. Asking `/me/media?limit=60` returns one capped
 * page, so the old single-request version silently topped out around 25 no
 * matter what it was asked for — which is why an account with 60 posts only
 * ever saw its most recent 25 analysed.
 *
 * Engagement counts are only returned for professional accounts, so fall back
 * to the basic field set if they're refused.
 */
export async function fetchOwnPosts(token: string, limit = 25): Promise<OwnPost[]> {
  const common = "id,caption,media_type,media_product_type,permalink,thumbnail_url,media_url,timestamp"
  const withEngagement = `${common},like_count,comments_count`

  for (const fields of [withEngagement, common]) {
    const collected: OwnPost[] = []
    let url =
      `${GRAPH}/me/media?fields=${fields}` +
      `&limit=${Math.min(limit, PAGE_SIZE)}&access_token=${encodeURIComponent(token)}`
    let failed = false

    for (let page = 0; page < MAX_PAGES && url && collected.length < limit; page++) {
      try {
        const res = await fetch(url, { cache: "no-store" })
        const json = await res.json()
        if (json.error) {
          console.warn("[ig-media] media fetch failed:", JSON.stringify(json.error))
          failed = true
          break
        }
        if (Array.isArray(json.data)) collected.push(...json.data)
        // The cursor already carries the token and the field set.
        url = json.paging?.next ?? ""
      } catch (e) {
        console.warn("[ig-media] media fetch threw:", e)
        failed = true
        break
      }
    }

    // A later page failing still leaves real posts in hand — only fall through
    // to the reduced field set when the very first page was refused.
    if (collected.length) return collected.slice(0, limit)
    if (!failed) return []
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

/**
 * Instagram's throttling codes. 4 and 32 are app-level, 17 and 613 are the
 * per-user hourly ceiling — the one an account with a lot of posts actually
 * meets, because insights are one call per post.
 */
const THROTTLE_CODES = new Set([4, 17, 32, 613])

export function isThrottled(error: any): boolean {
  return THROTTLE_CODES.has(Number(error?.code))
}

/** How many insight calls are in flight at once. */
const INSIGHT_CONCURRENCY = 6

/**
 * Enrich every post with its metrics, six at a time.
 *
 * The fan-out used to be unbounded: one `Promise.all` over every post. At 25
 * posts that merely looked fast; at 60 it opens 60 simultaneous connections to
 * the same endpoint and Instagram starts refusing them, so `granted` comes back
 * false and every view and reach figure silently stays where it was. Bounding
 * the concurrency costs a little wall time and stops the whole batch failing.
 */
export async function attachInsights(
  token: string,
  posts: OwnPost[],
): Promise<{ granted: boolean; firstError?: any; throttled: boolean }> {
  const errors: any[] = []
  const queue = [...posts]

  const worker = async () => {
    for (let post = queue.shift(); post; post = queue.shift()) {
      try {
        const { error } = await fetchMediaInsights(token, post)
        if (error !== undefined) errors.push(error)
      } catch (e) {
        errors.push(e)
      }
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(INSIGHT_CONCURRENCY, posts.length) }, worker),
  )

  return {
    granted: posts.some((p) => p.views !== undefined || p.reach !== undefined),
    firstError: errors[0],
    // Worth separating: a throttled account has the permission and will get its
    // numbers back on its own, which is the opposite of the advice a missing
    // scope needs.
    throttled: errors.some(isThrottled),
  }
}
