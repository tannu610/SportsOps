-- ==============================================================================
-- MIGRATION v15: Persistent Player Codes for All Players & Safe Backfill
-- ==============================================================================
-- 1. Ensures player_code column exists on players table.
-- 2. Ensures unique index idx_players_player_code exists to prevent collisions.
-- 3. Idempotently backfills unique 'SO-XXXXXX' Player Codes for all existing
--    players where player_code is NULL, empty, or '-'.
-- 4. Syncs push_subscription._metadata.player_code for schema-cache fallback.
-- 5. Reloads PostgREST schema cache.
-- ==============================================================================

-- 1. Ensure player_code column exists
ALTER TABLE players ADD COLUMN IF NOT EXISTS player_code TEXT;

-- 2. Ensure unique index for player_code (partial index allowing NULL for legacy imported records)
CREATE UNIQUE INDEX IF NOT EXISTS idx_players_player_code ON players(player_code) WHERE player_code IS NOT NULL;

-- 3. Safe, idempotent backfill for missing player codes
DO $$
DECLARE
  rec RECORD;
  new_code TEXT;
  chars TEXT := '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
  collision_found BOOLEAN;
  i INTEGER;
BEGIN
  FOR rec IN 
    SELECT id, employee_id, push_subscription 
    FROM players 
    WHERE player_code IS NULL OR player_code = '' OR player_code = '-' 
  LOOP
    -- Check if code was already stored in push_subscription metadata
    IF rec.push_subscription IS NOT NULL 
       AND rec.push_subscription ? '_metadata' 
       AND rec.push_subscription->_metadata ? 'player_code' 
       AND (rec.push_subscription->_metadata->>'player_code') != '-' 
       AND (rec.push_subscription->_metadata->>'player_code') != '' THEN
      new_code := rec.push_subscription->_metadata->>'player_code';
    ELSE
      -- Generate new unique code in SO-XXXXXX format
      LOOP
        new_code := 'SO-';
        FOR i IN 1..6 LOOP
          new_code := new_code || substr(chars, floor(random() * length(chars) + 1)::integer, 1);
        END LOOP;
        
        -- Check collision against existing player_code in players table
        SELECT EXISTS(SELECT 1 FROM players WHERE player_code = new_code) INTO collision_found;
        EXIT WHEN NOT collision_found;
      END LOOP;
    END IF;

    -- Update row with new player_code and sync push_subscription metadata
    UPDATE players
    SET 
      player_code = new_code,
      push_subscription = jsonb_set(
        COALESCE(push_subscription, '{}'::jsonb),
        '{_metadata,player_code}',
        to_jsonb(new_code)
      )
    WHERE id = rec.id;
  END LOOP;
END $$;

-- 4. Reload PostgREST schema cache
NOTIFY pgrst, 'reload schema';
