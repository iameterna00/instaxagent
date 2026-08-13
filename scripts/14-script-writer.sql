-- ==========================================================================
-- Script Writer (v1)
--   Writes the creator's NEXT script by copying the structure and delivery of
--   the reels they have already published, weighted by how well each one
--   actually performed. The model is never asked to invent a style — it
--   extracts the template from their own transcripts and refills it with a
--   new topic.
-- Safe to re-run. Requires 09-ai-agent.sql and 11-transcripts-and-audience.sql.
-- ==========================================================================

CREATE TABLE IF NOT EXISTS public.generated_scripts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id BIGINT NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,

  -- What the owner typed in "next topic". NULL means they left it blank and
  -- asked the model to choose one that fits their proven pattern.
  topic TEXT,
  format TEXT,

  -- which model produced it
  provider TEXT,
  model TEXT,

  -- The template the model reverse-engineered from the transcripts BEFORE
  -- writing anything: the beat order, the pacing, and the delivery rules it
  -- copied. Stored because it is the evidence the script follows their format
  -- rather than a generic AI one.
  structure JSONB NOT NULL DEFAULT '{}'::jsonb,

  -- The script itself: title, hook, timestamped beats, caption, CTA, hashtags.
  script JSONB NOT NULL DEFAULT '{}'::jsonb,

  -- Human-readable list of which reels it was modelled on, best performing
  -- first, and any place the model deliberately departed from the template.
  modeled_on JSONB NOT NULL DEFAULT '[]'::jsonb,
  notes JSONB NOT NULL DEFAULT '[]'::jsonb,

  -- What the writing was calibrated against, so an old script stays readable.
  transcripts_used INTEGER NOT NULL DEFAULT 0,
  posts_analyzed INTEGER NOT NULL DEFAULT 0,

  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_generated_scripts_user_created
  ON public.generated_scripts(user_id, created_at DESC);

COMMENT ON TABLE public.generated_scripts IS
  'Scripts written by copying the structure of the account''s own top-performing reel transcripts. Requires media_transcripts to hold something — with no transcripts the writer has no template to follow.';

COMMENT ON COLUMN public.generated_scripts.structure IS
  'The beat template, pacing and voice rules the model extracted from the creator''s transcripts, ordered best-performing first. Shown in the UI so the script can be checked against the format it claims to follow.';
