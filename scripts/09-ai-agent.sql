-- ==========================================================================
-- AI Agent (v1)
--   * per-user provider settings (BYO API key: Claude / OpenAI / DeepSeek)
--   * audience rules: who the agent is allowed to reply to
--   * per-conversation control: pause for N minutes, or stop entirely
-- Safe to re-run.
-- ==========================================================================

-- ==========================================
-- 1. Per-user AI settings
-- ==========================================
CREATE TABLE IF NOT EXISTS public.ai_settings (
  user_id BIGINT PRIMARY KEY REFERENCES public.users(id) ON DELETE CASCADE,

  -- master switch for the whole account
  is_enabled BOOLEAN NOT NULL DEFAULT FALSE,

  -- provider + credentials (BYO key, one provider active at a time)
  provider TEXT NOT NULL DEFAULT 'anthropic' CHECK (provider IN ('anthropic', 'openai', 'deepseek')),
  model TEXT NOT NULL DEFAULT 'claude-opus-5',
  api_key TEXT,

  -- the prompt that defines the agent's persona / rules
  system_prompt TEXT NOT NULL DEFAULT '',

  -- WHO to reply to.
  --   all       -> everyone who DMs
  --   followers -> only accounts that follow the business
  --   following -> only accounts the business follows
  --   mutuals   -> only accounts where both are true
  audience_mode TEXT NOT NULL DEFAULT 'all'
    CHECK (audience_mode IN ('all', 'followers', 'following', 'mutuals')),

  -- never reply to these people (usernames and/or IG-scoped IDs)
  blocklist TEXT[] NOT NULL DEFAULT '{}',

  -- HUMAN TAKEOVER: when the owner replies manually (from the inbox or the
  -- Instagram app), hand the conversation back to them.
  -- human_takeover_minutes = 0 means "stop the AI until manually resumed".
  pause_on_human_reply BOOLEAN NOT NULL DEFAULT TRUE,
  human_takeover_minutes INTEGER NOT NULL DEFAULT 60,

  -- generation / delivery tuning
  history_limit INTEGER NOT NULL DEFAULT 12,      -- past messages sent as context
  max_reply_chars INTEGER NOT NULL DEFAULT 700,   -- hard cap (IG DM limit is 1000)
  reply_delay_seconds INTEGER NOT NULL DEFAULT 0, -- human-like pause before sending
  typing_indicator BOOLEAN NOT NULL DEFAULT TRUE,

  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- ==========================================
-- 2. Per-conversation AI control
-- ==========================================
ALTER TABLE public.conversations
  ADD COLUMN IF NOT EXISTS ai_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS ai_paused_until TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS ai_last_reason TEXT;

COMMENT ON COLUMN public.conversations.ai_enabled IS
  'FALSE = AI stopped for this chat until manually resumed.';
COMMENT ON COLUMN public.conversations.ai_paused_until IS
  'AI stays silent in this chat until this timestamp (human takeover / snooze).';
COMMENT ON COLUMN public.conversations.ai_last_reason IS
  'Why the AI did or did not reply last time — surfaced in the inbox UI.';

-- ==========================================
-- 3. Mark which outgoing messages the AI wrote
--    (also lets the webhook tell our own echo apart from a human reply
--     typed directly in the Instagram app)
-- ==========================================
ALTER TABLE public.messages
  ADD COLUMN IF NOT EXISTS via_ai BOOLEAN NOT NULL DEFAULT FALSE;

-- ==========================================
-- 4. Indexes
-- ==========================================
CREATE INDEX IF NOT EXISTS idx_messages_conversation_created
  ON public.messages(conversation_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_conversations_user_recipient
  ON public.conversations(user_id, recipient_id);

-- ==========================================
-- 5. Carry over the old `users.ai_context` free-text field
--    (written by the previous AI panel) into the new system prompt.
-- ==========================================
INSERT INTO public.ai_settings (user_id, system_prompt, is_enabled)
SELECT u.id,
       COALESCE(u.ai_context, ''),
       COALESCE(u.groq_auto_reply_enabled, FALSE)
FROM public.users u
WHERE u.ai_context IS NOT NULL AND u.ai_context <> ''
ON CONFLICT (user_id) DO NOTHING;
