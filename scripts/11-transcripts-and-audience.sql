-- ==========================================================================
-- Content Studio (v2): reel transcripts + follower-aware strategy
--   * media_transcripts: cached Whisper transcripts, keyed by IG media id, so
--     a reel is only ever paid for once
--   * ai_settings.transcription_api_key: OpenAI key used only for audio.
--     Claude and DeepSeek have no audio endpoint, so transcription needs its
--     own credential unless the account's main provider is already OpenAI.
--   * content_plans.account: snapshot of follower count / reach / demographics
--     the plan was reasoned against, so an old plan stays interpretable
-- Safe to re-run. Requires 09-ai-agent.sql and 10-content-studio.sql.
-- ==========================================================================

-- ==========================================
-- 1. Transcript cache
-- ==========================================
CREATE TABLE IF NOT EXISTS public.media_transcripts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id BIGINT NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,

  -- Instagram media id. Unique per user so re-running a plan is free.
  media_id TEXT NOT NULL,

  transcript TEXT NOT NULL,
  -- Audio length in seconds, as reported by the transcription model. Lets the
  -- planner reason about pacing (words per second) and target reel length.
  duration_seconds NUMERIC,
  model TEXT,
  -- Set when transcription was attempted and failed, so we can show why
  -- without retrying a permanently broken media URL on every generate.
  error TEXT,

  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (user_id, media_id)
);

CREATE INDEX IF NOT EXISTS idx_media_transcripts_user
  ON public.media_transcripts(user_id);

COMMENT ON TABLE public.media_transcripts IS
  'Cached speech-to-text for the account''s own reels. Instagram exposes no transcript, so this is produced by downloading media_url and sending it to a transcription API.';

-- ==========================================
-- 2. Transcription credential
-- ==========================================
ALTER TABLE public.ai_settings
  ADD COLUMN IF NOT EXISTS transcription_api_key TEXT,
  ADD COLUMN IF NOT EXISTS transcription_enabled BOOLEAN NOT NULL DEFAULT TRUE;

COMMENT ON COLUMN public.ai_settings.transcription_api_key IS
  'OpenAI API key for audio transcription. Ignored when provider = openai (the main api_key is reused).';
COMMENT ON COLUMN public.ai_settings.transcription_enabled IS
  'FALSE = never transcribe, even if a key is available. Transcription costs money per reel.';

-- ==========================================
-- 3. Account snapshot on saved plans
-- ==========================================
ALTER TABLE public.content_plans
  ADD COLUMN IF NOT EXISTS account JSONB,
  ADD COLUMN IF NOT EXISTS transcripts_used INTEGER NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.content_plans.account IS
  'Follower count, 30-day account insights and follower demographics as they were when the plan was generated.';
