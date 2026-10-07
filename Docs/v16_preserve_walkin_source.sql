-- ==============================================================================
-- MIGRATION v16: Preserve Match-Day Walk-In Player Source Tracking
-- ==============================================================================
-- 1. Ensures native source column exists on players table (DEFAULT 'IMPORT').
-- 2. Preserves WALK-IN source from push_subscription._metadata if present.
-- 3. Ensures index idx_players_source exists for query performance.
-- 4. Reloads PostgREST schema cache.
-- ==============================================================================

-- 1. Ensure source column exists
ALTER TABLE players ADD COLUMN IF NOT EXISTS source TEXT DEFAULT 'IMPORT';

-- 2. Backfill existing records from metadata without overwriting walk-in players
UPDATE players
SET source = CASE
  WHEN push_subscription IS NOT NULL
    AND push_subscription ? '_metadata'
    AND (push_subscription->_metadata->>'source') = 'WALK-IN'
  THEN 'WALK-IN'
  ELSE 'IMPORT'
END
WHERE source IS NULL;

-- 3. Create index for source filtering
CREATE INDEX IF NOT EXISTS idx_players_source ON players(source);

-- 4. Reload PostgREST schema cache
NOTIFY pgrst, 'reload schema';
