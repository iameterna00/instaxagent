import type { AiSettings } from "@/lib/types"
import type { AccountSnapshot } from "@/lib/instagram-account"
import type { OwnPost } from "@/lib/instagram-media"
import { describeTranscript, type Transcript } from "./transcribe"
import { engagementRate, formatOf } from "./analysis"
import { extractJson } from "./content"
import { generateReply } from "./providers"

// ============================================================
// Script Analysis: score a script the creator has written but not yet filmed,
// against their OWN posts rather than a generic rubric.
//
// One rule governs this whole file: Instagram exposes no retention data — not
// per-second, not per-post, not at all. Every retention figure produced here is
// the model's prediction, and both the prompt and the UI must say so. The
// moment one of these numbers reads as measured, the feature is lying.
// ============================================================

export interface ScriptScore {
  /** "HOOK", "PAYOFF TIMING", "VOICE MATCH", "CTA STRENGTH". */
  label: string
  /** "4.1", "0:29" — whatever unit the dimension is in. */
  value: string
  /** What it is being compared against, e.g. "vs 6.4 avg". */
  baseline?: string
  /** 0-100, how full the bar sits. */
  pct?: number
  tone?: ScriptTone
}

export type ScriptTone = "good" | "warn" | "neutral"

export interface ScriptLine {
  /** Where this line falls once spoken, "M:SS". */
  t?: string
  text: string
  note: string
  /** ESTIMATED share still watching (0-100). A prediction, never a measurement. */
  retention?: number
  tone?: ScriptTone
}

export interface RewriteBeat {
  t?: string
  text: string
  /** What is on screen — the direction that goes with the line. */
  dir?: string
}

export interface ScriptAnalysisResult {
  /** 0-100 overall. */
  score?: number
  /** ESTIMATED overall retention (0-100). */
  retention_estimate?: number
  /** The one-paragraph read, shown large. */
  verdict?: string
  scores: ScriptScore[]
  lines: ScriptLine[]
  keep: string[]
  fix: string[]
  rewrite: RewriteBeat[]
  rewrite_score?: number
  rewrite_runtime?: string
}

export interface ScriptRequest {
  script: string
  format?: string
}

export interface ScriptContext {
  posts: OwnPost[]
  username: string
  account?: AccountSnapshot | null
  transcripts?: Map<string, Transcript>
}

const SYSTEM_PROMPT = `You are a senior short-form video editor reviewing a script a creator has written but not yet filmed. You have their recent posts, their real engagement numbers, and word-for-word transcripts of reels they have already published.

Your job is to tell them what will happen when they post this, and to hand back a better version.

Judge this script against THIS creator's own history, never against a generic rubric. "Strong hook" means strong compared with the hooks that actually worked on their account. If their best posts open on a money mistake and this script opens with a greeting, say that, and name the post you are comparing against.

RETENTION FIGURES ARE PREDICTIONS, NOT DATA.
Instagram does not publish retention curves, and you have not been given one. Every "retention" number you return is your own estimate of how many viewers are still watching at that point, inferred from the structure of the script and from how this creator's posts have performed. Estimate honestly:
- Start at 100 on the first line and never increase it — viewers do not come back mid-video.
- Drop it sharply where the script gives someone a reason to leave: a slow opening, jargon, an unearned promise, dead air before the payoff.
- Base the size of each drop on the script in front of you, not on a formula.
Do not describe these numbers as measured, observed or recorded anywhere in your output.

WHAT TO SCORE. Return exactly four dimensions, in this order:
1. HOOK — how hard the first line stops a scroll, out of 10, one decimal. Compare with the hooks in their transcripts.
2. PAYOFF TIMING — the timestamp where the viewer finally gets what the hook promised, as "M:SS". Earlier is better; on short-form anything past roughly 0:10 is a problem.
3. VOICE MATCH — 0-100, how closely the wording matches how this creator actually talks in their transcripts. Flag jargon they never use. If no transcripts were provided, return "n/a" as the value and say why in the baseline field.
4. CTA STRENGTH — 0-100, how specific and answerable the closing ask is. No ask at all scores below 35.

LINE BY LINE. Split the script into the lines as they would be spoken, give each an estimated timestamp based on a natural speaking pace, and for each one: say what it does to the viewer, and give your estimated retention at that point. Be concrete and quote the creator's own posts where they support the point. Mark each line "good", "warn" or "neutral".

KEEP and FIX. Two short lists. KEEP is what already works and must survive the rewrite — name the specific line. FIX is what loses viewers, each item naming the line and the reason. Be blunt; flattery here costs them views.

THE REWRITE. Rewrite the script as timestamped beats that fix everything in FIX while preserving everything in KEEP. Move the payoff as early as the material allows. Keep their vocabulary — the rewrite must sound like the same person, not like a marketer. For each beat give the line and the on-screen direction. Then score your own rewrite the same way you scored the original.

Never invent statistics or results about this creator that you were not given. If you do not have transcripts, do not claim to know how they sound on camera.

Respond with ONLY a JSON object matching this shape, and nothing else — no prose, no markdown fences:
{
  "score": 61,
  "retention_estimate": 44,
  "verdict": "one paragraph naming the single biggest problem and the fix, written to the creator",
  "scores": [
    { "label": "HOOK", "value": "4.1", "baseline": "vs 6.4 avg", "pct": 41, "tone": "warn" },
    { "label": "PAYOFF TIMING", "value": "0:29", "baseline": "target 0:08", "pct": 22, "tone": "warn" },
    { "label": "VOICE MATCH", "value": "72", "baseline": "jargon flagged", "pct": 72, "tone": "neutral" },
    { "label": "CTA STRENGTH", "value": "31", "baseline": "no ask", "pct": 31, "tone": "warn" }
  ],
  "lines": [
    { "t": "0:00", "text": "the line as written", "note": "what it does to the viewer", "retention": 100, "tone": "warn" }
  ],
  "keep": ["specific line, and why it survives"],
  "fix": ["specific line, and what it costs"],
  "rewrite": [
    { "t": "0:00", "text": "the rewritten line", "dir": "what is on screen" }
  ],
  "rewrite_score": 88,
  "rewrite_runtime": "0:34"
}`

const TRANSCRIPT_CHARS = 1400
const CAPTION_CHARS = 220
const MAX_POSTS = 20

/** The creator's own posts, as calibration for what a good score means here. */
function describeCalibration(
  posts: OwnPost[],
  transcripts?: Map<string, Transcript>,
  followers?: number,
): string {
  if (!posts.length) {
    return "No posts were available from their account, so you have no baseline. Say plainly in the verdict that the scores are generic rather than calibrated to them, and do not claim to know what works on their account."
  }

  // Best first — the hooks worth comparing against are the ones that landed.
  const ranked = [...posts]
    .sort((a, b) => (b.views ?? b.reach ?? 0) - (a.views ?? a.reach ?? 0))
    .slice(0, MAX_POSTS)

  return ranked
    .map((post, i) => {
      const caption = (post.caption ?? "").replace(/\s+/g, " ").trim().slice(0, CAPTION_CHARS)
      const date = post.timestamp ? new Date(post.timestamp).toISOString().slice(0, 10) : "unknown date"

      const stats = [
        post.views !== undefined ? `${post.views} views` : null,
        post.reach !== undefined ? `${post.reach} reach` : null,
        post.like_count !== undefined ? `${post.like_count} likes` : null,
        post.comments_count !== undefined ? `${post.comments_count} comments` : null,
        post.saved !== undefined ? `${post.saved} saves` : null,
      ].filter(Boolean)

      const er = engagementRate(post)
      if (er !== undefined) stats.push(`${(er * 100).toFixed(1)}% engagement rate`)

      const spread = post.reach ?? post.views
      if (followers && followers > 0 && spread !== undefined) {
        stats.push(`${(spread / followers).toFixed(1)}× followers`)
      }

      const head = `${i + 1}. [${formatOf(post)} · ${date}${stats.length ? ` · ${stats.join(", ")}` : ""}] ${caption || "(no caption)"}`

      const transcript = post.id ? transcripts?.get(post.id) : undefined
      return transcript ? `${head}\n${describeTranscript(transcript, TRANSCRIPT_CHARS)}` : head
    })
    .join("\n")
}

export function buildScriptPrompt(request: ScriptRequest, context: ScriptContext): string {
  const { posts, username, account, transcripts } = context
  const followers = account?.profile.followers_count

  const sections = [`Creator: @${username}`]

  if (followers !== undefined) {
    sections.push(`Followers: ${followers.toLocaleString("en-US")}`)
  } else {
    sections.push("Followers: not reported by the API — do not guess the account size.")
  }
  if (account?.profile.biography?.trim()) {
    sections.push(`Bio as written: ${account.profile.biography.trim().slice(0, 300)}`)
  }

  sections.push("", `Format they intend to post this as: ${request.format || "reel"}`)

  sections.push(
    "",
    "THE SCRIPT TO ANALYSE — everything between the markers is theirs, unedited:",
    "<<<SCRIPT",
    request.script.trim(),
    "SCRIPT>>>",
  )

  sections.push(
    "",
    "Their own recent posts, best performing first. This is your calibration — score the script against these, not against short-form in general:",
    describeCalibration(posts, transcripts, followers),
  )

  const transcribed = posts.filter((p) => p.id && transcripts?.has(p.id)).length
  sections.push(
    "",
    transcribed
      ? `${transcribed} of those posts ${transcribed === 1 ? "carries" : "carry"} a word-for-word transcript, with [seconds] marks showing when each line was spoken. Use them for VOICE MATCH and for judging how quickly their successful posts reach the payoff.`
      : "No transcripts were available, so you have never heard this creator speak. Return \"n/a\" for VOICE MATCH, say so in the verdict, and do not characterise their spoken voice.",
  )

  return sections.join("\n")
}

// ------------------------------------------------------------

function toStringArray(value: any): string[] {
  if (Array.isArray(value)) return value.map((v) => String(v)).filter(Boolean)
  if (typeof value === "string" && value.trim()) return [value.trim()]
  return []
}

function toTone(value: any): ScriptTone | undefined {
  const tone = String(value ?? "").toLowerCase()
  return tone === "good" || tone === "warn" || tone === "neutral" ? tone : undefined
}

/** Clamp to 0-100, or drop it. A half-parsed percentage would render a wrong bar. */
function toPct(value: any): number | undefined {
  const n = Number(String(value ?? "").replace("%", "").trim())
  if (!Number.isFinite(n)) return undefined
  return Math.max(0, Math.min(100, Math.round(n)))
}

export function normalizeScriptAnalysis(parsed: any): ScriptAnalysisResult {
  const text = (value: any): string | undefined => {
    const s = value === undefined || value === null ? "" : String(value).trim()
    return s ? s : undefined
  }

  const scores: ScriptScore[] = (Array.isArray(parsed?.scores) ? parsed.scores : [])
    .map((s: any) => ({
      label: String(s?.label ?? "").trim().toUpperCase(),
      value: String(s?.value ?? "—").trim(),
      baseline: text(s?.baseline),
      pct: toPct(s?.pct),
      tone: toTone(s?.tone),
    }))
    .filter((s: ScriptScore) => s.label)

  // Retention can only fall. A model that drifts upward would draw a curve
  // implying viewers came back, which never happens on short-form.
  let ceiling = 100
  const lines: ScriptLine[] = (Array.isArray(parsed?.lines) ? parsed.lines : [])
    .map((l: any) => {
      const raw = toPct(l?.retention)
      const retention = raw === undefined ? undefined : Math.min(raw, ceiling)
      if (retention !== undefined) ceiling = retention
      return {
        t: text(l?.t ?? l?.time),
        text: String(l?.text ?? "").trim(),
        note: String(l?.note ?? "").trim(),
        retention,
        tone: toTone(l?.tone),
      }
    })
    .filter((l: ScriptLine) => l.text)

  const rewrite: RewriteBeat[] = (Array.isArray(parsed?.rewrite) ? parsed.rewrite : [])
    .map((r: any) => ({
      t: text(r?.t ?? r?.time),
      text: String(r?.text ?? "").trim(),
      dir: text(r?.dir ?? r?.direction),
    }))
    .filter((r: RewriteBeat) => r.text)

  return {
    score: toPct(parsed?.score),
    retention_estimate: toPct(parsed?.retention_estimate),
    verdict: text(parsed?.verdict),
    scores,
    lines,
    keep: toStringArray(parsed?.keep),
    fix: toStringArray(parsed?.fix),
    rewrite,
    rewrite_score: toPct(parsed?.rewrite_score),
    rewrite_runtime: text(parsed?.rewrite_runtime),
  }
}

export async function generateScriptAnalysis(
  settings: AiSettings,
  request: ScriptRequest,
  context: ScriptContext,
): Promise<{ ok: true; result: ScriptAnalysisResult } | { ok: false; error: string }> {
  const result = await generateReply({
    provider: settings.provider,
    apiKey: settings.api_key!,
    model: settings.model,
    systemPrompt: SYSTEM_PROMPT,
    history: [{ role: "user", content: buildScriptPrompt(request, context) }],
    maxTokens: 16000,
    effort: "high",
  })

  if (!result.ok || !result.text) {
    return { ok: false, error: result.error || "Analysis failed" }
  }

  try {
    const analysis = normalizeScriptAnalysis(extractJson(result.text))
    if (!analysis.lines.length && !analysis.verdict) {
      return { ok: false, error: "The model returned nothing usable — try again" }
    }
    return { ok: true, result: analysis }
  } catch (e: any) {
    console.error("[script] Could not parse model output:", e?.message)
    return { ok: false, error: "The model's response was not valid JSON — try again" }
  }
}

/** Rough spoken length, for the word/second chips beside the input. */
export function estimateSpokenSeconds(script: string): number {
  const words = script.trim().split(/\s+/).filter(Boolean).length
  // ~2.6 words/sec is the middle of the range short-form creators actually talk at.
  return Math.round(words / 2.6)
}
