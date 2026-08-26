-- 1. Drop existing restrictive constraint and support Multi-Sport Registration
ALTER TABLE players DROP CONSTRAINT IF EXISTS players_event_id_employee_id_key;
ALTER TABLE players ADD CONSTRAINT players_event_id_emp_sport_key UNIQUE(event_id, employee_id, sport);

-- 2. Add state tracking fields to players
ALTER TABLE players ADD COLUMN IF NOT EXISTS previous_status TEXT;
ALTER TABLE players ADD COLUMN IF NOT EXISTS current_round INTEGER DEFAULT 1;

-- 3. Transactional Rollback for Match Deletion
CREATE OR REPLACE FUNCTION delete_match_and_rollback(p_match_id UUID) RETURNS VOID AS $$
DECLARE
  v_match RECORD;
  v_player_ids UUID[];
BEGIN
  -- Lock the match to prevent race conditions
  SELECT * INTO v_match FROM matches WHERE id = p_match_id FOR UPDATE;
  
  IF NOT FOUND THEN
    RETURN; -- Match was already deleted
  END IF;
  
  -- Gather all players from the match
  v_player_ids := ARRAY[
    v_match.team1_p1_id, v_match.team1_p2_id, 
    v_match.team2_p1_id, v_match.team2_p2_id
  ];
  
  -- Safe rollback: Only revert players if they are currently tied to this match's waiting states
  UPDATE players 
  SET status = COALESCE(previous_status, 'PRESENT')
  WHERE id = ANY(v_player_ids)
  AND status IN ('CALLED', 'AVAILABLE', 'UNAVAILABLE', 'PLAYING');
  
  -- Proceed to delete the match
  DELETE FROM matches WHERE id = p_match_id;
END;
$$ LANGUAGE plpgsql;


-- 4. Race-Condition Proof Player Acceptance
CREATE OR REPLACE FUNCTION player_accept_match(p_player_id UUID, p_match_id UUID) RETURNS BOOLEAN AS $$
DECLARE
  v_match_exists BOOLEAN;
BEGIN
  -- Strictly verify the match hasn't been deleted or canceled by the committee
  SELECT EXISTS(SELECT 1 FROM matches WHERE id = p_match_id) INTO v_match_exists;
  
  IF NOT v_match_exists THEN
    -- If committee deleted it exactly when they clicked, gracefully reject
    RAISE EXCEPTION 'This match has been canceled or rescheduled by the committee.';
  END IF;
  
  UPDATE players 
  SET 
    previous_status = status,
    status = 'AVAILABLE' 
  WHERE id = p_player_id;
  
  RETURN TRUE;
END;
$$ LANGUAGE plpgsql;


-- 5. Match Rejection logic
CREATE OR REPLACE FUNCTION player_reject_match(p_player_id UUID, p_match_id UUID) RETURNS BOOLEAN AS $$
BEGIN
  UPDATE players 
  SET 
    previous_status = status,
    status = 'UNAVAILABLE' 
  WHERE id = p_player_id;
  
  -- Flag the match so the committee dashboard immediately alerts them
  UPDATE matches 
  SET status = 'PLAYER_UNAVAILABLE'
  WHERE id = p_match_id AND status IN ('SCHEDULED', 'NOTIFIED', 'DELAYED');
  
  RETURN TRUE;
END;
$$ LANGUAGE plpgsql;


-- 6. Centralized Match Completion Workflow
CREATE OR REPLACE FUNCTION complete_match_workflow(
  p_match_id UUID, 
  p_winning_team TEXT, -- 'team1' or 'team2'
  p_is_walkover BOOLEAN
) RETURNS VOID AS $$
DECLARE
  v_match RECORD;
  v_winners UUID[];
  v_losers UUID[];
BEGIN
  SELECT * INTO v_match FROM matches WHERE id = p_match_id FOR UPDATE;
  
  IF p_winning_team = 'team1' THEN
    v_winners := ARRAY[v_match.team1_p1_id, v_match.team1_p2_id];
    v_losers := ARRAY[v_match.team2_p1_id, v_match.team2_p2_id];
  ELSE
    v_winners := ARRAY[v_match.team2_p1_id, v_match.team2_p2_id];
    v_losers := ARRAY[v_match.team1_p1_id, v_match.team1_p2_id];
  END IF;

  -- Update Match State
  UPDATE matches 
  SET status = CASE WHEN p_is_walkover THEN 'WALKOVER' ELSE 'COMPLETED' END
  WHERE id = p_match_id;

  -- Update Winners (Increment Round)
  UPDATE players 
  SET 
    previous_status = status,
    status = 'QUALIFIED',
    current_round = current_round + 1
  WHERE id = ANY(v_winners);

  -- Update Losers (Eliminated or No-Show)
  UPDATE players 
  SET 
    previous_status = status,
    status = CASE WHEN p_is_walkover THEN 'NO_SHOW' ELSE 'DISQUALIFIED' END
  WHERE id = ANY(v_losers);
  
END;
$$ LANGUAGE plpgsql;

-- Tell PostgREST to reload cache
NOTIFY pgrst, 'reload schema';
