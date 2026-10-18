-- ==============================================================================
-- Migration v20: Two-Way Match Player Availability Responses
-- Table: match_player_responses
-- Run this in the Supabase SQL Editor.
-- ==============================================================================

CREATE TABLE IF NOT EXISTS match_player_responses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  match_id UUID NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  player_id UUID NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  response TEXT NOT NULL CHECK (response IN ('COMING', 'NOT_COMING')),
  responded_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()),
  created_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()),
  updated_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()),
  CONSTRAINT uq_match_player_response UNIQUE (match_id, player_id)
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_mpr_match_id ON match_player_responses(match_id);
CREATE INDEX IF NOT EXISTS idx_mpr_player_id ON match_player_responses(player_id);

-- Enable Row Level Security (RLS)
ALTER TABLE match_player_responses ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public read match_player_responses" ON match_player_responses;
CREATE POLICY "Public read match_player_responses" ON match_player_responses FOR SELECT USING (true);

DROP POLICY IF EXISTS "Service role full access match_player_responses" ON match_player_responses;
CREATE POLICY "Service role full access match_player_responses" ON match_player_responses FOR ALL USING (true) WITH CHECK (true);

-- Enable Realtime publication
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE match_player_responses;
  END IF;
EXCEPTION WHEN OTHERS THEN
  NULL;
END $$;
