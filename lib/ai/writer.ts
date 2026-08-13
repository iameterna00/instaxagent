import type { AiSettings } from "@/lib/types"
import type { AccountSnapshot } from "@/lib/instagram-account"
import type { OwnPost } from "@/lib/instagram-media"
import { describeTranscript, spokenText, type Transcript } from "./transcribe"
import { formatOf } from "./analysis"
import { extractJson } from "./content"
import { generateReply } from "./providers"

// ============================================================
// Script Writer: write the creator's NEXT script.
//
// The premise of this file is that a model left to write short-form on its own
// writes the same beige script every time — three-part listicle, "let's dive
// in", a CTA nobody answers. So it is never asked to. It is handed the
// word-for-word transcripts of reels this account has already published,
// ordered by how well each one actually performed, and told to do two things in
// order: extract the template first, then refill it with the new topic.
//
// The ordering IS the instruction. Reference 1 is their best performing reel,
// so it is the primary template; the tail is only there to separate a habit
// from a one-off. The extracted template is returned alongside the script and
// stored, because it is the only way to check afterwards that the script
// followed their format rather than the model's.
// ============================================================

export interface WriterStep {
  /** "HOOK", "TURN", "PAYOFF" — whatever the creator's own reels actually do. */
  label: string
  /** Where the beat lands in their reels, e.g. "0:00–0:03". */
  t?: string
  /** What the beat is for, in terms of what it does to the viewer. */
  purpose: string
  /** The line from their own transcripts that proves the beat exists. */
  evidence?: string
}

export interface WriterBeat {
  t?: string
  text: string
  /** What is on screen while the line is spoken. */
  dir?: string
}

export interface WriterStructure {
  /** One paragraph: the formula their best reels follow. */
  summary?: string
  /** Observed delivery pace, e.g. "2.9 words/sec, first payoff by 0:07". */
  pacing?: string
  steps: WriterStep[]
  /** Delivery rules copied from the transcripts: phrasing, fillers, address. */
  voice: string[]
}

export interface WrittenScript {
  title?: string
  topic?: string
  hook: string
  runtime?: string
  beats: WriterBeat[]
  caption?: string
  cta?: string
  hashtags: string[]
}

export interface ScriptWriterResult {
  structure: WriterStructure
  script: WrittenScript
  /** Which reels this was modelled on, best performing first. */
  modeled_on: string[]
  /** Anywhere the model knowingly departed from the template, and why. */
  notes: string[]
}

export interface ScriptWriterRequest {
  /** Blank means "pick a topic that fits what already works for me". */
  topic?: string
  format?: string
}

export interface ScriptWriterContext {
  posts: OwnPost[]
  username: string
  account?: AccountSnapshot | null
  transcripts?: Map<string, Transcript>
}

const SYSTEM_PROMPT = `You are a ghostwriter for one specific short-form creator. You are not a general copywriter and you have no house style of your own. Everything you write has to sound like it came out of their mouth.

You are given word-for-word transcripts of reels this creator has already published, ORDERED BY HOW WELL EACH ONE ACTUALLY PERFORMED — reference 1 is their best, the last reference is their weakest. That order is the most important instruction in this prompt:
- References 1–3 are the PRIMARY TEMPLATE. The script you write copies their shape.
- The rest exist only so you can tell a repeated habit from a one-off. Where a lower reference contradicts reference 1, follow reference 1.
- A pattern that appears only in the weakest references is a pattern to AVOID, not to copy. Say so if you spot one.

WORK IN THIS ORDER, AND DO NOT SKIP THE FIRST STEP.

STEP 1 — EXTRACT THE TEMPLATE. Before writing a single new line, read the transcripts as structure, not as content. Determine:
- The beat order their winning reels actually follow, with the timestamps the [seconds] marks show — how they open, how long before the first payoff, where the turn is, how they close. Use their real timings, not textbook ones.
- Their delivery: sentence length, whether they speak in fragments or full sentences, the words they reach for and the words they never use, filler and connective tissue ("so", "look", "here's the thing"), how they address the viewer (you / we / nobody), whether they self-interrupt, how they handle numbers, whether they ask questions out loud.
- Their pacing in words per second, and what that means for how many words the new script can hold.
- How their CTA is actually phrased — most creators do not say "link in bio" the way marketers do.
Name each beat with the label THIS creator's reels earn, not a generic funnel name, and quote the line from their transcripts that proves the beat exists.

STEP 2 — WRITE THE NEW SCRIPT on the requested topic, pouring it into the template from step 1. Same beat order, same timings, same rhythm, same vocabulary, same closing move. Only the subject matter is new.

HARD RULES FOR THE SCRIPT:
- Every line must be sayable out loud by this person. If a line would make them sound like an ad, cut it.
- Do not use phrasing they never use. No "dive in", "unlock", "game-changer", "in this video", "let's get started", "buckle up" — unless the transcripts show them genuinely saying it.
- Match their opening move exactly. If their best reels open cold on a claim, do not open with a greeting.
- Hit the first payoff no later than their own reels do. If reference 1 pays off at 0:06, yours cannot wander until 0:20.
- Keep the word count inside the runtime at THEIR measured words-per-second. A 35-second reel at 2.8 words/sec is about 98 words — do not hand back 300.
- Write the beats as they would be spoken, with timestamps, plus the on-screen direction for each.
- If the topic genuinely does not fit their proven structure, still write it their way, and say what you had to bend in the notes.

If no transcripts were provided you cannot do this job properly: say so plainly in the notes, work from their captions and performance numbers alone, and do not claim to know how they speak.

Never invent statistics, results or client stories for this creator that you were not given.

Respond with ONLY a JSON object matching this shape, and nothing else — no prose, no markdown fences:
{
  "structure": {
    "summary": "one paragraph naming the formula their best reels follow",
    "pacing": "2.9 words/sec, first payoff by 0:07, reels run 0:30-0:40",
    "steps": [
      { "label": "COLD CLAIM", "t": "0:00-0:03", "purpose": "what this beat does to the viewer", "evidence": "\\"quoted line from their own transcript\\" — reel #1" }
    ],
    "voice": ["short fragments, rarely more than 9 words", "says 'honestly' to mark the turn", "never says 'link in bio' — says 'it's in my bio if you want it'"]
  },
  "script": {
    "title": "internal name for this script",
    "topic": "the topic it covers",
    "hook": "the first line, exactly as spoken",
    "runtime": "0:36",
    "beats": [
      { "t": "0:00", "text": "the line as spoken", "dir": "what is on screen" }
    ],
    "caption": "the caption, written the way they write captions",
    "cta": "the closing ask, phrased the way they phrase it",
    "hashtags": ["tag", "tag"]
  },
  "modeled_on": ["reel #1 (128K views) — cold claim, payoff at 0:06, closes on a question"],
  "notes": ["anything you bent, and why"]
}`

/** Reference reels handed to the model. More than this and the prompt bloats. */
const MAX_REFERENCES = 12
/** The top few are the template, so they get read in full. */
const PRIMARY_REFERENCES = 3
const PRIMARY_CHARS = 2600
const SUPPORTING_CHARS = 1100
const CAPTION_CHARS = 200

export interface WriterReference {
  /** 1 = best performing. */
  rank: number
  post: OwnPost
  transcript: Transcript
}

/**
 * The transcripts, best performing first. This ordering is the whole feature —
 * it is what makes the model copy the reel that worked instead of averaging
 * every reel the account ever posted.
 */
export function rankReferences(
  posts: OwnPost[],
  transcripts?: Map<string, Transcript>,
  limit = MAX_REFERENCES,
): WriterReference[] {
  if (!transcripts?.size) return []

  return posts
    .filter((post) => post.id && transcripts.has(post.id))
    .sort((a, b) => (b.views ?? b.reach ?? 0) - (a.views ?? a.reach ?? 0))
    .slice(0, limit)
    .map((post, i) => ({ rank: i + 1, post, transcript: transcripts.get(post.id!)! }))
}

/** Words per second as actually spoken, when the transcript carries a duration. */
export function paceOf(transcript: Transcript): number | undefined {
  if (!transcript.duration_seconds || transcript.duration_seconds <= 0) return undefined
  const words = spokenText(transcript.text).split(/\s+/).filter(Boolean).length
  return words / transcript.duration_seconds
}

/** The median so one viral outlier doesn't set the target pace. */
function medianPace(references: WriterReference[]): number | undefined {
  const paces = references.map((r) => paceOf(r.transcript)).filter((p): p is number => p !== undefined)
  if (!paces.length) return undefined
  const sorted = [...paces].sort((a, b) => a - b)
  return sorted[Math.floor(sorted.length / 2)]
}

function describeReference(ref: WriterReference): string {
  const { rank, post, transcript } = ref
  const date = post.timestamp ? new Date(post.timestamp).toISOString().slice(0, 10) : "unknown date"

  const stats = [
    post.views !== undefined ? `${post.views.toLocaleString("en-US")} views` : null,
    post.reach !== undefined ? `${post.reach.toLocaleString("en-US")} reach` : null,
    post.like_count !== undefined ? `${post.like_count} likes` : null,
    post.comments_count !== undefined ? `${post.comments_count} comments` : null,
    post.saved !== undefined ? `${post.saved} saves` : null,
  ].filter(Boolean)

  const weight =
    rank <= PRIMARY_REFERENCES
      ? "PRIMARY TEMPLATE — copy this shape"
      : "supporting — use only to confirm a habit"

  const caption = (post.caption ?? "").replace(/\s+/g, " ").trim().slice(0, CAPTION_CHARS)

  const head =
    `REFERENCE ${rank} [${weight}] · ${formatOf(post)} · ${date}` +
    `${stats.length ? ` · ${stats.join(", ")}` : " · no performance numbers returned"}`

  const body = describeTranscript(
    transcript,
    rank <= PRIMARY_REFERENCES ? PRIMARY_CHARS : SUPPORTING_CHARS,
  )

  return [head, caption ? `   CAPTION: ${caption}` : null, body].filter(Boolean).join("\n")
}

export function buildWriterPrompt(
  request: ScriptWriterRequest,
  context: ScriptWriterContext,
): string {
  const { posts, username, account, transcripts } = context
  const references = rankReferences(posts, transcripts)
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

  const topic = request.topic?.trim()
  sections.push(
    "",
    "WHAT TO WRITE",
    `Format: ${request.format || "reel"}`,
    topic
      ? `Topic: ${topic}`
      : "Topic: not specified. Choose one yourself — something their audience clearly responds to, close enough to their proven subjects to land but not a repeat of a reel already listed below. Name the topic you picked and why in the script's topic field.",
  )

  if (!references.length) {
    sections.push(
      "",
      "NO TRANSCRIPTS ARE AVAILABLE for this account, so you have never heard this creator speak. You cannot extract a real template. Say that plainly in notes, keep the structure you return honest about being inferred from captions alone, and do not describe their spoken voice.",
    )

    if (posts.length) {
      const ranked = [...posts]
        .sort((a, b) => (b.views ?? b.reach ?? 0) - (a.views ?? a.reach ?? 0))
        .slice(0, MAX_REFERENCES)
        .map((post, i) => {
          const caption = (post.caption ?? "").replace(/\s+/g, " ").trim().slice(0, CAPTION_CHARS)
          const metric = post.views ?? post.reach
          return `${i + 1}. [${formatOf(post)}${metric !== undefined ? ` · ${metric.toLocaleString("en-US")} views` : ""}] ${caption || "(no caption)"}`
        })
        .join("\n")
      sections.push("", "Their posts, best performing first — captions only:", ranked)
    }

    return sections.join("\n")
  }

  sections.push(
    "",
    `THEIR OWN REELS, WORD FOR WORD, BEST PERFORMING FIRST (${references.length} of them).`,
    "The order is by real performance on their account. Reference 1 is their best. Weight it hardest, and treat the tail as evidence about habits rather than as a model to copy.",
    "",
    references.map(describeReference).join("\n\n"),
  )

  const pace = medianPace(references)
  if (pace) {
    sections.push(
      "",
      `Measured delivery pace across these reels: ${pace.toFixed(1)} words/sec (median). ` +
        `Size the new script to its runtime at that pace — roughly ${Math.round(pace * 30)} words for 30 seconds.`,
    )
  }

  const missingNumbers = references.filter((r) => r.post.views === undefined && r.post.reach === undefined).length
  if (missingNumbers) {
    sections.push(
      "",
      `${missingNumbers} of these reels came back with no view or reach numbers, so their position in the order is not evidence of performance. Weight the ones that do carry numbers.`,
    )
  }

  sections.push(
    "",
    "Extract the template first, then write the script. Return both.",
  )

  return sections.join("\n")
}

// ------------------------------------------------------------

function toStringArray(value: any): string[] {
  if (Array.isArray(value)) return value.map((v) => String(v).trim()).filter(Boolean)
  if (typeof value === "string" && value.trim()) return [value.trim()]
  return []
}

function text(value: any): string | undefined {
  const s = value === undefined || value === null ? "" : String(value).trim()
  return s ? s : undefined
}

export function normalizeWriterResult(parsed: any): ScriptWriterResult {
  const rawStructure = parsed?.structure ?? {}

  const steps: WriterStep[] = (Array.isArray(rawStructure.steps) ? rawStructure.steps : [])
    .map((step: any) => ({
      label: String(step?.label ?? "").trim().toUpperCase(),
      t: text(step?.t ?? step?.time),
      purpose: String(step?.purpose ?? "").trim(),
      evidence: text(step?.evidence ?? step?.example),
    }))
    .filter((step: WriterStep) => step.label || step.purpose)

  const rawScript = parsed?.script ?? {}

  const beats: WriterBeat[] = (Array.isArray(rawScript.beats) ? rawScript.beats : [])
    .map((beat: any) => {
      // Beats occasionally come back as bare strings; a script that renders is
      // worth more than a strict shape.
      if (typeof beat === "string") return { text: beat.trim() }
      return {
        t: text(beat?.t ?? beat?.time),
        text: String(beat?.text ?? beat?.line ?? "").trim(),
        dir: text(beat?.dir ?? beat?.direction ?? beat?.visual),
      }
    })
    .filter((beat: WriterBeat) => beat.text.length > 0)

  // The hook is the first spoken line, so falling back to beat one is right
  // rather than leaving the headline empty when the model omits the field.
  const hook = text(rawScript.hook) ?? beats[0]?.text ?? ""

  return {
    structure: {
      summary: text(rawStructure.summary),
      pacing: text(rawStructure.pacing),
      steps,
      voice: toStringArray(rawStructure.voice ?? rawStructure.voice_rules),
    },
    script: {
      title: text(rawScript.title),
      topic: text(rawScript.topic),
      hook,
      runtime: text(rawScript.runtime),
      beats,
      caption: text(rawScript.caption),
      cta: text(rawScript.cta),
      hashtags: toStringArray(rawScript.hashtags).map((tag) => tag.replace(/^#/, "")),
    },
    modeled_on: toStringArray(parsed?.modeled_on),
    notes: toStringArray(parsed?.notes),
  }
}

export async function generateNextScript(
  settings: AiSettings,
  request: ScriptWriterRequest,
  context: ScriptWriterContext,
): Promise<{ ok: true; result: ScriptWriterResult } | { ok: false; error: string }> {
  const result = await generateReply({
    provider: settings.provider,
    apiKey: settings.api_key!,
    model: settings.model,
    systemPrompt: SYSTEM_PROMPT,
    history: [{ role: "user", content: buildWriterPrompt(request, context) }],
    maxTokens: 16000,
    // Extracting a template and then writing to it is two jobs in one call.
    effort: "high",
  })

  if (!result.ok || !result.text) {
    return { ok: false, error: result.error || "Generation failed" }
  }

  try {
    const written = normalizeWriterResult(extractJson(result.text))
    if (!written.script.beats.length) {
      return { ok: false, error: "The model returned no usable script — try again" }
    }
    return { ok: true, result: written }
  } catch (e: any) {
    console.error("[writer] Could not parse model output:", e?.message)
    return { ok: false, error: "The model's response was not valid JSON — try again" }
  }
}

/** The script as one plain block, for the copy button. */
export function writtenScriptToText(script: WrittenScript): string {
  return [
    script.title,
    script.runtime ? `RUNTIME: ${script.runtime}` : "",
    "",
    ...script.beats.map((beat, i) => {
      const label = beat.t ?? String(i + 1)
      return beat.dir ? `${label}  ${beat.text}\n      (${beat.dir})` : `${label}  ${beat.text}`
    }),
    "",
    script.caption ? `CAPTION:\n${script.caption}` : "",
    script.cta ? `\nCTA: ${script.cta}` : "",
    script.hashtags.length ? `\n${script.hashtags.map((h) => `#${h}`).join(" ")}` : "",
  ]
    .filter(Boolean)
    .join("\n")
}
