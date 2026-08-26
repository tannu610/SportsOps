-- 1. Add Phase to Matches
ALTER TABLE matches ADD COLUMN IF NOT EXISTS phase TEXT DEFAULT 'Round 1';

-- 2. Update the delete_match_and_rollback to forcefully revert ALL players regardless of their current state
CREATE OR REPLACE FUNCTION delete_match_and_rollback(p_match_id UUID) RETURNS VOID AS $$
DECLARE
  v_match RECORD;
  v_player_ids UUID[];
BEGIN
  SELECT * INTO v_match FROM matches WHERE id = p_match_id FOR UPDATE;
  IF NOT FOUND THEN RETURN; END IF;
  
  v_player_ids := ARRAY[v_match.team1_p1_id, v_match.team1_p2_id, v_match.team2_p1_id, v_match.team2_p2_id];
  
  -- Forcefully revert all players in this match back to their previous status
  UPDATE players 
  SET status = COALESCE(previous_status, 'PRESENT')
  WHERE id = ANY(v_player_ids);
  
  DELETE FROM matches WHERE id = p_match_id;
END;
$$ LANGUAGE plpgsql;

-- 3. Update the Match Completion workflow to dynamically assign QUALIFIED - [Phase]
CREATE OR REPLACE FUNCTION complete_match_workflow(
  p_match_id UUID, p_winning_team TEXT, p_is_walkover BOOLEAN
) RETURNS VOID AS $$
DECLARE
  v_match RECORD;
  v_winners UUID[];
  v_losers UUID[];
  v_new_qualified_status TEXT;
BEGIN
  SELECT * INTO v_match FROM matches WHERE id = p_match_id FOR UPDATE;
  
  IF p_winning_team = 'team1' THEN
    v_winners := ARRAY[v_match.team1_p1_id, v_match.team1_p2_id];
    v_losers := ARRAY[v_match.team2_p1_id, v_match.team2_p2_id];
  ELSE
    v_winners := ARRAY[v_match.team2_p1_id, v_match.team2_p2_id];
    v_losers := ARRAY[v_match.team1_p1_id, v_match.team1_p2_id];
  END IF;

  UPDATE matches SET status = CASE WHEN p_is_walkover THEN 'WALKOVER' ELSE 'COMPLETED' END WHERE id = p_match_id;
  
  -- Dynamically create the new status (e.g. 'QUALIFIED - Round 1')
  v_new_qualified_status := 'QUALIFIED - ' || COALESCE(v_match.phase, 'Round 1');
  
  -- Upgrade winners
  UPDATE players SET previous_status = status, status = v_new_qualified_status WHERE id = ANY(v_winners);
  
  -- Eliminate losers
  UPDATE players SET previous_status = status, status = CASE WHEN p_is_walkover THEN 'NO_SHOW' ELSE 'DISQUALIFIED' END WHERE id = ANY(v_losers);
END;
$$ LANGUAGE plpgsql;

NOTIFY pgrst, 'reload schema';
