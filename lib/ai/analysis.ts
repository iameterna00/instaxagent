import type { AiSettings } from "@/lib/types"
import type { AccountSnapshot } from "@/lib/instagram-account"
import type { OwnPost } from "@/lib/instagram-media"
import { describeTranscript, type Transcript } from "./transcribe"
import { extractJson } from "./content"
import { generateReply } from "./providers"

// ============================================================
// Deep Analysis: score the account's own posts against each other and say
// what carried them.
//
// The split that matters here: every NUMBER comes from Instagram and is
// computed below, while every JUDGEMENT comes from the model. A model asked
// to restate view counts will quietly round or invent them, so it is never
// asked to — it only ever sees the real figures and explains them.
// ============================================================

export type { OwnPost } from "@/lib/instagram-media"

/** Where a post sits against the rest of the account. */
export type Band = "top" | "average" | "under"

/** The model's read on a single post. Numbers are deliberately absent. */
export interface PostVerdict {
  /** 0-100, judged relative to this account's own other posts. */
  score: number
  /** Short phrase for the expanded row, e.g. "strong hook, weak ending". */
  verdict?: string
  working: string[]
  improve: string[]
  /** Short graded labels, e.g. "HOOK 9.4". */
  tags: string[]
  /** The concrete thing to do about this post. */
  next?: string
  /** Predicted upside if the fixes land, e.g. "+18%". */
  lift?: string
  lift_note?: string
}

export interface AnalyzedPost extends OwnPost {
  analysis?: PostVerdict
}

/** The account-level read shown above the table. */
export interface AnalysisSummary {
  /** One paragraph naming the pattern that explains the period. */
  headline?: string
  what_is_working: string[]
  what_to_improve: string[]
  /** The single next post to make, specific enough to film. */
  next_post?: string
}

export interface DeepAnalysisResult {
  summary: AnalysisSummary
  posts: AnalyzedPost[]
}

export interface AnalysisContext {
  posts: OwnPost[]
  username: string
  account?: AccountSnapshot | null
  transcripts?: Map<string, Transcript>
}

// ------------------------------------------------------------
// Derived metrics — real data only, shared by the API and the UI so a saved
// analysis and a fresh one always render the same numbers.
// ------------------------------------------------------------

export function compact(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2).replace(/\.?0+$/, "")}M`
  if (n >= 10_000) return `${Math.round(n / 1_000)}K`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1).replace(/\.0$/, "")}K`
  return n.toLocaleString("en-US")
}

export type PostFormat = "REEL" | "CAROUSEL" | "STATIC" | "STORY"

export function formatOf(post: OwnPost): PostFormat {
  if (post.media_product_type === "REELS") return "REEL"
  if (post.media_product_type === "STORY") return "STORY"
  if (post.media_type === "CAROUSEL_ALBUM") return "CAROUSEL"
  if (post.media_type === "VIDEO") return "REEL"
  return "STATIC"
}

/**
 * Interactions over reach. Reach is the right denominator — followers would
 * measure the audience rather than the post, and views double-count rewatches.
 */
export function engagementRate(post: OwnPost): number | undefined {
  const denominator = post.reach ?? post.views
  if (!denominator) return undefined
  const interactions =
    (post.like_count ?? 0) + (post.comments_count ?? 0) + (post.saved ?? 0) + (post.shares ?? 0)
  return interactions / denominator
}

export function band(score: number): Band {
  if (score >= 80) return "top"
  if (score >= 55) return "average"
  return "under"
}

export const BAND_LABEL: Record<Band, string> = {
  top: "Top performer",
  average: "Average",
  under: "Underperforming",
}

const METRICS = [
  { key: "views", label: "Views", read: (p: OwnPost) => p.views },
  { key: "reach", label: "Reach", read: (p: OwnPost) => p.reach },
  { key: "likes", label: "Likes", read: (p: OwnPost) => p.like_count },
  { key: "saves", label: "Saves", read: (p: OwnPost) => p.saved },
  { key: "comments", label: "Comments", read: (p: OwnPost) => p.comments_count },
] as const

/** Mean of each metric across the posts that actually reported it. */
export function accountAverages(posts: OwnPost[]): Record<string, number> {
  const averages: Record<string, number> = {}
  for (const metric of METRICS) {
    const values = posts.map(metric.read).filter((v): v is number => typeof v === "number")
    if (values.length) averages[metric.key] = values.reduce((a, b) => a + b, 0) / values.length
  }
  return averages
}

export interface Comparison {
  label: string
  /** Signed percentage against the account mean, e.g. "+238%". */
  delta: string
  /** Bar width 0-100, saturating at 3x the mean so one outlier cannot flatten the rest. */
  pct: number
  tone: "up" | "down" | "flat"
}

/** How this post did against the account's own average, per metric. */
export function compareToAverage(post: OwnPost, averages: Record<string, number>): Comparison[] {
  const rows: Comparison[] = []

  for (const metric of METRICS) {
    const value = metric.read(post)
    const mean = averages[metric.key]
    if (typeof value !== "number" || !mean) continue

    const ratio = value / mean
    const change = Math.round((ratio - 1) * 100)
    rows.push({
      label: metric.label,
      delta: `${change > 0 ? "+" : ""}${change}%`,
      pct: Math.max(3, Math.min(100, Math.round((ratio / 3) * 100))),
      tone: change > 8 ? "up" : change < -8 ? "down" : "flat",
    })
  }

  // Strongest signal first, so the expanded row leads with what stands out.
  return rows.sort((a, b) => Math.abs(parseInt(b.delta)) - Math.abs(parseInt(a.delta))).slice(0, 4)
}

export interface FormatRow {
  format: PostFormat
  count: number
  avgScore: number
}

/** Average model score per format — real grouping, model scores. */
export function formatLeaderboard(posts: AnalyzedPost[]): FormatRow[] {
  const groups = new Map<PostFormat, number[]>()
  for (const post of posts) {
    if (!post.analysis) continue
    const key = formatOf(post)
    groups.set(key, [...(groups.get(key) ?? []), post.analysis.score])
  }

  return [...groups.entries()]
    .map(([format, scores]) => ({
      format,
      count: scores.length,
      avgScore: Math.round(scores.reduce((a, b) => a + b, 0) / scores.length),
    }))
    .sort((a, b) => b.avgScore - a.avgScore)
}

export function scoreBands(posts: AnalyzedPost[]): Record<Band, number> {
  const counts: Record<Band, number> = { top: 0, average: 0, under: 0 }
  for (const post of posts) {
    if (post.analysis) counts[band(post.analysis.score)]++
  }
  return counts
}

export function averageScore(posts: AnalyzedPost[]): number {
  const scores = posts.map((p) => p.analysis?.score).filter((s): s is number => typeof s === "number")
  if (!scores.length) return 0
  return Math.round(scores.reduce((a, b) => a + b, 0) / scores.length)
}

export interface Totals {
  views?: number
  reach?: number
  engagementRate?: number
  netFollows?: number
  /** Posts that reported reach, so the UI can caption partial coverage honestly. */
  measured: number
}

/** The four headline figures. Summed from posts; follows come from the account. */
export function accountTotals(posts: OwnPost[], account?: AccountSnapshot | null): Totals {
  const sum = (read: (p: OwnPost) => number | undefined) => {
    const values = posts.map(read).filter((v): v is number => typeof v === "number")
    return values.length ? values.reduce((a, b) => a + b, 0) : undefined
  }

  const reach = sum((p) => p.reach)
  const interactions =
    sum((p) => p.like_count) !== undefined || sum((p) => p.comments_count) !== undefined
      ? (sum((p) => p.like_count) ?? 0) + (sum((p) => p.comments_count) ?? 0) + (sum((p) => p.saved) ?? 0)
      : undefined

  return {
    views: sum((p) => p.views),
    reach,
    engagementRate: reach && interactions !== undefined ? interactions / reach : undefined,
    netFollows: account?.insights?.net_follows,
    measured: posts.filter((p) => p.reach !== undefined || p.views !== undefined).length,
  }
}

// ------------------------------------------------------------
// Generation
// ------------------------------------------------------------

const SYSTEM_PROMPT = `You are a senior Instagram performance analyst. You are given one creator's own recent posts, with the real metrics Instagram reported for each, and you explain what actually drove the results.

Judge honestly. If a post or a whole format is not working, say so plainly and say what to do instead. Do not flatter, and do not hedge every criticism into meaninglessness.

HOW TO SCORE:
- Score every post 0-100 RELATIVE TO THIS ACCOUNT'S OTHER POSTS, not to Instagram at large. The best post in the set should land near the top of the range and the worst near the bottom. Returning ten similar scores is a failure — the whole point is separation.
- 80-100 = top performer, 55-79 = average, below 55 = underperforming.
- Read every number against the follower count. 5,000 views on a 500-follower account is real distribution to strangers; the same 5,000 on a 50,000-follower account means the post barely left the existing audience.
- Reach and saves matter more than likes. A post with high saves relative to reach earned distribution; a post with high likes and no saves circulated among people who already follow.
- Weigh recency lightly — a post from three days ago has not finished accumulating reach.

WHAT NOT TO DO:
- Never restate, round, or recalculate the metrics. They are already displayed next to your analysis; repeating them wastes the reader's attention and any discrepancy reads as a bug. Refer to them qualitatively ("your highest save rate this period"), not numerically.
- Never invent a metric you were not given. If saves are missing, do not reason about saves.
- Never give generic advice. "Post more reels", "engage with your audience" and "use trending audio" are worthless. Every point must name something specific about the post in front of you.
- Only reason about content you were actually shown. Where a transcript is provided you have heard the post; where it is not, you have only the caption and the numbers, so do not speculate about what was said on camera.

TAGS: give each post 3-5 short graded labels scoring a specific dimension out of 10, formatted exactly as "DIMENSION 0.0" — for example "HOOK 9.4", "PACING 6.1", "CAPTION 5.0", "TIMING 8.2". Choose dimensions that are genuinely diagnostic for that post. The grades must agree with the score: a post scoring 34 cannot carry three grades above 8.

Respond with ONLY a JSON object matching this shape, and nothing else — no prose, no markdown fences:
{
  "summary": {
    "headline": "one paragraph naming the single pattern that explains this period — which kind of post is carrying the account and which is dragging it down. Be concrete about the pattern, not the numbers.",
    "what_is_working": ["3 specific, repeatable observations — a framing, a structure, a posting slot"],
    "what_to_improve": ["3 specific problems, each one actionable"],
    "next_post": "the single next post to make, specific enough to film: format, length, opening shot, where the CTA goes, when to publish"
  },
  "posts": [
    {
      "index": 1,
      "score": 94,
      "verdict": "short phrase, e.g. 'your best post this month' or 'strong hook, weak ending'",
      "working": ["what this post did right, 1-3 points"],
      "improve": ["what held it back, 1-3 points"],
      "tags": ["HOOK 9.4", "PACING 8.8", "CAPTION 5.1"],
      "next": "the concrete thing to do about this specific post",
      "lift": "+18%",
      "lift_note": "one line on what that upside depends on"
    }
  ]
}

Return exactly one entry in "posts" for every post you were given, using the "index" number shown in the list.`

// Timestamps cost ~7 characters a line, so the cap is a little higher than it
// was to keep the same amount of actual speech in the prompt.
const TRANSCRIPT_CHARS = 1400
const CAPTION_CHARS = 400

/** The post list the model reasons over. Indexed, because verdicts come back by index. */
function describePosts(
  posts: OwnPost[],
  transcripts?: Map<string, Transcript>,
  followers?: number,
): string {
  const lines = posts.map((post, i) => {
    const caption = (post.caption ?? "").replace(/\s+/g, " ").trim().slice(0, CAPTION_CHARS)
    const date = post.timestamp ? new Date(post.timestamp).toISOString().slice(0, 10) : "unknown date"

    const stats = [
      post.views !== undefined ? `${post.views} views` : null,
      post.reach !== undefined ? `${post.reach} reach` : null,
      post.like_count !== undefined ? `${post.like_count} likes` : null,
      post.comments_count !== undefined ? `${post.comments_count} comments` : null,
      post.saved !== undefined ? `${post.saved} saves` : null,
      post.shares !== undefined ? `${post.shares} shares` : null,
    ].filter(Boolean)

    const er = engagementRate(post)
    if (er !== undefined) stats.push(`${(er * 100).toFixed(1)}% engagement rate`)

    // Reach against following is what says whether a post found strangers.
    const spread = post.reach ?? post.views
    if (followers && followers > 0 && spread !== undefined) {
      stats.push(`${(spread / followers).toFixed(1)}× followers`)
    }

    const head = `${i + 1}. [${formatOf(post)} · ${date}${stats.length ? ` · ${stats.join(", ")}` : ""}] ${caption || "(no caption)"}`

    const transcript = post.id ? transcripts?.get(post.id) : undefined
    if (!transcript) return head

    return `${head}\n${describeTranscript(transcript, TRANSCRIPT_CHARS)}`
  })

  return lines.join("\n")
}

export function buildAnalysisPrompt(context: AnalysisContext): string {
  const { posts, username, account, transcripts } = context
  const followers = account?.profile.followers_count

  const sections = [`Creator: @${username}`]

  if (followers !== undefined) {
    sections.push(`Followers: ${followers.toLocaleString("en-US")}`)
  } else {
    sections.push("Followers: not reported by the API — do not guess the account size, and do not scale your judgements to an assumed one.")
  }
  if (account?.profile.media_count !== undefined) {
    sections.push(`Total posts on the account: ${account.profile.media_count}`)
  }
  if (account?.profile.biography?.trim()) {
    sections.push(`Bio as written: ${account.profile.biography.trim().slice(0, 300)}`)
  }

  const hasInsights = posts.some((p) => p.views !== undefined || p.reach !== undefined)
  sections.push(
    "",
    `Their ${posts.length} most recent posts:`,
    describePosts(posts, transcripts, followers),
    "",
    hasInsights
      ? "These view, reach and save numbers are real. Compare the posts against each other and name what the strong ones had in common."
      : "No view or reach numbers were available for this account, so judge on captions, formats, likes, comments and posting patterns only. Say plainly in the summary that performance data was missing, and keep the scores closer together than you otherwise would — you cannot separate these posts confidently without reach.",
  )

  const transcribed = posts.filter((p) => p.id && transcripts?.has(p.id)).length
  sections.push(
    "",
    transcribed
      ? `${transcribed} of these posts ${transcribed === 1 ? "includes" : "include"} a word-for-word transcript. Use them: critique the real opening lines, the real structure and the real pacing. Where a transcript carries [seconds] marks you know exactly when each line was spoken — judge the hook by how long it takes the first real claim to arrive, and the pacing by where the gaps fall, not by the average alone. Transcripts cached before timestamps were kept have no marks; judge those on wording only. Posts with no TRANSCRIPT line were not transcribed — do not speculate about their spoken content.`
      : "No transcripts were available, so you have not heard any of this content. Judge captions, formats and numbers only, and do not claim to know how they deliver on camera.",
  )

  sections.push("", `Return exactly ${posts.length} entries in "posts", one per index above.`)
  return sections.join("\n")
}

function toStringArray(value: any, limit: number): string[] {
  if (Array.isArray(value)) return value.map((v) => String(v)).filter(Boolean).slice(0, limit)
  if (typeof value === "string" && value.trim()) return [value.trim()]
  return []
}

function toScore(value: any): number {
  const n = Number(value)
  if (!Number.isFinite(n)) return 50
  return Math.max(0, Math.min(100, Math.round(n)))
}

/**
 * Merge verdicts back onto the real posts by the index the model was given.
 * A post whose verdict is missing or unparseable keeps its metrics and simply
 * renders without analysis, rather than dropping out of the table.
 */
export function normalizeAnalysis(parsed: any, posts: OwnPost[]): DeepAnalysisResult {
  const byIndex = new Map<number, any>()
  for (const entry of Array.isArray(parsed?.posts) ? parsed.posts : []) {
    const index = Number(entry?.index)
    if (Number.isFinite(index)) byIndex.set(index, entry)
  }

  const analyzed: AnalyzedPost[] = posts.map((post, i) => {
    const entry = byIndex.get(i + 1)
    if (!entry) return { ...post }

    return {
      ...post,
      analysis: {
        score: toScore(entry.score),
        verdict: entry.verdict ? String(entry.verdict) : undefined,
        working: toStringArray(entry.working, 3),
        improve: toStringArray(entry.improve, 3),
        tags: toStringArray(entry.tags, 5),
        next: entry.next ? String(entry.next) : undefined,
        lift: entry.lift ? String(entry.lift) : undefined,
        lift_note: entry.lift_note ? String(entry.lift_note) : undefined,
      },
    }
  })

  const summary = parsed?.summary ?? {}
  return {
    summary: {
      headline: summary.headline ? String(summary.headline) : undefined,
      what_is_working: toStringArray(summary.what_is_working, 4),
      what_to_improve: toStringArray(summary.what_to_improve, 4),
      next_post: summary.next_post ? String(summary.next_post) : undefined,
    },
    posts: analyzed,
  }
}

export async function generateDeepAnalysis(
  settings: AiSettings,
  context: AnalysisContext,
): Promise<{ ok: true; result: DeepAnalysisResult } | { ok: false; error: string }> {
  if (!context.posts.length) {
    return { ok: false, error: "No posts came back from Instagram — nothing to analyse yet." }
  }

  const result = await generateReply({
    provider: settings.provider,
    apiKey: settings.api_key!,
    model: settings.model,
    systemPrompt: SYSTEM_PROMPT,
    history: [{ role: "user", content: buildAnalysisPrompt(context) }],
    maxTokens: 16000,
    // Ranking a whole period against itself is reasoning, not recall.
    effort: "high",
  })

  if (!result.ok || !result.text) {
    return { ok: false, error: result.error || "Generation failed" }
  }

  try {
    const analysis = normalizeAnalysis(extractJson(result.text), context.posts)
    if (!analysis.posts.some((p) => p.analysis)) {
      return { ok: false, error: "The model scored none of the posts — try again" }
    }
    return { ok: true, result: analysis }
  } catch (e: any) {
    console.error("[analysis] Could not parse model output:", e?.message)
    return { ok: false, error: "The model's response was not valid JSON — try again" }
  }
}
