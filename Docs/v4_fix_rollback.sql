CREATE OR REPLACE FUNCTION call_players_for_match(p_player_ids UUID[]) RETURNS VOID AS $$
BEGIN
  -- Safely push their current status into previous_status before updating to CALLED
  UPDATE players 
  SET previous_status = status, status = 'CALLED' 
  WHERE id = ANY(p_player_ids);
END;
$$ LANGUAGE plpgsql;

NOTIFY pgrst, 'reload schema';
