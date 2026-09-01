-- ==============================================================================
-- MIGRATION v12: Match Completion Workflow - Return Checked-in Players to PRESENT
-- ==============================================================================
-- In V1, SportsOps must NOT decide tournament progression (QUALIFIED) or elimination (DISQUALIFIED).
-- When a match is completed:
-- 1. Match status is set to 'COMPLETED' (or 'WALKOVER')
-- 2. If the player checked in before the match, their status returns to PRESENT.
-- 3. If the player had not checked in, preserve their existing attendance state (REGISTERED / ABSENT).
-- 4. The court/play area becomes FREE and players remain selectable for future matches.

CREATE OR REPLACE FUNCTION complete_match_workflow(
  p_match_id UUID, 
  p_winning_team TEXT, -- 'team1' or 'team2'
  p_is_walkover BOOLEAN DEFAULT FALSE
) RETURNS VOID AS $$
DECLARE
  v_match RECORD;
  v_all_players UUID[];
BEGIN
  SELECT * INTO v_match FROM matches WHERE id = p_match_id FOR UPDATE;
  IF NOT FOUND THEN RETURN; END IF;
  
  v_all_players := ARRAY[v_match.team1_p1_id, v_match.team1_p2_id, v_match.team2_p1_id, v_match.team2_p2_id];

  UPDATE matches 
  SET status = CASE WHEN p_is_walkover THEN 'WALKOVER' ELSE 'COMPLETED' END 
  WHERE id = p_match_id;
  
  -- Reset participating players:
  -- - Checked-in players return to PRESENT
  -- - Non-checked-in players preserve existing attendance state (REGISTERED / ABSENT)
  -- - Walkover losers are marked NO_SHOW
  -- - Never assign QUALIFIED or DISQUALIFIED
  UPDATE players 
  SET 
    previous_status = status, 
    status = CASE 
      WHEN p_is_walkover AND id = ANY(
        CASE WHEN p_winning_team = 'team1' 
          THEN ARRAY[v_match.team2_p1_id, v_match.team2_p2_id]
          ELSE ARRAY[v_match.team1_p1_id, v_match.team1_p2_id]
        END
      ) THEN 'NO_SHOW'
      WHEN check_in_time IS NOT NULL OR previous_status IN ('PRESENT', 'AVAILABLE') THEN 'PRESENT'
      ELSE COALESCE(NULLIF(previous_status, 'CALLED'), 'REGISTERED')
    END
  WHERE id = ANY(v_all_players);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
