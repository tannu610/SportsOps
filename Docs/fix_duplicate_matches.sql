-- ==============================================================================
-- Migration: Add duplicate match protection index
-- Run this in Supabase SQL Editor
-- ==============================================================================

-- 1. Create partial unique index on active matches
-- This guarantees that the exact same match cannot be inserted twice
-- while an identical active match already exists.
-- It covers both Singles (NULL team1_p2/team2_p2) and Doubles.
-- Finished matches (CANCELLED, COMPLETED, WALKOVER) are excluded so rematches or next rounds are not blocked.

CREATE UNIQUE INDEX IF NOT EXISTS matches_unique_active_details_idx ON matches (
  event_id,
  sport,
  COALESCE(category, 'NA'),
  COALESCE(phase, 'Round 1'),
  playing_area,
  scheduled_time,
  team1_p1_id,
  COALESCE(team1_p2_id, '00000000-0000-0000-0000-000000000000'::uuid),
  team2_p1_id,
  COALESCE(team2_p2_id, '00000000-0000-0000-0000-000000000000'::uuid)
)
WHERE status NOT IN ('CANCELLED', 'COMPLETED', 'WALKOVER');

-- Tell PostgREST to reload schema cache
NOTIFY pgrst, 'reload schema';
