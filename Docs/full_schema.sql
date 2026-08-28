-- ==============================================================================
-- SPORTS EVENT MATCH-DAY OPERATIONS (SportsOps) - CONSOLIDATED SUPABASE SCHEMA
-- ==============================================================================
-- Run this entire script in Supabase SQL Editor (Dashboard -> SQL Editor -> New Query)
-- ==============================================================================

-- ==============================================================================
-- 0. CLEAN RESET (OPTIONAL - UNCOMMENT ONLY IF YOU WANT TO WIPE AND START FRESH)
-- ==============================================================================
-- DROP TABLE IF EXISTS notifications CASCADE;
-- DROP TABLE IF EXISTS matches CASCADE;
-- DROP TABLE IF EXISTS players CASCADE;
-- DROP TABLE IF EXISTS events CASCADE;
-- DROP FUNCTION IF EXISTS call_players_for_match(UUID[]) CASCADE;
-- DROP FUNCTION IF EXISTS delete_match_and_rollback(UUID) CASCADE;
-- DROP FUNCTION IF EXISTS player_accept_match(UUID, UUID) CASCADE;
-- DROP FUNCTION IF EXISTS player_reject_match(UUID, UUID) CASCADE;
-- DROP FUNCTION IF EXISTS complete_match_workflow(UUID, TEXT, BOOLEAN) CASCADE;

-- 1. Enable Required Extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ==============================================================================
-- 2. TABLES
-- ==============================================================================

-- 2.1 Events Table
CREATE TABLE IF NOT EXISTS events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  sport TEXT,
  event_date DATE,
  venue TEXT,
  configuration JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now())
);

-- 2.2 Players Table
CREATE TABLE IF NOT EXISTS players (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id UUID REFERENCES events(id) ON DELETE CASCADE,
  employee_id TEXT NOT NULL,
  name TEXT NOT NULL,
  sport TEXT NOT NULL,
  category TEXT DEFAULT 'NA',
  contact_info TEXT,
  status TEXT DEFAULT 'REGISTERED',
  previous_status TEXT,
  current_round INTEGER DEFAULT 1,
  push_subscription JSONB,
  check_in_time TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()),
  
  -- Allows multi-sport & multi-category registration per employee
  CONSTRAINT players_event_id_emp_sport_cat_key UNIQUE (event_id, employee_id, sport, category)
);

-- 2.3 Matches Table
-- NOTE: Named foreign keys (fk_t1p1, fk_t1p2, fk_t2p1, fk_t2p2) are REQUIRED
-- by PostgREST query joins in the Next.js app.
CREATE TABLE IF NOT EXISTS matches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id UUID REFERENCES events(id) ON DELETE CASCADE,
  sport TEXT NOT NULL DEFAULT 'Other',
  category TEXT DEFAULT 'NA',
  phase TEXT DEFAULT 'Round 1',
  team1_p1_id UUID,
  team1_p2_id UUID,
  team2_p1_id UUID,
  team2_p2_id UUID,
  playing_area TEXT,
  scheduled_time TIMESTAMP WITH TIME ZONE NOT NULL,
  reporting_time TIMESTAMP WITH TIME ZONE,
  status TEXT DEFAULT 'SCHEDULED',
  winner_id UUID REFERENCES players(id) ON DELETE SET NULL,
  score TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()),

  CONSTRAINT fk_t1p1 FOREIGN KEY (team1_p1_id) REFERENCES players(id) ON DELETE SET NULL,
  CONSTRAINT fk_t1p2 FOREIGN KEY (team1_p2_id) REFERENCES players(id) ON DELETE SET NULL,
  CONSTRAINT fk_t2p1 FOREIGN KEY (team2_p1_id) REFERENCES players(id) ON DELETE SET NULL,
  CONSTRAINT fk_t2p2 FOREIGN KEY (team2_p2_id) REFERENCES players(id) ON DELETE SET NULL
);

-- 2.4 Notifications Table
CREATE TABLE IF NOT EXISTS notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id UUID REFERENCES players(id) ON DELETE CASCADE,
  match_id UUID REFERENCES matches(id) ON DELETE CASCADE,
  message TEXT NOT NULL,
  type TEXT NOT NULL,
  sent_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()),
  read BOOLEAN DEFAULT FALSE
);

-- ==============================================================================
-- 3. INDEXES FOR PERFORMANCE
-- ==============================================================================

CREATE INDEX IF NOT EXISTS idx_players_event ON players(event_id);
CREATE INDEX IF NOT EXISTS idx_players_employee_id ON players(employee_id);
CREATE INDEX IF NOT EXISTS idx_players_status ON players(status);
CREATE INDEX IF NOT EXISTS idx_matches_event ON matches(event_id);
CREATE INDEX IF NOT EXISTS idx_matches_status ON matches(status);
CREATE INDEX IF NOT EXISTS idx_matches_scheduled_time ON matches(scheduled_time);
CREATE INDEX IF NOT EXISTS idx_matches_teams ON matches(team1_p1_id, team1_p2_id, team2_p1_id, team2_p2_id);
CREATE INDEX IF NOT EXISTS idx_notifications_player ON notifications(player_id);

-- Enforces that the same match cannot be created multiple times while an identical active match exists
CREATE UNIQUE INDEX IF NOT EXISTS matches_unique_active_details_idx ON matches (
  event_id,
  sport,
  COALESCE(category, 'NA'),
  COALESCE(phase, 'Round 1'),
  playing_area,
  scheduled_time,
  team1_p1_id,
  COALESCE(team1_p2_id, '00000000-0000-0000-0000-000000000000'::uuid),
  team2_p1_id,
  COALESCE(team2_p2_id, '00000000-0000-0000-0000-000000000000'::uuid)
)
WHERE status NOT IN ('CANCELLED', 'COMPLETED', 'WALKOVER');

-- A match may only be created once with the same event, fixture details, teams,
-- court, and scheduled time. COALESCE makes NULL doubles partners comparable so
-- singles matches are protected as well. This is the authoritative protection
-- against double-clicks, retries, and concurrent inserts.
CREATE UNIQUE INDEX IF NOT EXISTS matches_unique_details
ON matches (
  event_id,
  sport,
  category,
  phase,
  playing_area,
  scheduled_time,
  team1_p1_id,
  COALESCE(team1_p2_id, '00000000-0000-0000-0000-000000000000'::UUID),
  team2_p1_id,
  COALESCE(team2_p2_id, '00000000-0000-0000-0000-000000000000'::UUID)
);

-- ==============================================================================
-- 4. RPC FUNCTIONS (State Machine & Match Workflows)
-- ==============================================================================

-- 4.1 Call Players for Match (Pre-Match Transition)
CREATE OR REPLACE FUNCTION call_players_for_match(p_player_ids UUID[]) 
RETURNS VOID AS $$
BEGIN
  -- Safely record their current status into previous_status before updating to CALLED
  UPDATE players 
  SET previous_status = status, status = 'CALLED' 
  WHERE id = ANY(p_player_ids);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- 4.2 Delete Match and Safely Rollback Players
CREATE OR REPLACE FUNCTION delete_match_and_rollback(p_match_id UUID) 
RETURNS VOID AS $$
DECLARE
  v_match RECORD;
  v_player_ids UUID[];
BEGIN
  SELECT * INTO v_match FROM matches WHERE id = p_match_id FOR UPDATE;
  IF NOT FOUND THEN RETURN; END IF;
  
  v_player_ids := ARRAY[
    v_match.team1_p1_id, v_match.team1_p2_id, 
    v_match.team2_p1_id, v_match.team2_p2_id
  ];
  
  -- Forcefully revert all players in this match back to their previous status (or 'PRESENT')
  UPDATE players 
  SET status = COALESCE(previous_status, 'PRESENT')
  WHERE id = ANY(v_player_ids);
  
  DELETE FROM matches WHERE id = p_match_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- 4.3 Player Accept Match ("I'M COMING")
CREATE OR REPLACE FUNCTION player_accept_match(p_player_id UUID, p_match_id UUID) 
RETURNS BOOLEAN AS $$
DECLARE
  v_match_exists BOOLEAN;
BEGIN
  SELECT EXISTS(SELECT 1 FROM matches WHERE id = p_match_id) INTO v_match_exists;
  
  IF NOT v_match_exists THEN
    RAISE EXCEPTION 'This match has been canceled or rescheduled by the committee.';
  END IF;
  
  -- Do NOT overwrite previous_status so rollback retains pre-match state (e.g. QUALIFIED / PRESENT)
  UPDATE players SET status = 'AVAILABLE' WHERE id = p_player_id;
  
  RETURN TRUE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- 4.4 Player Reject Match ("I'M UNAVAILABLE")
CREATE OR REPLACE FUNCTION player_reject_match(p_player_id UUID, p_match_id UUID) 
RETURNS BOOLEAN AS $$
BEGIN
  UPDATE players SET status = 'UNAVAILABLE' WHERE id = p_player_id;
  
  -- Alert committee by flagging match status
  UPDATE matches 
  SET status = 'PLAYER_UNAVAILABLE'
  WHERE id = p_match_id AND status IN ('SCHEDULED', 'NOTIFIED', 'DELAYED');
  
  RETURN TRUE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- 4.5 Complete Match Workflow (Winners -> QUALIFIED, Losers -> DISQUALIFIED / NO_SHOW)
CREATE OR REPLACE FUNCTION complete_match_workflow(
  p_match_id UUID, 
  p_winning_team TEXT, -- 'team1' or 'team2'
  p_is_walkover BOOLEAN
) RETURNS VOID AS $$
DECLARE
  v_match RECORD;
  v_winners UUID[];
  v_losers UUID[];
  v_new_qualified_status TEXT;
BEGIN
  SELECT * INTO v_match FROM matches WHERE id = p_match_id FOR UPDATE;
  IF NOT FOUND THEN RETURN; END IF;
  
  IF p_winning_team = 'team1' THEN
    v_winners := ARRAY[v_match.team1_p1_id, v_match.team1_p2_id];
    v_losers := ARRAY[v_match.team2_p1_id, v_match.team2_p2_id];
  ELSE
    v_winners := ARRAY[v_match.team2_p1_id, v_match.team2_p2_id];
    v_losers := ARRAY[v_match.team1_p1_id, v_match.team1_p2_id];
  END IF;

  UPDATE matches 
  SET status = CASE WHEN p_is_walkover THEN 'WALKOVER' ELSE 'COMPLETED' END 
  WHERE id = p_match_id;
  
  -- Dynamically create next qualified status (e.g. 'QUALIFIED - Round 1')
  v_new_qualified_status := 'QUALIFIED - ' || COALESCE(v_match.phase, 'Round 1');
  
  -- Advance winners and increment round
  UPDATE players 
  SET 
    previous_status = status, 
    status = v_new_qualified_status,
    current_round = COALESCE(current_round, 1) + 1
  WHERE id = ANY(v_winners);
  
  -- Eliminate losers
  UPDATE players 
  SET 
    previous_status = status, 
    status = CASE WHEN p_is_walkover THEN 'NO_SHOW' ELSE 'DISQUALIFIED' END 
  WHERE id = ANY(v_losers);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ==============================================================================
-- 5. REALTIME CONFIGURATION
-- ==============================================================================
-- Enables live Supabase postgres_changes subscriptions for Dashboard and Matches

ALTER TABLE players REPLICA IDENTITY FULL;
ALTER TABLE matches REPLICA IDENTITY FULL;
ALTER TABLE notifications REPLICA IDENTITY FULL;

DO $$
BEGIN
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE players;
  EXCEPTION WHEN duplicate_object THEN
    NULL;
  END;
  
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE matches;
  EXCEPTION WHEN duplicate_object THEN
    NULL;
  END;

  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE notifications;
  EXCEPTION WHEN duplicate_object THEN
    NULL;
  END;
END $$;

-- ==============================================================================
-- 6. ROW LEVEL SECURITY (RLS) POLICIES
-- ==============================================================================
-- SportsOps allows mobile QR check-in & player dashboard updates without requiring
-- players to create auth accounts. Committee access is governed by Supabase Auth.

ALTER TABLE events ENABLE ROW LEVEL SECURITY;
ALTER TABLE players ENABLE ROW LEVEL SECURITY;
ALTER TABLE matches ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if any to avoid errors on re-run
DROP POLICY IF EXISTS "Allow public read events" ON events;
DROP POLICY IF EXISTS "Allow authenticated insert events" ON events;
DROP POLICY IF EXISTS "Allow authenticated update events" ON events;
DROP POLICY IF EXISTS "Allow authenticated delete events" ON events;

DROP POLICY IF EXISTS "Allow public read players" ON players;
DROP POLICY IF EXISTS "Allow public insert players" ON players;
DROP POLICY IF EXISTS "Allow public update players" ON players;
DROP POLICY IF EXISTS "Allow public delete players" ON players;

DROP POLICY IF EXISTS "Allow public read matches" ON matches;
DROP POLICY IF EXISTS "Allow public insert matches" ON matches;
DROP POLICY IF EXISTS "Allow public update matches" ON matches;
DROP POLICY IF EXISTS "Allow public delete matches" ON matches;

DROP POLICY IF EXISTS "Allow public read notifications" ON notifications;
DROP POLICY IF EXISTS "Allow public insert notifications" ON notifications;
DROP POLICY IF EXISTS "Allow public update notifications" ON notifications;

-- Permissive policies for match-day operations:
CREATE POLICY "Allow public read events" ON events FOR SELECT USING (true);
CREATE POLICY "Allow authenticated insert events" ON events FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow authenticated update events" ON events FOR UPDATE USING (true);
CREATE POLICY "Allow authenticated delete events" ON events FOR DELETE USING (true);

CREATE POLICY "Allow public read players" ON players FOR SELECT USING (true);
CREATE POLICY "Allow public insert players" ON players FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow public update players" ON players FOR UPDATE USING (true);
CREATE POLICY "Allow public delete players" ON players FOR DELETE USING (true);

CREATE POLICY "Allow public read matches" ON matches FOR SELECT USING (true);
CREATE POLICY "Allow public insert matches" ON matches FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow public update matches" ON matches FOR UPDATE USING (true);
CREATE POLICY "Allow public delete matches" ON matches FOR DELETE USING (true);

CREATE POLICY "Allow public read notifications" ON notifications FOR SELECT USING (true);
CREATE POLICY "Allow public insert notifications" ON notifications FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow public update notifications" ON notifications FOR UPDATE USING (true);

-- ==============================================================================
-- 7. PLAYER SCHEDULE CONFLICT TRIGGER
-- ==============================================================================
CREATE OR REPLACE FUNCTION check_player_schedule_conflict()
RETURNS TRIGGER AS $$
DECLARE
  v_conflict_match_id UUID;
  v_new_players UUID[];
BEGIN
  IF NEW.status IN ('CANCELLED', 'COMPLETED', 'WALKOVER') THEN
    RETURN NEW;
  END IF;

  v_new_players := ARRAY[
    NEW.team1_p1_id, NEW.team1_p2_id,
    NEW.team2_p1_id, NEW.team2_p2_id
  ];

  SELECT id INTO v_conflict_match_id
  FROM matches
  WHERE event_id = NEW.event_id
    AND scheduled_time = NEW.scheduled_time
    AND status NOT IN ('CANCELLED', 'COMPLETED', 'WALKOVER')
    AND (NEW.id IS NULL OR id <> NEW.id)
    AND (
      team1_p1_id = ANY(v_new_players) OR
      (team1_p2_id IS NOT NULL AND team1_p2_id = ANY(v_new_players)) OR
      team2_p1_id = ANY(v_new_players) OR
      (team2_p2_id IS NOT NULL AND team2_p2_id = ANY(v_new_players))
    )
  LIMIT 1;

  IF v_conflict_match_id IS NOT NULL THEN
    RAISE EXCEPTION 'Player conflict: one or more players already have a match scheduled at this time.'
      USING ERRCODE = '23P01';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_prevent_player_schedule_conflict ON matches;
CREATE TRIGGER trg_prevent_player_schedule_conflict
BEFORE INSERT OR UPDATE OF scheduled_time, team1_p1_id, team1_p2_id, team2_p1_id, team2_p2_id, status
ON matches
FOR EACH ROW
EXECUTE FUNCTION check_player_schedule_conflict();

-- ==============================================================================
-- 8. DEFAULT SEED EVENT
-- ==============================================================================
-- Creates a default event so the dashboard loads immediately on initial setup

INSERT INTO events (name, sport, event_date, venue)
VALUES ('Annual Sports Day 2026', 'All Sports', CURRENT_DATE, 'Main Sports Arena')
ON CONFLICT DO NOTHING;

-- Reload PostgREST schema cache
NOTIFY pgrst, 'reload schema';
