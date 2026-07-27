// Shared types for the automation system
export type ButtonAction = "web_url" | "postback"

export interface ProButton {
  id: string
  type: ButtonAction
  title: string
  url?: string
  payload?: string
}

export interface QuickReplyOption {
  id: string
  title: string
  payload?: string
}

export interface MediaResponse {
  type: "image" | "video" | "audio"
  url: string
}

// The JSON stored in automations.response_content
export interface ResponseContent {
  message?: string
  card?: {
    title: string
    subtitle?: string
    image_url?: string
    buttons: Omit<ProButton, "id">[]
  }
  media?: MediaResponse
  quick_replies?: { title: string; payload?: string }[]
  check_follow?: boolean
  // Comment automation options
  reply_mode?: "both" | "dm_only" | "public_only"
  public_replies?: string[]
  include_replies?: boolean
  // Delivery options
  delay_seconds?: number
  typing_indicator?: boolean
  mark_seen?: boolean
}

export interface MediaItem {
  id: string
  media_id: string
  media_type: string
  caption: string
  image_url: string
  video_url: string
  permalink: string
  media_product_type: string
  timestamp: string
}

export interface MediaSelection {
  reel_id: string
  caption?: string
}

// ============================================================
// AI Agent
// ============================================================
export type AiProvider = "anthropic" | "openai" | "deepseek"

/** Who the agent is allowed to reply to. */
export type AudienceMode = "all" | "followers" | "following" | "mutuals"

export interface AiSettings {
  user_id: number
  is_enabled: boolean
  provider: AiProvider
  model: string
  /** Never sent to the browser — the API returns `has_api_key` instead. */
  api_key?: string | null
  has_api_key?: boolean
  system_prompt: string
  audience_mode: AudienceMode
  blocklist: string[]
  pause_on_human_reply: boolean
  /** 0 = stop the AI until it is manually resumed. */
  human_takeover_minutes: number
  history_limit: number
  max_reply_chars: number
  reply_delay_seconds: number
  typing_indicator: boolean
}

/** Per-conversation AI state, stored on the `conversations` row. */
export interface ConversationAiState {
  ai_enabled: boolean
  ai_paused_until: string | null
  ai_last_reason: string | null
}

export interface Automation {
  id: string
  name: string
  trigger_source: "comment" | "dm" | "story"
  trigger_value: string
  trigger_type: "keyword" | "postback" | "reply_all" | "mention" | "reaction" | "reply"
  response_content: ResponseContent
  is_active: boolean
  created_at: string
  specific_media_id?: string | null
  media_selection?: MediaSelection | null
  selected_reel_id?: string | null
}
