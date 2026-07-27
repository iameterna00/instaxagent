import type { AiSettings } from "@/lib/types"
import type { OwnPost } from "@/lib/instagram-media"
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
}

export interface ContentPlanResult {
  analysis: ContentAnalysis
  ideas: ContentIdea[]
}

const SYSTEM_PROMPT = `You are a senior Instagram content strategist. You plan content that a real creator can film and post this week.

You will be given: the creator's goal, their niche and audience, their own recent posts (with engagement where available), and their notes about similar accounts they want to learn from.

Judge their existing content honestly. If something is not working, say so plainly. Do not flatter.

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

/** Compact digest of the creator's own posts — captions get trimmed hard to save tokens. */
function describeOwnPosts(posts: OwnPost[]): string {
  if (!posts.length) {
    return "No posts available from their account. Base your analysis on the stated goal and niche alone, and say so in the analysis."
  }

  const hasViews = posts.some((p) => p.views !== undefined)

  const lines = posts.slice(0, 25).map((post, i) => {
    const caption = (post.caption ?? "").replace(/\s+/g, " ").trim().slice(0, 220)
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

    return `${i + 1}. [${kind} · ${date}${stats.length ? ` · ${stats.join(", ")}` : ""}] ${caption || "(no caption)"}`
  })

  const guidance = hasViews
    ? "\n\nView and reach numbers are real. Compare posts against each other — name the specific posts that outperformed and say what they had in common. Do not treat a high view count as success if the goal needs conversions rather than reach."
    : "\n\nNo view/reach data was available for this account, so judge on captions, formats and posting patterns only. Say plainly in the analysis that performance data was not available."

  return lines.join("\n") + guidance
}

export function buildContentPrompt(request: ContentRequest, posts: OwnPost[], username: string): string {
  const count = Math.min(Math.max(request.ideaCount ?? 5, 1), 12)
  const formats = request.formats?.length ? request.formats.join(", ") : "any format you think fits"

  const sections = [
    `Creator: @${username}`,
    `Goal: ${request.goal}`,
    request.niche ? `Niche: ${request.niche}` : null,
    request.audience ? `Target audience: ${request.audience}` : null,
    `Formats wanted: ${formats}`,
    `Number of ideas: ${count}`,
    "",
    "Their recent posts:",
    describeOwnPosts(posts),
  ]

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

  return {
    analysis: {
      niche: parsed?.analysis?.niche ? String(parsed.analysis.niche) : undefined,
      what_is_working: toStringArray(parsed?.analysis?.what_is_working),
      gaps: toStringArray(parsed?.analysis?.gaps),
      positioning: parsed?.analysis?.positioning ? String(parsed.analysis.positioning) : undefined,
    },
    ideas,
  }
}

export async function generateContentPlan(
  settings: AiSettings,
  request: ContentRequest,
  posts: OwnPost[],
  username: string,
): Promise<{ ok: true; plan: ContentPlanResult } | { ok: false; error: string }> {
  const result = await generateReply({
    provider: settings.provider,
    apiKey: settings.api_key!,
    model: settings.model,
    systemPrompt: SYSTEM_PROMPT,
    history: [{ role: "user", content: buildContentPrompt(request, posts, username) }],
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
