-- ==============================================================================
-- BUG-006: Prevent Player Schedule Conflicts
-- Run this in the Supabase SQL Editor
-- ==============================================================================

-- Trigger function to ensure no player has more than one active match scheduled at the same time
CREATE OR REPLACE FUNCTION check_player_schedule_conflict()
RETURNS TRIGGER AS $$
DECLARE
  v_conflict_match_id UUID;
  v_new_players UUID[];
BEGIN
  -- Only validate active matches (skip completed, walkover, or cancelled matches)
  IF NEW.status IN ('CANCELLED', 'COMPLETED', 'WALKOVER') THEN
    RETURN NEW;
  END IF;

  v_new_players := ARRAY[
    NEW.team1_p1_id, NEW.team1_p2_id,
    NEW.team2_p1_id, NEW.team2_p2_id
  ];

  -- Search for existing active match at the same time in the same event having any overlapping player
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

NOTIFY pgrst, 'reload schema';
