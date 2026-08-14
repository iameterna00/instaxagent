import { type NextRequest, NextResponse } from "next/server"
import { getSupabaseServerClient } from "@/lib/supabase-server"
import { loadAiSettings } from "@/lib/ai/agent"
import { generateNextScript } from "@/lib/ai/writer"
import {
  collectTranscripts,
  spokenText,
  transcriptionKeyFor,
  DEFAULT_TRANSCRIBE_LIMIT,
  type Transcript,
} from "@/lib/ai/transcribe"
import { fetchAccountSnapshot } from "@/lib/instagram-account"
import { attachInsights, fetchOwnPosts, isReel, type OwnPost } from "@/lib/instagram-media"

export const maxDuration = 300 // extracting a template and writing to it is slow

// The Script Writer's library: every reel of theirs that has been transcribed,
// ordered best performing first. That order is not cosmetic — it is what the
// prompt weights by, so the list the owner reads is literally the list the
// model reasons from.

interface LibraryItem {
  /** 1 = best performing. */
  rank: number
  media_id: string
  title: string
  permalink?: string
  thumbnail_url?: string
  timestamp?: string
  views?: number
  reach?: number
  like_count?: number
  comments_count?: number
  transcript: string
  duration_seconds?: number
  words: number
  /** Words per second as actually spoken, when a duration was recorded. */
  pace?: number
  /** Why this reel has no transcript, when transcription was tried and failed. */
  error?: string
  transcribed: boolean
}

function firstCaptionLine(post: OwnPost): string {
  return (post.caption ?? "").split("\n").find((line) => line.trim())?.trim() || "(no caption)"
}

/** Cached rows only — reading the library never spends transcription money. */
async function loadCachedRows(supabase: any, userId: string) {
  const { data, error } = await supabase
    .from("media_transcripts")
    .select("media_id, transcript, duration_seconds, error")
    .eq("user_id", userId)

  if (error) throw error

  const byId = new Map<string, { transcript: string; duration_seconds?: number; error?: string }>()
  for (const row of data ?? []) {
    byId.set(String(row.media_id), {
      transcript: String(row.transcript ?? ""),
      duration_seconds: row.duration_seconds ?? undefined,
      error: row.error ?? undefined,
    })
  }
  return byId
}

/**
 * The reels, ranked by what they actually did. Reels with no insights sort to
 * the bottom rather than being dropped — the UI labels them so the ranking is
 * never read as more certain than it is.
 */
function buildLibrary(posts: OwnPost[], cached: Map<string, { transcript: string; duration_seconds?: number; error?: string }>): LibraryItem[] {
  return posts
    .filter((post) => post.id && isReel(post))
    .sort((a, b) => (b.views ?? b.reach ?? 0) - (a.views ?? a.reach ?? 0))
    .map((post, i): LibraryItem => {
      const row = cached.get(post.id!)
      const transcript = row?.transcript ?? ""
      const words = transcript ? spokenText(transcript).split(/\s+/).filter(Boolean).length : 0
      const duration = row?.duration_seconds
      return {
        rank: i + 1,
        media_id: post.id!,
        title: firstCaptionLine(post),
        permalink: post.permalink,
        thumbnail_url: post.thumbnail_url || post.media_url,
        timestamp: post.timestamp,
        views: post.views,
        reach: post.reach,
        like_count: post.like_count,
        comments_count: post.comments_count,
        transcript,
        duration_seconds: duration,
        words,
        pace: duration && duration > 0 && words ? Number((words / duration).toFixed(1)) : undefined,
        error: row?.error,
        transcribed: Boolean(transcript),
      }
    })
}

/**
 * Rows whose media no longer comes back from Instagram — deleted or archived
 * reels. Their transcripts are still the creator's own writing, so they stay in
 * the library at the bottom rather than vanishing.
 */
function orphanedTranscripts(
  cached: Map<string, { transcript: string; duration_seconds?: number; error?: string }>,
  seen: Set<string>,
  startRank: number,
): LibraryItem[] {
  const orphans: LibraryItem[] = []
  for (const [mediaId, row] of cached) {
    if (seen.has(mediaId) || !row.transcript) continue
    const words = spokenText(row.transcript).split(/\s+/).filter(Boolean).length
    orphans.push({
      rank: startRank + orphans.length,
      media_id: mediaId,
      title: "(no longer returned by Instagram)",
      transcript: row.transcript,
      duration_seconds: row.duration_seconds,
      words,
      pace:
        row.duration_seconds && row.duration_seconds > 0
          ? Number((words / row.duration_seconds).toFixed(1))
          : undefined,
      transcribed: true,
    })
  }
  return orphans
}

/** The library plus the saved scripts — everything the tab renders on arrival. */
export async function GET(request: NextRequest) {
  try {
    const userId = request.nextUrl.searchParams.get("userId")
    if (!userId) return NextResponse.json({ error: "Missing userId" }, { status: 400 })

    const supabase = await getSupabaseServerClient()

    // The History tab only wants the saved scripts. Building the library costs
    // a media fetch plus 25 insights calls, so it is skipped for that.
    if (request.nextUrl.searchParams.get("only") === "scripts") {
      const { data, error } = await supabase
        .from("generated_scripts")
        .select("*")
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
        .limit(20)

      if (error) throw error
      return NextResponse.json({ scripts: data ?? [] })
    }

    const [{ data: user }, settings, cached] = await Promise.all([
      supabase.from("users").select("username, access_token").eq("id", userId).single(),
      loadAiSettings(supabase, userId).catch(() => null),
      loadCachedRows(supabase, userId),
    ])

    const posts = user?.access_token ? await fetchOwnPosts(user.access_token) : []
    if (user?.access_token && posts.length) {
      await attachInsights(user.access_token, posts)
    }

    const library = buildLibrary(posts, cached)
    const seen = new Set(library.map((item) => item.media_id))
    const full = [...library, ...orphanedTranscripts(cached, seen, library.length + 1)]

    const { data: scripts, error } = await supabase
      .from("generated_scripts")
      .select("*")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(20)

    if (error) throw error

    return NextResponse.json({
      library: full,
      scripts: scripts ?? [],
      // Counted over the live reels only. Orphaned rows carry transcripts too,
      // but including them here made the coverage read as complete and hid the
      // Transcribe button while real reels were still missing.
      transcribed: library.filter((item) => item.transcribed).length,
      failed: library.filter((item) => !item.transcribed && item.error).length,
      reelsTotal: library.length,
      canTranscribe: Boolean(settings && transcriptionKeyFor(settings)),
      connected: Boolean(user?.access_token),
    })
  } catch (error: any) {
    console.error("[writer] GET error:", error)
    return NextResponse.json({ error: describeFailure(error) }, { status: 500 })
  }
}

/**
 * `mode: "transcribe"` fills the library and stops — it costs transcription
 * money but no AI tokens. Anything else writes the next script.
 */
export async function POST(request: NextRequest) {
  try {
    const { userId, topic, format, mode, mediaIds } = await request.json()
    if (!userId) return NextResponse.json({ error: "Missing userId" }, { status: 400 })

    const supabase = await getSupabaseServerClient()

    const settings = await loadAiSettings(supabase, userId)
    if (!settings?.api_key) {
      return NextResponse.json(
        { error: "Add an API key in Automations → AI Agent first — the script writer uses the same key." },
        { status: 400 },
      )
    }

    const { data: user } = await supabase
      .from("users")
      .select("username, access_token")
      .eq("id", userId)
      .single()

    if (!user) return NextResponse.json({ error: "User not found" }, { status: 404 })

    const [posts, account] = await Promise.all([
      user.access_token ? fetchOwnPosts(user.access_token) : Promise.resolve([]),
      user.access_token ? fetchAccountSnapshot(user.access_token) : Promise.resolve(null),
    ])

    if (user.access_token && posts.length) {
      await attachInsights(user.access_token, posts)
    }

    if (mode === "transcribe") {
      const key = transcriptionKeyFor(settings)
      if (!key) {
        return NextResponse.json(
          {
            error:
              "No transcription key — add a Groq (gsk_…) or OpenAI (sk-…) key under Automations → AI Agent. " +
              "Without it the writer has never heard you speak.",
          },
          { status: 400 },
        )
      }

      // One or more specific reels, straight from the row the owner clicked.
      const only = Array.isArray(mediaIds)
        ? mediaIds.map((id: unknown) => String(id)).filter(Boolean)
        : undefined

      let summary = await collectTranscripts(supabase, userId, key, posts, {
        limit: only?.length ? only.length : DEFAULT_TRANSCRIBE_LIMIT,
        only,
      })

      // A click has to do work. If everything still missing is a reel an
      // earlier run failed on, retry those rather than reporting "nothing to
      // transcribe" at someone looking at a list of untranscribed reels.
      if (!only?.length && summary.transcribedNow === 0 && summary.pending === 0 && summary.failed > 0) {
        summary = await collectTranscripts(supabase, userId, key, posts, {
          limit: DEFAULT_TRANSCRIBE_LIMIT,
          retryFailed: true,
        })
      }

      return NextResponse.json({
        transcribedNow: summary.transcribedNow,
        missing: summary.missing,
        failed: summary.failed,
        reelsTotal: summary.reelsTotal,
        notes: summary.notes,
      })
    }

    // Transcripts are the entire point here, but a missing key or a failed
    // download must not swallow the request — the prompt says so out loud when
    // it has nothing to model.
    const transcription = await collectTranscripts(
      supabase,
      userId,
      transcriptionKeyFor(settings),
      posts,
    ).catch((e) => {
      console.warn("[writer] transcription step failed:", e?.message || e)
      return null
    })

    const transcripts: Map<string, Transcript> | undefined = transcription?.transcripts

    const generated = await generateNextScript(
      settings,
      {
        topic: topic ? String(topic) : undefined,
        format: format ? String(format) : undefined,
      },
      {
        posts,
        username: user.username || "creator",
        account,
        transcripts,
      },
    )

    if (!generated.ok) return NextResponse.json({ error: generated.error }, { status: 502 })

    const { result } = generated
    const { data, error } = await supabase
      .from("generated_scripts")
      .insert({
        user_id: userId,
        topic: topic ? String(topic) : null,
        format: format ? String(format) : "reel",
        provider: settings.provider,
        model: settings.model,
        structure: result.structure,
        script: result.script,
        modeled_on: result.modeled_on,
        notes: [...result.notes, ...(transcription?.notes ?? [])],
        transcripts_used: transcripts?.size ?? 0,
        posts_analyzed: posts.length,
      })
      .select()
      .single()

    if (error) throw error
    return NextResponse.json(data)
  } catch (error: any) {
    console.error("[writer] POST error:", error)
    return NextResponse.json({ error: describeFailure(error) }, { status: 500 })
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const id = request.nextUrl.searchParams.get("id")
    if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 })

    const supabase = await getSupabaseServerClient()
    const { error } = await supabase.from("generated_scripts").delete().eq("id", id)
    if (error) throw error
    return NextResponse.json({ success: true })
  } catch (error: any) {
    console.error("[writer] DELETE error:", error)
    return NextResponse.json({ error: describeFailure(error) }, { status: 500 })
  }
}

function describeFailure(error: any): string {
  const message: string = error?.message || String(error)
  if (message.includes("Supabase is not configured")) return message

  const schemaIssue =
    error?.code === "42P01" ||
    error?.code === "PGRST205" ||
    error?.code === "42703" ||
    error?.code === "PGRST204" ||
    /does not exist|schema cache/i.test(message)

  if (schemaIssue && /generated_scripts/.test(message)) {
    return "The generated_scripts table is missing — run scripts/14-script-writer.sql in your Supabase SQL editor."
  }
  if (schemaIssue && /media_transcripts/.test(message)) {
    return "The media_transcripts table is missing — run scripts/11-transcripts-and-audience.sql in your Supabase SQL editor."
  }
  if (schemaIssue) {
    return "A required table is missing — run scripts/14-script-writer.sql in your Supabase SQL editor."
  }
  return message
}
