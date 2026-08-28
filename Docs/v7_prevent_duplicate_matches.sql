-- BUG-006: Authoritative duplicate-match protection.
-- Run this in the Supabase SQL Editor.
-- Covers both Singles and Doubles, and excludes finished matches (CANCELLED/COMPLETED/WALKOVER).

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

NOTIFY pgrst, 'reload schema';
