import type { AiSettings } from "@/lib/types"
import type { AccountSnapshot, DemographicSlice } from "@/lib/instagram-account"
import type { OwnPost } from "@/lib/instagram-media"
import type { Transcript } from "./transcribe"
import { generateReply } from "./providers"

// ============================================================
// Content Studio: turn a stated goal + the account's own posts into
// concrete content ideas with scripts.
// ============================================================

// Media shapes live with the Instagram fetching code; re-exported so existing
// imports of OwnPost from this module keep working.
export type { OwnPost } from "@/lib/instagram-media"
export { isReel } from "@/lib/instagram-media"

export interface ContentRequest {
  goal: string
  niche?: string
  audience?: string
  formats?: string[]
  referenceNotes?: string
  ideaCount?: number
}

export interface ContentIdea {
  title: string
  format: string
  hook: string
  why_it_works?: string
  script: string[]
  caption?: string
  hashtags?: string[]
  cta?: string
}

export interface ContentAnalysis {
  niche?: string
  what_is_working?: string[]
  gaps?: string[]
  positioning?: string
  /** Where the account sits by size, and which tactics that stage rules in or out. */
  scale?: string
  /** The arithmetic between the current follower count and the stated goal. */
  growth_math?: string
  /** How the creator actually talks, observed from reel transcripts. */
  voice?: string
}

export interface ContentPlanResult {
  analysis: ContentAnalysis
  ideas: ContentIdea[]
}

/** Everything the planner reasons over, beyond the owner's typed brief. */
export interface ContentContext {
  posts: OwnPost[]
  username: string
  account?: AccountSnapshot | null
  transcripts?: Map<string, Transcript>
}

const SYSTEM_PROMPT = `You are a senior Instagram content strategist. You plan content that a real creator can film and post this week.

You will be given: the creator's goal, their niche and audience, their account size and audience demographics, their own recent posts (with engagement where available), word-for-word transcripts of their reels where those could be obtained, and their notes about similar accounts they want to learn from.

Judge their existing content honestly. If something is not working, say so plainly. Do not flatter.

Size the strategy to the account you were actually given:
- Read every number against the follower count. 5,000 views on a 500-follower account is distribution to strangers and worth doubling down on; the same 5,000 views on a 50,000-follower account means the post barely left the existing audience.
- Do the arithmetic between where they are now and the goal, and state it: how many net follows or conversions per week that implies, and whether their current output rate can get there. If the goal is not reachable at the current rate, say so and say what would have to change.
- Match tactics to the stage. A small account needs reach and a repeatable format that strangers can find. A mid-size account needs to convert existing reach into follows and DMs. A large account needs offers and depth, not more top-of-funnel. Never prescribe tactics that only work at a size they are not at.
- Write for the audience demographics you were given, not a generic viewer. If the followers skew to a specific age band or country, the references, examples and language must fit those people.

When reel transcripts are provided, they are the creator's actual spoken words:
- Critique the real hooks and the real pacing. Quote the opening line back at them when it is weak. Use the words-per-second figure to judge whether they talk too fast or pad the opening.
- Learn their vocabulary, sentence length and verbal habits, and write the new hooks, scripts and captions so they sound like the same person — not like a marketer.
- Compare transcripts of high performers against low performers and name the difference in how they opened, structured and closed.
- Only reason about content you were actually shown. For posts with no transcript, say so rather than guessing what was said.

Rules for the ideas you produce:
- Every idea must be specific to THIS account and goal. No generic advice like "post more reels" or "engage with your audience".
- Hooks must be the actual first line, written out, not a description of a hook.
- Scripts are beat-by-beat and shootable: what is on screen, what is said. Aim for 5-9 beats for a reel.
- Captions are written in the creator's voice, ready to paste.
- Never invent statistics, results, or claims about the creator that you were not told.

Respond with ONLY a JSON object matching this shape, and nothing else — no prose, no markdown fences:
{
  "analysis": {
    "niche": "one line naming the niche as you actually see it",
    "scale": "where this account sits by size, what its reach-vs-followers numbers say, and which tactics that stage rules in or out",
    "growth_math": "the arithmetic from today's numbers to the stated goal, with the weekly rate it requires and an honest verdict on whether the current output gets there",
    "voice": "how they actually talk, drawn from the transcripts — omit this field entirely if no transcripts were provided",
    "what_is_working": ["specific observation about their existing posts"],
    "gaps": ["specific thing missing that blocks the stated goal"],
    "positioning": "one paragraph on the angle they should own"
  },
  "ideas": [
    {
      "title": "short internal name",
      "format": "reel | carousel | story | post",
      "hook": "the literal first line on screen or spoken",
      "why_it_works": "one line tying it to the goal",
      "script": ["beat 1", "beat 2", "beat 3"],
      "caption": "ready-to-paste caption",
      "hashtags": ["tag", "tag"],
      "cta": "the specific ask"
    }
  ]
}`

/** How much of one transcript to include. Enough to judge structure, not the whole reel twice over. */
const TRANSCRIPT_CHARS = 1400
const CAPTION_CHARS = 400

function pct(part: number, whole: number): string {
  return `${Math.round((part / whole) * 100)}%`
}

/**
 * Account size and audience. This is what turns "41,000 views" from a number
 * into a judgement — the same figure means opposite things at 500 and 50,000
 * followers, so the follower count has to be in front of the model.
 */
function describeAccount(account: AccountSnapshot | null | undefined): string | null {
  if (!account) return null

  const { profile, insights, demographics } = account
  const followers = profile.followers_count
  const lines: string[] = []

  if (followers !== undefined) {
    lines.push(`Followers: ${followers.toLocaleString("en-US")}`)
  } else {
    lines.push("Followers: not available from the API — do not guess the account size, and say so in the analysis.")
  }
  if (profile.follows_count !== undefined) lines.push(`Accounts they follow: ${profile.follows_count}`)
  if (profile.media_count !== undefined) lines.push(`Total posts on the account: ${profile.media_count}`)
  if (profile.account_type) lines.push(`Account type: ${profile.account_type}`)
  if (profile.biography?.trim()) lines.push(`Bio as written: ${profile.biography.trim().slice(0, 300)}`)

  if (insights) {
    const window = `last ${insights.window_days} days`
    const parts: string[] = []
    if (insights.reach !== undefined) {
      const ratio =
        followers && followers > 0 ? ` (${(insights.reach / followers).toFixed(1)}× their follower count)` : ""
      parts.push(`reach ${insights.reach.toLocaleString("en-US")}${ratio}`)
    }
    if (insights.accounts_engaged !== undefined) parts.push(`accounts engaged ${insights.accounts_engaged}`)
    if (insights.total_interactions !== undefined) parts.push(`total interactions ${insights.total_interactions}`)
    if (insights.profile_views !== undefined) parts.push(`profile views ${insights.profile_views}`)
    if (insights.profile_links_taps !== undefined) parts.push(`bio link taps ${insights.profile_links_taps}`)
    if (insights.net_follows !== undefined) {
      parts.push(`net new followers ${insights.net_follows > 0 ? "+" : ""}${insights.net_follows}`)
    }
    if (parts.length) lines.push(`Account performance, ${window}: ${parts.join(", ")}`)

    // The single most useful derived number: current pace toward a follower goal.
    if (insights.net_follows !== undefined && insights.window_days > 0) {
      const perWeek = (insights.net_follows / insights.window_days) * 7
      lines.push(`Current growth pace: about ${perWeek.toFixed(0)} net followers per week.`)
    }
    if (insights.accounts_engaged !== undefined && insights.reach) {
      lines.push(
        `Of everyone reached in the ${window}, ${pct(insights.accounts_engaged, insights.reach)} engaged — ` +
          "treat that as their hook-and-hold rate.",
      )
    }
  } else {
    lines.push(
      "Account-level insights (reach, profile views, net follows) were not available, so growth pace cannot be measured. Say so rather than inventing a rate.",
    )
  }

  if (demographics) {
    const entries = Object.entries(demographics) as [string, DemographicSlice[] | undefined][]
    for (const [dimension, slices] of entries) {
      if (!slices?.length) continue
      const total = slices.reduce((sum: number, s: DemographicSlice) => sum + s.value, 0) || 1
      const rendered = slices
        .slice(0, 4)
        .map((s: DemographicSlice) => `${s.key} ${pct(s.value, total)}`)
        .join(", ")
      lines.push(`Follower ${dimension}: ${rendered}`)
    }
    lines.push("Write for these people specifically — references and language must land with them.")
  }

  return lines.join("\n")
}

/** Compact digest of the creator's own posts, with transcripts where we have them. */
function describeOwnPosts(
  posts: OwnPost[],
  transcripts?: Map<string, Transcript>,
  followers?: number,
): string {
  if (!posts.length) {
    return "No posts available from their account. Base your analysis on the stated goal and niche alone, and say so in the analysis."
  }

  // Reach counts as performance data just as much as views do — an account that
  // only posts stills gets reach and no views, and telling the model there is
  // no data would make it ignore numbers that are sitting right there.
  const hasPerformanceData = posts.some((p) => p.views !== undefined || p.reach !== undefined)

  const lines = posts.slice(0, 25).map((post, i) => {
    const caption = (post.caption ?? "").replace(/\s+/g, " ").trim().slice(0, CAPTION_CHARS)
    const kind = post.media_product_type === "REELS" ? "REEL" : post.media_type ?? "POST"
    const date = post.timestamp ? new Date(post.timestamp).toISOString().slice(0, 10) : "unknown date"

    const stats = [
      post.views !== undefined ? `${post.views} views` : null,
      post.reach !== undefined ? `${post.reach} reach` : null,
      post.like_count !== undefined ? `${post.like_count} likes` : null,
      post.comments_count !== undefined ? `${post.comments_count} comments` : null,
      post.saved !== undefined ? `${post.saved} saves` : null,
      post.shares !== undefined ? `${post.shares} shares` : null,
    ].filter(Boolean)

    // Reach relative to following is the number that says whether a post found
    // strangers or just circulated among existing followers.
    const spread = post.reach ?? post.views
    if (followers && followers > 0 && spread !== undefined) {
      stats.push(`${(spread / followers).toFixed(1)}× followers`)
    }

    const head = `${i + 1}. [${kind} · ${date}${stats.length ? ` · ${stats.join(", ")}` : ""}] ${caption || "(no caption)"}`

    const transcript = post.id ? transcripts?.get(post.id) : undefined
    if (!transcript) return head

    const words = transcript.text.split(/\s+/).filter(Boolean).length
    const pace =
      transcript.duration_seconds && transcript.duration_seconds > 0
        ? `${Math.round(transcript.duration_seconds)}s, ${(words / transcript.duration_seconds).toFixed(1)} words/sec`
        : `${words} words`
    const body = transcript.text.slice(0, TRANSCRIPT_CHARS)
    const truncated = transcript.text.length > TRANSCRIPT_CHARS ? " […]" : ""

    return `${head}\n   TRANSCRIPT (${pace}): "${body}${truncated}"`
  })

  const guidance = hasPerformanceData
    ? "\n\nView and reach numbers are real. Compare posts against each other — name the specific posts that outperformed and say what they had in common. Do not treat a high view count as success if the goal needs conversions rather than reach."
    : "\n\nNo view/reach data was available for this account, so judge on captions, formats and posting patterns only. Say plainly in the analysis that performance data was not available."

  const transcriptCount = posts.filter((p) => p.id && transcripts?.has(p.id)).length
  const transcriptNote = transcriptCount
    ? `\n\n${transcriptCount} of these posts ${transcriptCount === 1 ? "includes" : "include"} a word-for-word transcript of what was said on camera. Use them: critique the real opening lines, the real structure and the real pacing, and match their vocabulary in everything you write. Posts with no TRANSCRIPT line were not transcribed — do not speculate about their spoken content.`
    : "\n\nNo transcripts were available, so you have not heard any of this content. Judge captions, formats and numbers only, and do not claim to know how they deliver on camera."

  return lines.join("\n") + guidance + transcriptNote
}

export function buildContentPrompt(request: ContentRequest, context: ContentContext): string {
  const { posts, username, account, transcripts } = context
  const count = Math.min(Math.max(request.ideaCount ?? 5, 1), 12)
  const formats = request.formats?.length ? request.formats.join(", ") : "any format you think fits"
  const followers = account?.profile.followers_count

  const accountBlock = describeAccount(account)

  const sections = [
    `Creator: @${username}`,
    `Goal: ${request.goal}`,
    request.niche ? `Niche: ${request.niche}` : null,
    request.audience ? `Target audience they say they want: ${request.audience}` : null,
    `Formats wanted: ${formats}`,
    `Number of ideas: ${count}`,
  ]

  if (accountBlock) {
    sections.push("", "Their account, as the Instagram API reports it right now:", accountBlock)
  }

  sections.push("", "Their recent posts:", describeOwnPosts(posts, transcripts, followers))

  if (request.referenceNotes?.trim()) {
    sections.push(
      "",
      "Accounts they want to learn from, in their own words (you cannot browse these — treat it as reported information, not fact):",
      request.referenceNotes.trim(),
    )
  }

  sections.push("", `Produce exactly ${count} ideas.`)
  return sections.filter((s) => s !== null).join("\n")
}

/**
 * Models wrap JSON in prose or fences often enough that a bare JSON.parse is a
 * reliability bug. Pull out the outermost object before parsing.
 */
export function extractJson(raw: string): any {
  const text = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "")

  try {
    return JSON.parse(text)
  } catch {
    // fall through to brace scanning
  }

  const start = text.indexOf("{")
  if (start === -1) throw new Error("Model did not return JSON")

  // Walk to the matching close brace, ignoring braces inside strings.
  let depth = 0
  let inString = false
  let escaped = false
  for (let i = start; i < text.length; i++) {
    const char = text[i]
    if (escaped) {
      escaped = false
      continue
    }
    if (char === "\\") {
      escaped = true
      continue
    }
    if (char === '"') inString = !inString
    if (inString) continue
    if (char === "{") depth++
    else if (char === "}") {
      depth--
      if (depth === 0) return JSON.parse(text.slice(start, i + 1))
    }
  }
  throw new Error("Model returned truncated JSON")
}

function toStringArray(value: any): string[] {
  if (Array.isArray(value)) return value.map((v) => String(v)).filter(Boolean)
  if (typeof value === "string" && value.trim()) return [value.trim()]
  return []
}

export function normalizePlan(parsed: any): ContentPlanResult {
  const rawIdeas = Array.isArray(parsed?.ideas) ? parsed.ideas : []

  const ideas: ContentIdea[] = rawIdeas
    .map((idea: any) => ({
      title: String(idea?.title ?? "Untitled idea"),
      format: String(idea?.format ?? "reel").toLowerCase(),
      hook: String(idea?.hook ?? ""),
      why_it_works: idea?.why_it_works ? String(idea.why_it_works) : undefined,
      script: toStringArray(idea?.script),
      caption: idea?.caption ? String(idea.caption) : undefined,
      hashtags: toStringArray(idea?.hashtags).map((t) => t.replace(/^#/, "")),
      cta: idea?.cta ? String(idea.cta) : undefined,
    }))
    .filter((idea: ContentIdea) => idea.hook || idea.script.length)

  const analysis = parsed?.analysis ?? {}
  const text = (value: any): string | undefined => (value ? String(value) : undefined)

  return {
    analysis: {
      niche: text(analysis.niche),
      scale: text(analysis.scale),
      growth_math: text(analysis.growth_math),
      voice: text(analysis.voice),
      what_is_working: toStringArray(analysis.what_is_working),
      gaps: toStringArray(analysis.gaps),
      positioning: text(analysis.positioning),
    },
    ideas,
  }
}

export async function generateContentPlan(
  settings: AiSettings,
  request: ContentRequest,
  context: ContentContext,
): Promise<{ ok: true; plan: ContentPlanResult } | { ok: false; error: string }> {
  const result = await generateReply({
    provider: settings.provider,
    apiKey: settings.api_key!,
    model: settings.model,
    systemPrompt: SYSTEM_PROMPT,
    history: [{ role: "user", content: buildContentPrompt(request, context) }],
    maxTokens: 16000,
    // Worth the extra reasoning — this is planning, not a one-line DM reply.
    effort: "high",
  })

  if (!result.ok || !result.text) {
    return { ok: false, error: result.error || "Generation failed" }
  }

  try {
    const plan = normalizePlan(extractJson(result.text))
    if (!plan.ideas.length) return { ok: false, error: "The model returned no usable ideas — try again" }
    return { ok: true, plan }
  } catch (e: any) {
    console.error("[content] Could not parse model output:", e?.message)
    return { ok: false, error: "The model's response was not valid JSON — try again" }
  }
}
