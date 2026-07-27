-- ==========================================================================
-- Content Studio (v1)
--   Goal-driven content planning: analyses the account's own recent posts,
--   plus whatever reference accounts the owner describes, and generates
--   post ideas with full scripts.
-- Safe to re-run. Requires 09-ai-agent.sql (reuses ai_settings for the key).
-- ==========================================================================

CREATE TABLE IF NOT EXISTS public.content_plans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id BIGINT NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,

  -- what the owner asked for
  goal TEXT NOT NULL,
  niche TEXT,
  audience TEXT,
  formats TEXT[] NOT NULL DEFAULT '{}',

  -- Free text describing accounts to learn from. Instagram's API cannot read
  -- other people's posts on this auth flow, so this is the owner's own notes.
  reference_notes TEXT,

  -- which model produced it
  provider TEXT,
  model TEXT,

  -- results
  analysis JSONB,
  ideas JSONB NOT NULL DEFAULT '[]'::jsonb,
  posts_analyzed INTEGER NOT NULL DEFAULT 0,

  -- snapshot of the posts (thumbnail, permalink, views/reach) the plan was built
  -- from, so a saved plan still renders its evidence later
  posts JSONB NOT NULL DEFAULT '[]'::jsonb,

  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- Added after the first release — keeps existing installs in step.
ALTER TABLE public.content_plans
  ADD COLUMN IF NOT EXISTS posts JSONB NOT NULL DEFAULT '[]'::jsonb;

CREATE INDEX IF NOT EXISTS idx_content_plans_user_created
  ON public.content_plans(user_id, created_at DESC);

COMMENT ON COLUMN public.content_plans.reference_notes IS
  'Owner-supplied description of similar accounts. Instagram API with Instagram Login has no business_discovery, so competitor posts cannot be fetched automatically.';
