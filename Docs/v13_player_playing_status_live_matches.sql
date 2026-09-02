-- ==============================================================================
-- MIGRATION v13: Live Match Transition - Set Player Status to PLAYING
-- ==============================================================================
-- 1. When a match starts LIVE, its status becomes 'LIVE' and all participating
--    players transition to 'PLAYING' with previous_status preserved.
-- 2. PLAYING players are temporarily unavailable and cannot be scheduled for any other match.
-- 3. When the match completes, players who were PLAYING return to PRESENT (if checked in).

CREATE OR REPLACE FUNCTION start_match_live(p_match_id UUID)
RETURNS VOID AS $$
DECLARE
  v_match RECORD;
  v_player_ids UUID[];
BEGIN
  SELECT * INTO v_match FROM matches WHERE id = p_match_id FOR UPDATE;
  IF NOT FOUND THEN RETURN; END IF;

  v_player_ids := ARRAY[
    v_match.team1_p1_id,
    v_match.team1_p2_id,
    v_match.team2_p1_id,
    v_match.team2_p2_id
  ];

  UPDATE matches 
  SET status = 'LIVE'
  WHERE id = p_match_id;

  UPDATE players 
  SET 
    previous_status = status,
    status = 'PLAYING'
  WHERE id = ANY(v_player_ids);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
