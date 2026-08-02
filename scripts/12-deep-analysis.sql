-- ==========================================================================
-- Deep Analysis (v1)
--   Scores the account's own recent posts against each other and explains
--   what carried them: per-post verdict, what worked, what to fix next.
-- Safe to re-run. Requires 09-ai-agent.sql (reuses ai_settings for the key).
-- ==========================================================================

CREATE TABLE IF NOT EXISTS public.post_analyses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id BIGINT NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,

  -- which model produced it
  provider TEXT,
  model TEXT,

  -- Account-level read: the headline, what is working, what to improve, and
  -- the single next post to make.
  summary JSONB,

  -- Snapshot of the posts the analysis was built from, each carrying both the
  -- real Instagram metrics and the model's verdict for that post. Stored whole
  -- so a saved analysis still renders after the metrics have moved on.
  posts JSONB NOT NULL DEFAULT '[]'::jsonb,
  posts_analyzed INTEGER NOT NULL DEFAULT 0,

  -- Follower count / reach / demographics the analysis was reasoned against,
  -- so an old analysis still renders its headline figures.
  account JSONB,

  -- Whether the token actually returned views/reach/saves. Without the
  -- insights scope the analysis is caption-only, and the UI has to say so.
  has_insights BOOLEAN NOT NULL DEFAULT FALSE,

  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_post_analyses_user_created
  ON public.post_analyses(user_id, created_at DESC);

COMMENT ON COLUMN public.post_analyses.posts IS
  'Per-post rows: real metrics (views/reach/likes/saves/comments) merged with the model verdict (score, working, improve, tags, next, lift).';

COMMENT ON COLUMN public.post_analyses.has_insights IS
  'False when the access token predates instagram_business_manage_insights — the analysis then rests on captions and formats alone.';
