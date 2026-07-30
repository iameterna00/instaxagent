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

/**
 * The six hook archetypes, after Kane Kallaway's framework. Every hook that
 * reliably stops a scroll is one of these positions — naming the position is
 * what turns "write a good hook" into a repeatable instruction, and it is why
 * ideas come back labelled rather than improvised.
 */
export const HOOK_ARCHETYPES = [
  {
    id: "fortuneteller",
    label: "The Fortuneteller",
    summary: "Curiosity & future-oriented",
    goal: "Paint an optimistic future, or ask how the future changes because of some new thing.",
    template: "This [new thing] is going to completely change the way [people] do [task]. Here's why…",
    positioning: "Builds trust as the person who knows what is next in the space.",
    when: "Something new just dropped, or the industry shifted.",
  },
  {
    id: "experimenter",
    label: "The Experimenter",
    summary: "Experiment & hack-based",
    goal: "Show how you solved a common viewer pain point by running a method or experiment yourself.",
    template: "I did [thing] to get [result] in [area] — let me show you how.",
    positioning: "Peer-to-peer: a fellow student, not a guru.",
    when: "You are among the first to test something new.",
  },
  {
    id: "teacher",
    label: "The Teacher",
    summary: "Educational & process-driven",
    goal: "Break down how a result was achieved, via a case study of someone else's playbook.",
    template: "[Person] achieved [result] using [unusual method] — let me show you.",
    positioning: "Expert authority in the field.",
    when: "You are dissecting someone else's success rather than your own.",
  },
  {
    id: "magician",
    label: "The Magician",
    summary: "Direct command & visual",
    goal: "Instant scroll-stop by pointing at something visually compelling on screen.",
    template: "Look at [thing] right there — that is [explanation].",
    positioning: "Works for anyone, whenever the visual is genuinely arresting.",
    when: "You already have the banger visual, and it matches what you say over it.",
  },
  {
    id: "investigator",
    label: "The Investigator",
    summary: "Insider & secret reveal",
    goal: "Reveal a hidden truth or finding most people do not know.",
    template: "I found a secret feature in [thing] that changes how you do [task].",
    positioning: "The tapped-in insider for the category.",
    when: "You genuinely have a finding that is not common knowledge.",
  },
  {
    id: "contrarian",
    label: "The Contrarian",
    summary: "Combination & intrigue",
    goal: "State a contrarian belief explicitly in the very first line.",
    template: "Everyone thinks [X] won because of [Y], but that has nothing to do with it.",
    positioning: "Known for strong opinions and a unique point of view.",
    when: "You hold a take that genuinely challenges conventional wisdom.",
  },
] as const

export type HookArchetypeId = (typeof HOOK_ARCHETYPES)[number]["id"]

const ARCHETYPE_IDS = HOOK_ARCHETYPES.map((a) => a.id) as readonly string[]

export function archetypeLabel(id?: string): string | undefined {
  return HOOK_ARCHETYPES.find((a) => a.id === id)?.label
}

export interface ContentIdea {
  title: string
  format: string
  hook: string
  /** Which of the six archetypes this hook is built on. */
  hook_archetype?: HookArchetypeId
  /** Which content pillar this idea belongs to — the guard against a one-note set. */
  pillar?: string
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
  /** The distinct subject areas the ideas are spread across. */
  pillars?: string[]
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

HOOKS ARE THE WHOLE GAME. Nothing in the body of a video matters if the viewer leaves in the first five seconds, so every hook you write must be built deliberately on one of these six archetypes:

${HOOK_ARCHETYPES.map(
  (a, i) =>
    `${i + 1}. ${a.label} — ${a.summary}\n` +
    `   Goal: ${a.goal}\n` +
    `   Shape: "${a.template}"\n` +
    `   Positions the creator as: ${a.positioning}\n` +
    `   Use when: ${a.when}\n` +
    `   id: "${a.id}"`,
).join("\n\n")}

How to use them:
- Pick the archetype that fits the specific idea and the creator's authority, then write the hook to that archetype's shape. Do not pick one at random and do not default to the same one every time.
- Report your choice in the "hook_archetype" field using the exact id above. If a hook does not genuinely fit an archetype, rewrite the hook until it does.
- Vary them across the set. Producing several ideas that all use the same archetype is a failure — the point of the set is a range of angles.
- Match archetype to evidence. "The Experimenter" needs something they actually tested; "The Investigator" needs a genuine finding; "The Contrarian" needs a real opinion they hold. Never assign an archetype whose premise you had to invent.
- Stacking is allowed and often strongest: open with The Magician ("look at this") for the scroll-stop, then pivot into another archetype for the substance. If you stack, report the archetype that carries the idea.

SPREAD THE SET ACROSS DIFFERENT SUBJECTS. The most common failure is a set where every idea is really the same video: an account about AI chatbots gets ten ideas that are all "here is a thing an AI chatbot can do". That set is worthless — it reaches the same people repeatedly and teaches the audience nothing new. Avoid it as follows:

- First derive 3 to 5 CONTENT PILLARS for this account: genuinely distinct subject areas that the SAME audience cares about. List them in "analysis.pillars".
- Build pillars around the audience, not the product. Start from what the target viewer's day, job and frustrations look like, then ask which subjects they would stop scrolling for. The creator's own product or offer may occupy AT MOST ONE pillar.
- Good pillars are far apart from each other. For an AI chatbot account aimed at small businesses, pillars like "the chatbot's features / what to say to a customer who is about to churn / what a solo owner should stop doing by hand / how competitors are quietly winning on speed" are distinct. Four flavours of "chatbot features" are not.
- Assign every idea to exactly one pillar and report it in the idea's "pillar" field, worded identically to the entry in "analysis.pillars".
- Distribute ideas across the pillars as evenly as the count allows. Never put more than half the ideas in one pillar. If you are asked for 3 or more ideas, at least 3 different pillars must appear.
- No two ideas may share the same core subject. The same subject with a different hook is ONE idea, not two.
- Vary who each idea is for: some for viewers who do not yet know they have the problem, some for viewers comparing solutions, some for viewers ready to act. Ideas aimed only at people already sold reach nobody new.
- Before you answer, re-read your set. If any two ideas could be summarised by the same sentence, delete one and replace it from a pillar you have not used yet. Do this check properly — it is the difference between a usable week of content and ten versions of one video.

Rules for the ideas you produce:
- Every idea must be specific to THIS account and goal. No generic advice like "post more reels" or "engage with your audience".
- Hooks must be the literal first line as spoken or shown on screen, not a description of a hook. Keep them short enough to land inside three seconds — roughly 12 words.
- Scripts are beat-by-beat and shootable: what is on screen, what is said. Aim for 5-9 beats for a reel.
- Beat 1 IS the hook, word for word. Then earn the hook: give the context, then the contrast or turn that the hook promised, then the payoff. Do not let a strong hook open a video that never delivers on it.
- Captions are written in the creator's voice, ready to paste.
- Never invent statistics, results, or claims about the creator that you were not told.

Respond with ONLY a JSON object matching this shape, and nothing else — no prose, no markdown fences:
{
  "analysis": {
    "niche": "one line naming the niche as you actually see it",
    "scale": "where this account sits by size, what its reach-vs-followers numbers say, and which tactics that stage rules in or out",
    "growth_math": "the arithmetic from today's numbers to the stated goal, with the weekly rate it requires and an honest verdict on whether the current output gets there",
    "voice": "how they actually talk, drawn from the transcripts — omit this field entirely if no transcripts were provided",
    "pillars": ["3-5 distinct subject areas the ideas are spread across"],
    "what_is_working": ["specific observation about their existing posts"],
    "gaps": ["specific thing missing that blocks the stated goal"],
    "positioning": "one paragraph on the angle they should own"
  },
  "ideas": [
    {
      "title": "short internal name",
      "format": "reel | carousel | story | post",
      "hook": "the literal first line on screen or spoken",
      "hook_archetype": "${ARCHETYPE_IDS.join(" | ")}",
      "pillar": "which pillar from analysis.pillars this belongs to, worded identically",
      "why_it_works": "one line naming the archetype's mechanism and tying it to the goal",
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

/**
 * Models answer with the label ("The Contrarian") as often as the id, so match
 * on both rather than dropping a correct choice on a formatting technicality.
 */
function normalizeArchetype(value: any): HookArchetypeId | undefined {
  if (!value) return undefined
  const needle = String(value).toLowerCase().replace(/^the\s+/, "").trim()
  const hit = HOOK_ARCHETYPES.find(
    (a) => a.id === needle || a.label.toLowerCase().replace(/^the\s+/, "") === needle,
  )
  return hit?.id
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
      hook_archetype: normalizeArchetype(idea?.hook_archetype),
      pillar: idea?.pillar ? String(idea.pillar).trim() : undefined,
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
      // Fall back to the pillars the ideas actually claim, so the UI can still
      // show the spread when the model omits the analysis-level list.
      pillars: toStringArray(analysis.pillars).length
        ? toStringArray(analysis.pillars)
        : distinctPillars(ideas),
    },
    ideas,
  }
}

function distinctPillars(ideas: ContentIdea[]): string[] {
  const seen = new Map<string, string>()
  for (const idea of ideas) {
    const pillar = idea.pillar?.trim()
    if (pillar && !seen.has(pillar.toLowerCase())) seen.set(pillar.toLowerCase(), pillar)
  }
  return [...seen.values()]
}

/**
 * How concentrated the set is. The whole point of pillars is spread, so when a
 * plan comes back one-note anyway the UI should say so rather than quietly
 * present ten versions of the same video as a week of content.
 */
export function pillarSpread(ideas: ContentIdea[]): { pillars: number; largestShare: number } {
  const counts = new Map<string, number>()
  for (const idea of ideas) {
    const key = (idea.pillar?.trim() || "unassigned").toLowerCase()
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  const largest = Math.max(0, ...counts.values())
  return {
    pillars: counts.size,
    largestShare: ideas.length ? largest / ideas.length : 0,
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
