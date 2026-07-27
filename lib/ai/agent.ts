import { fetchMessagingProfile } from "@/lib/instagram-api"
import type { AiSettings, AudienceMode } from "@/lib/types"
import { defaultModelFor, generateReply, isKnownProvider, type ChatTurn } from "./providers"

// ============================================================
// The AI agent: decides whether to answer a DM, and writes the answer.
// Sending is left to the caller so it can reuse the Instagram helpers.
// ============================================================

export const DEFAULT_AI_SETTINGS: Omit<AiSettings, "user_id"> = {
  is_enabled: false,
  provider: "anthropic",
  model: "claude-opus-5",
  api_key: null,
  system_prompt: "",
  audience_mode: "all",
  blocklist: [],
  pause_on_human_reply: true,
  human_takeover_minutes: 60,
  history_limit: 12,
  max_reply_chars: 700,
  reply_delay_seconds: 0,
  typing_indicator: true,
}

export type AgentOutcome =
  | { status: "reply"; text: string; settings: AiSettings }
  | { status: "skipped"; reason: string }
  | { status: "error"; reason: string }

export async function loadAiSettings(supabase: any, userId: number | string): Promise<AiSettings | null> {
  const { data } = await supabase.from("ai_settings").select("*").eq("user_id", userId).single()
  if (!data) return null
  return normalizeSettings(data)
}

export function normalizeSettings(row: any): AiSettings {
  const provider = isKnownProvider(row?.provider) ? row.provider : DEFAULT_AI_SETTINGS.provider
  return {
    user_id: row.user_id,
    is_enabled: row.is_enabled ?? false,
    provider,
    model: row.model || defaultModelFor(provider),
    api_key: row.api_key ?? null,
    system_prompt: row.system_prompt ?? "",
    audience_mode: (row.audience_mode as AudienceMode) ?? "all",
    blocklist: Array.isArray(row.blocklist) ? row.blocklist : [],
    pause_on_human_reply: row.pause_on_human_reply ?? true,
    human_takeover_minutes: row.human_takeover_minutes ?? 60,
    history_limit: row.history_limit ?? 12,
    max_reply_chars: row.max_reply_chars ?? 700,
    reply_delay_seconds: row.reply_delay_seconds ?? 0,
    typing_indicator: row.typing_indicator ?? true,
  }
}

// ------------------------------------------------------------
// Audience rules
// ------------------------------------------------------------
function normalizeHandle(value: string): string {
  return value.trim().replace(/^@/, "").toLowerCase()
}

export function isBlocked(settings: AiSettings, senderId: string, username?: string | null): boolean {
  if (!settings.blocklist.length) return false
  const entries = settings.blocklist.map(normalizeHandle).filter(Boolean)
  const candidates = [senderId, username].filter(Boolean).map((v) => normalizeHandle(String(v)))
  return entries.some((entry) => candidates.includes(entry))
}

/**
 * `undefined` flags mean Instagram did not tell us the follow relationship. We
 * fail closed: "followers only" has to mean followers only, so an unknown
 * relationship is treated as "not allowed" rather than replying to everyone.
 */
export function audienceAllows(
  mode: AudienceMode,
  flags: { is_user_follow_business?: boolean; is_business_follow_user?: boolean },
): { allowed: boolean; reason: string } {
  if (mode === "all") return { allowed: true, reason: "audience: all" }

  const follows = flags.is_user_follow_business
  const followedBy = flags.is_business_follow_user

  if (mode === "followers") {
    if (follows === undefined) return { allowed: false, reason: "follow status unknown (followers-only rule)" }
    return follows
      ? { allowed: true, reason: "audience: follower" }
      : { allowed: false, reason: "not a follower" }
  }

  if (mode === "following") {
    if (followedBy === undefined) return { allowed: false, reason: "follow status unknown (following-only rule)" }
    return followedBy
      ? { allowed: true, reason: "audience: you follow them" }
      : { allowed: false, reason: "you do not follow them" }
  }

  // mutuals
  if (follows === undefined || followedBy === undefined) {
    return { allowed: false, reason: "follow status unknown (mutuals-only rule)" }
  }
  return follows && followedBy
    ? { allowed: true, reason: "audience: mutual" }
    : { allowed: false, reason: "not a mutual follow" }
}

// ------------------------------------------------------------
// Conversation state
// ------------------------------------------------------------
export function pauseState(conversation: any): { paused: boolean; reason: string } {
  if (conversation?.ai_enabled === false) {
    return { paused: true, reason: "AI stopped for this chat" }
  }
  const until = conversation?.ai_paused_until ? new Date(conversation.ai_paused_until) : null
  if (until && until.getTime() > Date.now()) {
    return { paused: true, reason: `AI paused until ${until.toISOString()}` }
  }
  return { paused: false, reason: "" }
}

/**
 * Called when a human replies — from the dashboard inbox or, via the webhook's
 * echo handling, from the Instagram app itself.
 */
export async function applyHumanTakeover(supabase: any, conversationId: string, settings: AiSettings | null) {
  if (!settings?.pause_on_human_reply) return
  const minutes = settings.human_takeover_minutes

  if (!minutes || minutes <= 0) {
    await supabase
      .from("conversations")
      .update({ ai_enabled: false, ai_paused_until: null, ai_last_reason: "stopped: you replied manually" })
      .eq("id", conversationId)
    return
  }

  const until = new Date(Date.now() + minutes * 60_000).toISOString()
  await supabase
    .from("conversations")
    .update({ ai_paused_until: until, ai_last_reason: `paused ${minutes}m: you replied manually` })
    .eq("id", conversationId)
}

// ------------------------------------------------------------
// Prompt assembly
// ------------------------------------------------------------
export function buildSystemPrompt(
  settings: AiSettings,
  accountUsername: string,
  recipientUsername?: string | null,
): string {
  const frame = [
    `You are the person behind the Instagram account @${accountUsername}, replying to a direct message${
      recipientUsername ? ` from @${recipientUsername}` : ""
    }.`,
    "Write the reply exactly as it should be sent — no preamble, no quotes, no explanation of what you are doing.",
    `Keep it short and natural for a DM: usually one to three sentences, and never more than ${settings.max_reply_chars} characters.`,
    "Plain text only. No markdown, no headings, no bullet lists.",
    "Never claim to be an AI, a bot, or an assistant.",
    "Only state facts you were given below. If you do not know something, say you will follow up rather than inventing details.",
    "If the message needs a human — a complaint, a refund, anything sensitive or high-stakes — say a real person will get back to them shortly and stop there.",
  ].join(" ")

  const custom = settings.system_prompt.trim()
  if (!custom) return frame

  return `${frame}\n\nAccount owner's instructions — these take priority over the general guidance above:\n${custom}`
}

async function buildHistory(
  supabase: any,
  conversationId: string,
  limit: number,
  incomingText: string,
): Promise<ChatTurn[]> {
  const { data } = await supabase
    .from("messages")
    .select("content, is_from_instagram, created_at")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: false })
    .limit(Math.max(2, limit))

  const rows = Array.isArray(data) ? [...data].reverse() : []

  let turns: ChatTurn[] = rows
    .filter((m: any) => typeof m.content === "string" && m.content.trim())
    .map((m: any) => ({
      role: m.is_from_instagram ? ("user" as const) : ("assistant" as const),
      content: String(m.content),
    }))

  // The incoming DM is normally already persisted, but the insert is best-effort —
  // make sure the model always sees the message it is answering.
  if (turns[turns.length - 1]?.content !== incomingText) {
    turns.push({ role: "user", content: incomingText })
  }

  // Claude requires the conversation to start on a user turn.
  while (turns.length && turns[0].role === "assistant") turns.shift()

  return turns
}

// ------------------------------------------------------------
// Main entry point
// ------------------------------------------------------------
export async function runAiAgent(params: {
  supabase: any
  user: any
  conversationId: string | null
  senderId: string
  senderUsername?: string | null
  incomingText: string
}): Promise<AgentOutcome> {
  const { supabase, user, conversationId, senderId, incomingText } = params

  const settings = await loadAiSettings(supabase, user.id)
  if (!settings || !settings.is_enabled) return { status: "skipped", reason: "AI agent is off" }
  if (!settings.api_key) return { status: "skipped", reason: "no API key configured" }
  if (!conversationId) return { status: "skipped", reason: "no conversation record" }

  const { data: conversation } = await supabase
    .from("conversations")
    .select("id, recipient_username, ai_enabled, ai_paused_until")
    .eq("id", conversationId)
    .single()

  const paused = pauseState(conversation)
  if (paused.paused) return { status: "skipped", reason: paused.reason }

  const username = params.senderUsername ?? conversation?.recipient_username ?? null

  if (isBlocked(settings, senderId, username)) {
    return { status: "skipped", reason: "sender is on the blocklist" }
  }

  // Follow-relationship rules need a profile lookup, so only do it when asked.
  let profileUsername = username
  if (settings.audience_mode !== "all") {
    const profile = await fetchMessagingProfile(user.access_token, senderId)
    if (profile?.username) profileUsername = profile.username

    const verdict = audienceAllows(settings.audience_mode, {
      is_user_follow_business: profile?.is_user_follow_business,
      is_business_follow_user: profile?.is_business_follow_user,
    })
    if (!verdict.allowed) return { status: "skipped", reason: verdict.reason }
  }

  const history = await buildHistory(supabase, conversationId, settings.history_limit, incomingText)
  if (!history.length) return { status: "skipped", reason: "nothing to reply to" }

  const result = await generateReply({
    provider: settings.provider,
    apiKey: settings.api_key,
    model: settings.model,
    systemPrompt: buildSystemPrompt(settings, user.username, profileUsername),
    history,
  })

  if (!result.ok || !result.text) {
    return { status: "error", reason: result.error || "generation failed" }
  }

  return { status: "reply", text: truncate(result.text, settings.max_reply_chars), settings }
}

export function truncate(text: string, maxChars: number): string {
  const limit = Math.max(1, Math.min(maxChars || 700, 1000)) // Instagram caps DM text at 1000
  if (text.length <= limit) return text
  const cut = text.slice(0, limit)
  const lastBreak = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("! "), cut.lastIndexOf("? "))
  return (lastBreak > limit * 0.5 ? cut.slice(0, lastBreak + 1) : cut).trim()
}
