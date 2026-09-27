-- ==============================================================================
-- MIGRATION v14: Match-Day Real-Time Player Self-Registration
-- ==============================================================================
-- 1. Adds dedicated columns to players table:
--    - player_code: Unique persistent SportsOps identifier (e.g. SO-7K92PX).
--    - gender: Stored player attribute (Male, Female, Other, Prefer not to say).
--    - source: Distinguishes 'IMPORT' vs 'WALK-IN'.
--    - email: Optional player email address.
--    - transport_required: Optional match-day transport requirement flag.
-- 2. Backfills existing records with source = 'IMPORT'.
-- 3. Creates unique index for player_code and performance indexes for source & gender.
-- 4. Reloads PostgREST schema cache.
-- ==============================================================================

-- 1. Add dedicated player attributes
ALTER TABLE players ADD COLUMN IF NOT EXISTS player_code TEXT;
ALTER TABLE players ADD COLUMN IF NOT EXISTS gender TEXT;
ALTER TABLE players ADD COLUMN IF NOT EXISTS source TEXT DEFAULT 'IMPORT';
ALTER TABLE players ADD COLUMN IF NOT EXISTS email TEXT;
ALTER TABLE players ADD COLUMN IF NOT EXISTS transport_required BOOLEAN DEFAULT FALSE;

-- 2. Backfill existing player registrations to ensure source = 'IMPORT'
UPDATE players SET source = 'IMPORT' WHERE source IS NULL;

-- 3. Unique index for player_code (partial index allowing NULL for legacy imported records)
CREATE UNIQUE INDEX IF NOT EXISTS idx_players_player_code ON players(player_code) WHERE player_code IS NOT NULL;

-- 4. Indexes for filtering and fast queries
CREATE INDEX IF NOT EXISTS idx_players_source ON players(source);
CREATE INDEX IF NOT EXISTS idx_players_gender ON players(gender);

-- 5. Reload PostgREST schema cache
NOTIFY pgrst, 'reload schema';
