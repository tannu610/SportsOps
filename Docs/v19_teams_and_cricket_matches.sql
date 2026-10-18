-- ==============================================================================
-- Migration v19: Sport-Aware Teams & Cricket Match Support
-- Tables modified/created:
--   1. teams (new normalized table for team-based sports like Cricket)
--   2. players (add team_id foreign key)
--   3. matches (add team1_id, team2_id foreign keys, preserving badminton columns)
-- Backfill:
--   Safely extracts team rosters and captains for the current 44 Cricket players
--   from players.push_subscription._metadata without dropping or deleting any records.
-- Run this in the Supabase SQL Editor.
-- ==============================================================================

-- 1. Create normalized teams table
CREATE TABLE IF NOT EXISTS teams (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  sport TEXT NOT NULL DEFAULT 'Cricket',
  name TEXT NOT NULL,
  category TEXT DEFAULT 'Open Cricket',
  captain_player_id UUID REFERENCES players(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()),
  updated_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()),
  CONSTRAINT uq_event_sport_team_name UNIQUE (event_id, sport, name)
);

-- 2. Add team_id to players
ALTER TABLE players ADD COLUMN IF NOT EXISTS team_id UUID REFERENCES teams(id) ON DELETE SET NULL;

-- 3. Add team1_id and team2_id to matches (Badminton matches leave these NULL)
ALTER TABLE matches ADD COLUMN IF NOT EXISTS team1_id UUID REFERENCES teams(id) ON DELETE SET NULL;
ALTER TABLE matches ADD COLUMN IF NOT EXISTS team2_id UUID REFERENCES teams(id) ON DELETE SET NULL;

-- 4. Indexes for query performance
CREATE INDEX IF NOT EXISTS idx_teams_event_sport ON teams(event_id, sport);
CREATE INDEX IF NOT EXISTS idx_teams_captain_player_id ON teams(captain_player_id);
CREATE INDEX IF NOT EXISTS idx_players_team_id ON players(team_id);
CREATE INDEX IF NOT EXISTS idx_matches_team1_id ON matches(team1_id);
CREATE INDEX IF NOT EXISTS idx_matches_team2_id ON matches(team2_id);

-- 5. Row Level Security (RLS) for teams
ALTER TABLE teams ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public read teams" ON teams;
CREATE POLICY "Public read teams" ON teams FOR SELECT USING (true);

DROP POLICY IF EXISTS "Service role full access teams" ON teams;
CREATE POLICY "Service role full access teams" ON teams FOR ALL USING (true) WITH CHECK (true);

-- 6. Enable Realtime on teams table
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE teams;
  END IF;
EXCEPTION WHEN OTHERS THEN
  NULL;
END $$;

-- ==============================================================================
-- 7. IDEMPOTENT BACKFILL FOR EXISTING PLAYERS
-- Extracts team_name, captain, and links players without deleting any records
-- ==============================================================================

-- Step A: Insert unique teams from existing player metadata
INSERT INTO teams (event_id, sport, name, category, created_at, updated_at)
SELECT DISTINCT
  p.event_id,
  COALESCE(p.sport, 'Cricket') AS sport,
  TRIM(p.push_subscription->_metadata->>'team_name') AS name,
  COALESCE(p.category, 'Open Cricket') AS category,
  MIN(p.created_at) AS created_at,
  now() AS updated_at
FROM players p
WHERE p.push_subscription IS NOT NULL
  AND p.push_subscription->_metadata IS NOT NULL
  AND p.push_subscription->_metadata->>'team_name' IS NOT NULL
  AND TRIM(p.push_subscription->_metadata->>'team_name') <> ''
GROUP BY p.event_id, COALESCE(p.sport, 'Cricket'), TRIM(p.push_subscription->_metadata->>'team_name'), COALESCE(p.category, 'Open Cricket')
ON CONFLICT (event_id, sport, name) DO UPDATE 
SET updated_at = now();

-- Step B: Link every player to their corresponding team record
UPDATE players p
SET team_id = t.id
FROM teams t
WHERE p.event_id = t.event_id
  AND p.push_subscription IS NOT NULL
  AND p.push_subscription->_metadata IS NOT NULL
  AND TRIM(p.push_subscription->_metadata->>'team_name') = t.name
  AND (p.team_id IS NULL OR p.team_id <> t.id);

-- Step C: Assign captain_player_id on the team record
UPDATE teams t
SET captain_player_id = p.id,
    updated_at = now()
FROM players p
WHERE p.team_id = t.id
  AND p.push_subscription IS NOT NULL
  AND p.push_subscription->_metadata IS NOT NULL
  AND (p.push_subscription->_metadata->>'is_captain')::text = 'true'
  AND (t.captain_player_id IS NULL OR t.captain_player_id <> p.id);

-- Fallback captain assignment by matching captain_name if is_captain was not set on player
UPDATE teams t
SET captain_player_id = p.id,
    updated_at = now()
FROM players p
WHERE p.team_id = t.id
  AND t.captain_player_id IS NULL
  AND p.push_subscription IS NOT NULL
  AND p.push_subscription->_metadata IS NOT NULL
  AND LOWER(TRIM(p.name)) = LOWER(TRIM(p.push_subscription->_metadata->>'captain_name'));
