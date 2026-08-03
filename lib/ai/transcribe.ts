import { isReel, type OwnPost } from "@/lib/instagram-media"

// ============================================================
// Reel transcription.
//
// Instagram exposes no transcript or caption track for a reel, so the only way
// to know what the creator actually SAYS is to pull the mp4 from `media_url`
// and run speech-to-text over it. Results are cached in `media_transcripts`
// keyed by media id — a reel is paid for exactly once.
//
// Claude and DeepSeek have no audio endpoint, so transcription always uses a
// separate credential: either Groq or OpenAI, detected from the key itself.
// ============================================================

/** Whisper rejects anything over 25 MB. Stay under it. */
const MAX_BYTES = 24 * 1024 * 1024

/**
 * Groq serves Whisper behind an OpenAI-compatible audio endpoint, so both
 * providers use the identical multipart request — only the base URL and the
 * model name differ. Groq keys are prefixed `gsk_`, which is enough to route
 * the request without asking the user to pick a provider.
 */
const AUDIO_PROVIDERS = {
  openai: {
    label: "OpenAI",
    url: "https://api.openai.com/v1/audio/transcriptions",
    model: "whisper-1",
  },
  groq: {
    label: "Groq",
    url: "https://api.groq.com/openai/v1/audio/transcriptions",
    // Turbo is the cheapest and fastest Whisper on Groq and is more than
    // accurate enough for judging hooks and pacing.
    model: "whisper-large-v3-turbo",
  },
} as const

export type AudioProvider = keyof typeof AUDIO_PROVIDERS

export function audioProviderFor(apiKey: string): AudioProvider {
  return apiKey.trim().startsWith("gsk_") ? "groq" : "openai"
}

/**
 * Providers retire Whisper model ids from time to time. TRANSCRIPTION_MODEL
 * overrides the default so a rename can be fixed from .env rather than here.
 */
function modelFor(provider: AudioProvider): string {
  return process.env.TRANSCRIPTION_MODEL?.trim() || AUDIO_PROVIDERS[provider].model
}

/** How many reels a single generate is allowed to pay for. */
export const DEFAULT_TRANSCRIBE_LIMIT = 8

/** Downloading and transcribing 8 videos at once would blow the request budget. */
const CONCURRENCY = 3

export interface Transcript {
  media_id: string
  /**
   * Either `[12.5] line` per segment, or — for rows cached before timestamps
   * were kept — one flat paragraph. Read it through `spokenText`/
   * `describeTranscript` rather than parsing it at the call site.
   */
  text: string
  duration_seconds?: number
}

/**
 * Whisper's verbose_json segments, flattened to `[seconds] text` lines.
 *
 * A reel lives or dies on its first three seconds, so the model has to see
 * WHERE a line lands, not merely that it was said. The timestamps are stored
 * inline in the same `transcript` column instead of a parallel structure:
 * transcripts cached before this existed stay valid and simply carry no
 * prefixes, so nothing has to be re-transcribed.
 *
 * `[0.0] ` costs ~7 characters per line, against ~45 for an SRT cue — the
 * prompt budget is what rules SRT out here, not the parsing.
 */
function toTimedText(segments: unknown, fallback: string): string {
  if (!Array.isArray(segments)) return fallback

  const lines: string[] = []
  for (const segment of segments) {
    const text = String(segment?.text ?? "").trim()
    if (!text) continue
    const start = Number(segment?.start)
    lines.push(Number.isFinite(start) ? `[${start.toFixed(1)}] ${text}` : text)
  }

  return lines.length ? lines.join("\n") : fallback
}

/** True when a transcript carries `[12.5]` marks rather than being one paragraph. */
export function isTimed(text: string): boolean {
  return /^\[\d+(\.\d+)?\]\s/m.test(text)
}

/** The spoken words alone. Timestamps must never be counted as speech. */
export function spokenText(text: string): string {
  return text.replace(/^\[\d+(\.\d+)?\]\s*/gm, "")
}

/**
 * The TRANSCRIPT block as both prompts render it, so Deep Analysis and Content
 * Studio always describe a reel identically.
 */
export function describeTranscript(
  transcript: Transcript,
  maxChars: number,
  indent = "   ",
): string {
  const spoken = spokenText(transcript.text)
  const words = spoken.split(/\s+/).filter(Boolean).length
  const pace =
    transcript.duration_seconds && transcript.duration_seconds > 0
      ? `${Math.round(transcript.duration_seconds)}s, ${(words / transcript.duration_seconds).toFixed(1)} words/sec`
      : `${words} words`

  let body = transcript.text
  let ellipsis = ""
  if (body.length > maxChars) {
    const cut = body.slice(0, maxChars)
    // Cut on a line boundary — a transcript that ends mid-segment leaves a
    // dangling timestamp the model would read as a real spoken moment.
    const lastBreak = cut.lastIndexOf("\n")
    body = lastBreak > maxChars / 2 ? cut.slice(0, lastBreak) : cut
    ellipsis = " […]"
  }

  if (!isTimed(transcript.text)) {
    return `${indent}TRANSCRIPT (${pace}): "${body}${ellipsis}"`
  }

  const timed = body
    .split("\n")
    .map((line) => `${indent}${line}`)
    .join("\n")

  return (
    `${indent}TRANSCRIPT (${pace}) — each [seconds] mark is when that line is spoken, ` +
    `so judge the hook by how late the first real line lands and the pacing by the gaps:\n` +
    `${timed}${ellipsis}`
  )
}

export interface TranscribeSummary {
  /** Transcripts available to the planner, cache hits included. */
  transcripts: Map<string, Transcript>
  /** Reels that are candidates for transcription at all. */
  reelsTotal: number
  /** How many were transcribed on this run (i.e. actually cost money). */
  transcribedNow: number
  /** Reels still without a transcript. */
  missing: number
  notes: string[]
}

type Attempt =
  | { ok: true; text: string; duration?: number; model: string }
  // `permanent` distinguishes "this video will never transcribe" (too big, no
  // audio, rejected) from a timeout worth retrying on the next generate.
  | { ok: false; error: string; permanent: boolean; auth?: boolean }

/**
 * Which key to use for audio. When the account's main provider is already
 * OpenAI there is nothing extra to configure.
 */
export function transcriptionKeyFor(settings: {
  provider: string
  api_key?: string | null
  transcription_api_key?: string | null
  transcription_enabled?: boolean
}): string | null {
  if (settings.transcription_enabled === false) return null
  const dedicated = settings.transcription_api_key?.trim()
  if (dedicated) return dedicated
  if (settings.provider === "openai" && settings.api_key?.trim()) return settings.api_key.trim()
  return null
}

async function downloadMedia(url: string): Promise<{ blob: Blob } | { error: string; permanent: boolean }> {
  let res: Response
  try {
    res = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(45_000) })
  } catch (e: any) {
    return { error: `download failed: ${e?.message || e}`, permanent: false }
  }

  if (!res.ok) {
    // Instagram CDN URLs are signed and expire; a 403 here means the snapshot
    // we hold is stale, which a fresh media fetch will fix.
    return { error: `download failed: HTTP ${res.status}`, permanent: res.status === 404 }
  }

  const declared = Number(res.headers.get("content-length") || 0)
  if (declared > MAX_BYTES) {
    return { error: `video is ${(declared / 1024 / 1024).toFixed(0)} MB — too large to transcribe`, permanent: true }
  }

  const buffer = await res.arrayBuffer()
  if (buffer.byteLength > MAX_BYTES) {
    return {
      error: `video is ${(buffer.byteLength / 1024 / 1024).toFixed(0)} MB — too large to transcribe`,
      permanent: true,
    }
  }

  return { blob: new Blob([buffer], { type: res.headers.get("content-type") || "video/mp4" }) }
}

async function transcribeOne(apiKey: string, url: string): Promise<Attempt> {
  const downloaded = await downloadMedia(url)
  if ("error" in downloaded) return { ok: false, error: downloaded.error, permanent: downloaded.permanent }

  const provider = AUDIO_PROVIDERS[audioProviderFor(apiKey)]
  const model = modelFor(audioProviderFor(apiKey))

  const form = new FormData()
  form.append("file", downloaded.blob, "reel.mp4")
  form.append("model", model)
  // verbose_json is the only response format that returns the audio duration,
  // which the planner uses to reason about pacing and target reel length.
  form.append("response_format", "verbose_json")

  let res: Response
  try {
    res = await fetch(provider.url, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}` },
      body: form,
      signal: AbortSignal.timeout(120_000),
    })
  } catch (e: any) {
    return { ok: false, error: `transcription request failed: ${e?.message || e}`, permanent: false }
  }

  const json = await res.json().catch(() => null)

  if (!res.ok || json?.error) {
    const detail = json?.error?.message || `HTTP ${res.status}`

    // A rejected key says nothing about this reel — caching it as a permanent
    // failure would blacklist the video forever, so a later working key could
    // never transcribe it. Same for rate limits, which clear on their own.
    const auth = res.status === 401 || res.status === 403
    const permanent = res.status >= 400 && res.status < 500 && !auth && res.status !== 429

    return { ok: false, error: `${provider.label}: ${detail}`, permanent, auth }
  }

  const text = String(json?.text ?? "").trim()
  if (!text) return { ok: false, error: "no speech detected", permanent: true }

  return {
    ok: true,
    // Segments come back for free with verbose_json; keeping them as `[12.5]`
    // prefixes is what lets the model critique hooks and pacing at all.
    text: toTimedText(json?.segments, text),
    duration: typeof json?.duration === "number" ? json.duration : undefined,
    model,
  }
}

/** Matches the phrasing OpenAI and Groq use when they reject a credential. */
function looksLikeAuthFailure(error: string): boolean {
  return /api key|unauthorized|authentication|invalid_api_key|401|403/i.test(error)
}

async function loadCached(
  supabase: any,
  userId: number | string,
  mediaIds: string[],
): Promise<{ transcripts: Map<string, Transcript>; failed: Set<string> }> {
  const transcripts = new Map<string, Transcript>()
  const failed = new Set<string>()
  if (!mediaIds.length) return { transcripts, failed }

  const { data, error } = await supabase
    .from("media_transcripts")
    .select("media_id, transcript, duration_seconds, error")
    .eq("user_id", userId)
    .in("media_id", mediaIds)

  if (error) {
    console.warn("[transcribe] cache read failed:", error.message)
    return { transcripts, failed }
  }

  for (const row of data ?? []) {
    if (row.error) {
      // Rows recorded before auth errors were classified correctly, or written
      // against a key that has since been replaced, must not stay blacklisted.
      if (!looksLikeAuthFailure(row.error)) failed.add(String(row.media_id))
      continue
    }
    if (!row.transcript) continue
    transcripts.set(String(row.media_id), {
      media_id: String(row.media_id),
      text: String(row.transcript),
      duration_seconds: row.duration_seconds ?? undefined,
    })
  }

  return { transcripts, failed }
}

async function saveTranscript(
  supabase: any,
  userId: number | string,
  mediaId: string,
  result: { transcript?: string; duration?: number; error?: string; model?: string },
) {
  const { error } = await supabase.from("media_transcripts").upsert(
    {
      user_id: Number(userId),
      media_id: mediaId,
      transcript: result.transcript ?? "",
      duration_seconds: result.duration ?? null,
      model: result.model ?? null,
      error: result.error ?? null,
    },
    { onConflict: "user_id,media_id" },
  )
  if (error) console.warn(`[transcribe] could not cache ${mediaId}:`, error.message)
}

/**
 * Fill in transcripts for the account's best-performing reels, newest cache
 * first. Never throws: a failure here degrades the plan, it does not break it.
 */
export async function collectTranscripts(
  supabase: any,
  userId: number | string,
  apiKey: string | null,
  posts: OwnPost[],
  limit = DEFAULT_TRANSCRIBE_LIMIT,
): Promise<TranscribeSummary> {
  const notes: string[] = []

  // Highest reach first — if we can only afford a handful, transcribe the ones
  // whose performance the planner most needs to explain.
  const reels = posts
    .filter((p) => isReel(p) && p.id && p.media_url)
    .sort((a, b) => (b.views ?? b.reach ?? 0) - (a.views ?? a.reach ?? 0))

  const empty: TranscribeSummary = {
    transcripts: new Map(),
    reelsTotal: reels.length,
    transcribedNow: 0,
    missing: reels.length,
    notes,
  }

  if (!reels.length) {
    notes.push("No reels with a readable video URL — nothing to transcribe.")
    return empty
  }

  const { transcripts, failed } = await loadCached(
    supabase,
    userId,
    reels.map((r) => r.id!),
  )

  const pending = reels.filter((r) => !transcripts.has(r.id!) && !failed.has(r.id!))

  if (!apiKey) {
    if (pending.length) {
      notes.push(
        `${pending.length} reel${pending.length === 1 ? "" : "s"} not transcribed — add an OpenAI or Groq ` +
          "transcription key in Automations → AI Agent to let the planner hear what you actually say.",
      )
    }
    return { transcripts, reelsTotal: reels.length, transcribedNow: 0, missing: reels.length - transcripts.size, notes }
  }

  const queue = pending.slice(0, Math.max(0, limit))
  let transcribedNow = 0

  for (let i = 0; i < queue.length; i += CONCURRENCY) {
    const batch = queue.slice(i, i + CONCURRENCY)
    const attempts = await Promise.all(
      batch.map(async (post) => ({ post, attempt: await transcribeOne(apiKey, post.media_url!) })),
    )

    let keyRejected: string | null = null

    for (const { post, attempt } of attempts) {
      if (attempt.ok) {
        transcripts.set(post.id!, { media_id: post.id!, text: attempt.text, duration_seconds: attempt.duration })
        transcribedNow++
        await saveTranscript(supabase, userId, post.id!, {
          transcript: attempt.text,
          duration: attempt.duration,
          model: attempt.model,
        })
      } else {
        console.warn(`[transcribe] ${post.id} failed: ${attempt.error}`)
        if (attempt.auth) keyRejected = attempt.error
        if (attempt.permanent) await saveTranscript(supabase, userId, post.id!, { error: attempt.error })
        if (!attempt.auth && !notes.some((n) => n.includes("could not be transcribed"))) {
          notes.push(`Some reels could not be transcribed (${attempt.error}).`)
        }
      }
    }

    // A rejected key fails every remaining reel identically — stop rather than
    // spending another 30 seconds proving it seven more times.
    if (keyRejected) {
      notes.push(
        `Transcription key was rejected (${keyRejected}). Check the key under Automations → AI Agent — ` +
          "Groq keys start with gsk_, OpenAI keys with sk-. Nothing was cached, so a valid key will retranscribe.",
      )
      break
    }
  }

  const missing = reels.length - transcripts.size
  if (missing > 0 && pending.length > queue.length) {
    notes.push(`${missing} older reel${missing === 1 ? "" : "s"} not transcribed yet — regenerate to cover more.`)
  }

  return { transcripts, reelsTotal: reels.length, transcribedNow, missing, notes }
}
