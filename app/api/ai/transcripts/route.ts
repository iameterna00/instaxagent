import { type NextRequest, NextResponse } from "next/server"
import { getSupabaseServerClient } from "@/lib/supabase-server"

// Read side of the transcript cache. Transcription itself happens inside the
// analysis and content runs (lib/ai/transcribe.ts); this route only hands the
// already-paid-for rows back to the UI so a reel's spoken words can be read
// next to the numbers they produced.

/** URLs have a practical length limit — ask for transcripts in chunks. */
const MAX_IDS = 60

export async function GET(request: NextRequest) {
  try {
    const userId = request.nextUrl.searchParams.get("userId")
    if (!userId) return NextResponse.json({ error: "Missing userId" }, { status: 400 })

    const requested = (request.nextUrl.searchParams.get("mediaIds") ?? "")
      .split(",")
      .map((id) => id.trim())
      .filter(Boolean)
      .slice(0, MAX_IDS)

    const supabase = await getSupabaseServerClient()

    let query = supabase
      .from("media_transcripts")
      .select("media_id, transcript, duration_seconds, model, error, created_at")
      .eq("user_id", userId)

    // No ids means "everything cached for this account" — the analysis page
    // asks for the posts it is showing, so it always passes them.
    if (requested.length) query = query.in("media_id", requested)

    const { data, error } = await query
    if (error) throw error

    return NextResponse.json({
      transcripts: (data ?? []).map((row: any) => ({
        media_id: String(row.media_id),
        transcript: row.transcript ?? "",
        duration_seconds: row.duration_seconds ?? null,
        model: row.model ?? null,
        error: row.error ?? null,
        created_at: row.created_at ?? null,
      })),
    })
  } catch (error: any) {
    console.error("[transcripts] GET error:", error)
    return NextResponse.json({ error: describeFailure(error) }, { status: 500 })
  }
}

function describeFailure(error: any): string {
  const message: string = error?.message || String(error)
  if (message.includes("Supabase is not configured")) return message
  if (
    error?.code === "42P01" ||
    error?.code === "PGRST205" ||
    /media_transcripts/.test(message) ||
    /does not exist|schema cache/i.test(message)
  ) {
    return "The media_transcripts table is missing — run scripts/11-transcripts-and-audience.sql in your Supabase SQL editor."
  }
  return message
}
