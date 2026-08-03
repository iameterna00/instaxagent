-- ==========================================================================
-- Script Analysis (v1)
--   Scores a script the owner has written BEFORE they film it, against their
--   own posts rather than a generic rubric: hook strength, when the payoff
--   lands, whether it sounds like them, and how hard the CTA asks.
-- Safe to re-run. Requires 09-ai-agent.sql and 11-transcripts-and-audience.sql.
-- ==========================================================================

CREATE TABLE IF NOT EXISTS public.script_analyses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id BIGINT NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,

  -- what was submitted
  script TEXT NOT NULL,
  format TEXT,

  -- which model produced it
  provider TEXT,
  model TEXT,

  -- Headline verdict: 0-100 overall, and the one-paragraph read shown large.
  score INTEGER,
  verdict TEXT,
  -- ESTIMATED overall retention. Predicted, never measured — see `lines`.
  retention_estimate INTEGER,

  -- The four graded dimensions (hook, payoff timing, voice match, CTA), each
  -- with the account's own average to compare against.
  scores JSONB NOT NULL DEFAULT '[]'::jsonb,

  -- Line-by-line: the line, the note, and the model's ESTIMATED share of
  -- viewers still watching. Instagram exposes no retention data whatsoever, so
  -- every retention figure in here is a prediction and the UI must label it as
  -- one. Never present these as measured.
  lines JSONB NOT NULL DEFAULT '[]'::jsonb,

  keep JSONB NOT NULL DEFAULT '[]'::jsonb,
  fix JSONB NOT NULL DEFAULT '[]'::jsonb,

  -- Rewritten version as timestamped beats, plus its own predicted score.
  rewrite JSONB NOT NULL DEFAULT '[]'::jsonb,
  rewrite_score INTEGER,
  rewrite_runtime TEXT,

  -- What the scoring was calibrated against, so an old analysis stays readable.
  posts_analyzed INTEGER NOT NULL DEFAULT 0,
  transcripts_used INTEGER NOT NULL DEFAULT 0,

  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_script_analyses_user_created
  ON public.script_analyses(user_id, created_at DESC);

COMMENT ON COLUMN public.script_analyses.lines IS
  'Per-line notes with an ESTIMATED retention share. Instagram provides no retention metrics at any granularity — these are model predictions and must always be labelled as estimates in the UI.';

COMMENT ON COLUMN public.script_analyses.scores IS
  'Graded dimensions (HOOK, PAYOFF TIMING, VOICE MATCH, CTA STRENGTH) with the value, the account''s own baseline, and a 0-1 bar fraction.';
