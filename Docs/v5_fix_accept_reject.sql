-- Fix player accept/reject to NOT overwrite previous_status, so it retains the pre-match state (like QUALIFIED)

CREATE OR REPLACE FUNCTION player_accept_match(p_player_id UUID, p_match_id UUID) RETURNS BOOLEAN AS $$
DECLARE
  v_match_exists BOOLEAN;
BEGIN
  SELECT EXISTS(SELECT 1 FROM matches WHERE id = p_match_id) INTO v_match_exists;
  
  IF NOT v_match_exists THEN
    RAISE EXCEPTION 'This match has been canceled or rescheduled by the committee.';
  END IF;
  
  -- Do NOT touch previous_status here, so rollback skips over 'CALLED' directly to 'PRESENT' or 'QUALIFIED'
  UPDATE players SET status = 'AVAILABLE' WHERE id = p_player_id;
  
  RETURN TRUE;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION player_reject_match(p_player_id UUID, p_match_id UUID) RETURNS BOOLEAN AS $$
BEGIN
  -- Do NOT touch previous_status here
  UPDATE players SET status = 'UNAVAILABLE' WHERE id = p_player_id;
  
  UPDATE matches 
  SET status = 'PLAYER_UNAVAILABLE'
  WHERE id = p_match_id AND status IN ('SCHEDULED', 'NOTIFIED', 'DELAYED');
  
  RETURN TRUE;
END;
$$ LANGUAGE plpgsql;

NOTIFY pgrst, 'reload schema';
