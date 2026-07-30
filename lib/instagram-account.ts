const GRAPH = "https://graph.instagram.com"
const VERSION = "v24.0"

// ============================================================
// Account-level reads: how big the audience actually is, how it behaved over
// the last 30 days, and who is in it.
//
// Everything here is best-effort. Field availability on "Instagram API with
// Instagram Login" depends on the account type, the follower count and which
// permissions the token was minted with, and Meta fails the WHOLE request when
// one metric in the list is unavailable. So each group is requested separately
// and a failure degrades that group to `undefined` instead of losing the rest.
// ============================================================

export interface AccountProfile {
  username?: string
  name?: string
  biography?: string
  account_type?: string
  followers_count?: number
  follows_count?: number
  media_count?: number
}

export interface DemographicSlice {
  /** e.g. "25-34", "IN", "female" */
  key: string
  value: number
}

export interface FollowerDemographics {
  age?: DemographicSlice[]
  country?: DemographicSlice[]
  gender?: DemographicSlice[]
}

export interface AccountInsights {
  /** Days covered by the window below. */
  window_days: number
  /** Sum of daily reach over the window — unique accounts reached. */
  reach?: number
  profile_views?: number
  accounts_engaged?: number
  total_interactions?: number
  /** Net follower change over the window (follows minus unfollows). */
  net_follows?: number
  /** Taps on the bio link / website. */
  profile_links_taps?: number
}

export interface AccountSnapshot {
  profile: AccountProfile
  insights?: AccountInsights
  demographics?: FollowerDemographics
  /** Why insights or demographics are missing, for the UI to explain. */
  notes: string[]
}

async function getJson(url: string): Promise<any> {
  const res = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(20_000) })
  return res.json()
}

function errText(error: any): string {
  return error?.error_user_msg || error?.message || (typeof error === "string" ? error : JSON.stringify(error))
}

/**
 * Profile fields. `biography` and `followers_count` are not returned for every
 * account type, so narrow the field set until one request succeeds.
 */
export async function fetchAccountProfile(token: string): Promise<AccountProfile | null> {
  const attempts = [
    "username,name,biography,account_type,followers_count,follows_count,media_count",
    "username,account_type,followers_count,follows_count,media_count",
    "username,followers_count,media_count",
    "username,media_count",
  ]

  for (const fields of attempts) {
    try {
      const json = await getJson(`${GRAPH}/${VERSION}/me?fields=${fields}&access_token=${encodeURIComponent(token)}`)
      if (json.error) {
        console.warn("[ig-account] profile fetch failed:", errText(json.error))
        continue
      }
      return {
        username: json.username,
        name: json.name,
        biography: json.biography,
        account_type: json.account_type,
        followers_count: typeof json.followers_count === "number" ? json.followers_count : undefined,
        follows_count: typeof json.follows_count === "number" ? json.follows_count : undefined,
        media_count: typeof json.media_count === "number" ? json.media_count : undefined,
      }
    } catch (e) {
      console.warn("[ig-account] profile fetch threw:", e)
    }
  }
  return null
}

/** Insights windows are capped at 30 days, and today's numbers are incomplete. */
function window30(): { since: number; until: number; days: number } {
  const until = Math.floor(Date.now() / 1000) - 86_400
  return { since: until - 29 * 86_400, until, days: 30 }
}

function sumTimeSeries(entry: any): number | undefined {
  const values = entry?.values
  if (!Array.isArray(values)) return undefined
  const total = values.reduce((acc: number, v: any) => acc + (typeof v?.value === "number" ? v.value : 0), 0)
  return Number.isFinite(total) ? total : undefined
}

function totalValue(entry: any): number | undefined {
  const value = entry?.total_value?.value
  return typeof value === "number" ? value : undefined
}

/**
 * Net follower movement. `follows_and_unfollows` comes back as a total_value
 * metric with a breakdown; without the breakdown it is the net figure.
 */
function readNetFollows(entry: any): number | undefined {
  const direct = totalValue(entry)
  if (direct !== undefined) return direct
  return sumTimeSeries(entry)
}

export async function fetchAccountInsights(
  token: string,
): Promise<{ insights?: AccountInsights; notes: string[] }> {
  const { since, until, days } = window30()
  const notes: string[] = []
  const insights: AccountInsights = { window_days: days }
  const auth = `since=${since}&until=${until}&access_token=${encodeURIComponent(token)}`

  // --- Group 1: daily time series -------------------------------------------
  try {
    const json = await getJson(`${GRAPH}/${VERSION}/me/insights?metric=reach&period=day&${auth}`)
    if (json.error) {
      notes.push(`Account reach unavailable: ${errText(json.error)}`)
    } else {
      for (const entry of json.data ?? []) {
        if (entry?.name === "reach") insights.reach = sumTimeSeries(entry)
      }
    }
  } catch (e) {
    notes.push(`Account reach request failed: ${errText(e)}`)
  }

  // --- Group 2: totals over the window --------------------------------------
  // Requested one at a time: an account that cannot serve `profile_links_taps`
  // would otherwise take `accounts_engaged` down with it.
  const totals: [keyof AccountInsights, string][] = [
    ["accounts_engaged", "accounts_engaged"],
    ["total_interactions", "total_interactions"],
    ["profile_views", "profile_views"],
    ["net_follows", "follows_and_unfollows"],
    ["profile_links_taps", "profile_links_taps"],
  ]

  const results = await Promise.allSettled(
    totals.map(([, metric]) =>
      getJson(`${GRAPH}/${VERSION}/me/insights?metric=${metric}&metric_type=total_value&${auth}`),
    ),
  )

  results.forEach((result, i) => {
    const [field, metric] = totals[i]
    if (result.status !== "fulfilled") return
    const json = result.value
    if (json?.error) {
      // Only worth surfacing for the metrics a strategy actually depends on.
      if (field === "accounts_engaged" || field === "net_follows") {
        notes.push(`${metric} unavailable: ${errText(json.error)}`)
      }
      return
    }
    for (const entry of json?.data ?? []) {
      const value = field === "net_follows" ? readNetFollows(entry) : totalValue(entry) ?? sumTimeSeries(entry)
      if (value !== undefined) (insights[field] as number | undefined) = value
    }
  })

  const gotSomething = Object.keys(insights).length > 1
  return { insights: gotSomething ? insights : undefined, notes }
}

/**
 * Who follows the account. Meta requires at least 100 followers for this and
 * refuses outright below that, which is a normal state rather than an error.
 */
export async function fetchFollowerDemographics(
  token: string,
): Promise<{ demographics?: FollowerDemographics; notes: string[] }> {
  const notes: string[] = []
  const breakdowns: (keyof FollowerDemographics)[] = ["age", "country", "gender"]

  const results = await Promise.allSettled(
    breakdowns.map((breakdown) =>
      getJson(
        `${GRAPH}/${VERSION}/me/insights?metric=follower_demographics&period=lifetime` +
          `&metric_type=total_value&breakdown=${breakdown}&access_token=${encodeURIComponent(token)}`,
      ),
    ),
  )

  const demographics: FollowerDemographics = {}

  results.forEach((result, i) => {
    const breakdown = breakdowns[i]
    if (result.status !== "fulfilled") return
    const json = result.value
    if (json?.error) {
      if (breakdown === "age") notes.push(`Follower demographics unavailable: ${errText(json.error)}`)
      return
    }

    const slices: DemographicSlice[] = []
    for (const entry of json?.data ?? []) {
      for (const bucket of entry?.total_value?.breakdowns ?? []) {
        for (const row of bucket?.results ?? []) {
          const key = Array.isArray(row?.dimension_values) ? row.dimension_values.join(" · ") : null
          if (key && typeof row?.value === "number") slices.push({ key, value: row.value })
        }
      }
    }

    if (slices.length) {
      demographics[breakdown] = slices.sort((a, b) => b.value - a.value).slice(0, 6)
    }
  })

  const gotSomething = Object.keys(demographics).length > 0
  return { demographics: gotSomething ? demographics : undefined, notes }
}

/** One call for everything the planner needs about the audience. */
export async function fetchAccountSnapshot(token: string): Promise<AccountSnapshot | null> {
  const [profile, insightsResult, demographicsResult] = await Promise.all([
    fetchAccountProfile(token),
    fetchAccountInsights(token),
    fetchFollowerDemographics(token),
  ])

  if (!profile) return null

  return {
    profile,
    insights: insightsResult.insights,
    demographics: demographicsResult.demographics,
    notes: [...insightsResult.notes, ...demographicsResult.notes],
  }
}
