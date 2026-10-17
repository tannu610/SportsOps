-- ==============================================================================
-- Migration v18: Sport-Aware Cricket Teams & Relational Roster Architecture
-- Tables: cricket_teams, cricket_team_members
-- Run this in the Supabase SQL Editor
-- ==============================================================================

-- 1. Create cricket_teams Table
-- The Team Name itself is the team's unique identifier within the event.
-- No Team Code is created or required.
CREATE TABLE IF NOT EXISTS cricket_teams (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  category TEXT DEFAULT 'Open Cricket',
  captain_player_id UUID REFERENCES players(id) ON DELETE SET NULL,
  captain_name TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()),
  CONSTRAINT uq_cricket_teams_event_name UNIQUE (event_id, name)
);

-- 2. Create cricket_team_members Table
-- Represents the relational team-player roster membership.
CREATE TABLE IF NOT EXISTS cricket_team_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id UUID NOT NULL REFERENCES cricket_teams(id) ON DELETE CASCADE,
  player_id UUID NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  is_captain BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()),
  CONSTRAINT uq_cricket_team_player UNIQUE (team_id, player_id)
);

-- 3. Indexes for performance
CREATE INDEX IF NOT EXISTS idx_cricket_teams_event_id ON cricket_teams(event_id);
CREATE INDEX IF NOT EXISTS idx_cricket_teams_captain_player_id ON cricket_teams(captain_player_id);
CREATE INDEX IF NOT EXISTS idx_cricket_team_members_team_id ON cricket_team_members(team_id);
CREATE INDEX IF NOT EXISTS idx_cricket_team_members_player_id ON cricket_team_members(player_id);

-- 4. Enable Row Level Security (RLS)
ALTER TABLE cricket_teams ENABLE ROW LEVEL SECURITY;
ALTER TABLE cricket_team_members ENABLE ROW LEVEL SECURITY;

-- 5. Policies: Public read access
DROP POLICY IF EXISTS "Public read cricket_teams" ON cricket_teams;
CREATE POLICY "Public read cricket_teams" ON cricket_teams FOR SELECT USING (true);

DROP POLICY IF EXISTS "Public read cricket_team_members" ON cricket_team_members;
CREATE POLICY "Public read cricket_team_members" ON cricket_team_members FOR SELECT USING (true);

-- 6. Policies: Service role / Authenticated full access
DROP POLICY IF EXISTS "Service role full access cricket_teams" ON cricket_teams;
CREATE POLICY "Service role full access cricket_teams" ON cricket_teams FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Service role full access cricket_team_members" ON cricket_team_members;
CREATE POLICY "Service role full access cricket_team_members" ON cricket_team_members FOR ALL USING (true) WITH CHECK (true);

-- 7. Realtime Publication (if publication exists)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE cricket_teams;
    ALTER PUBLICATION supabase_realtime ADD TABLE cricket_team_members;
  END IF;
EXCEPTION WHEN OTHERS THEN
  NULL;
END $$;
