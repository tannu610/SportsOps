-- ==============================================================================
-- Migration v10: Event Configuration (Sports, Categories, Facilities)
-- Run this in the Supabase SQL Editor
-- ==============================================================================

-- 1. Add configuration JSONB column to events table to store dynamic sports,
-- categories, and facility allocations.
ALTER TABLE events ADD COLUMN IF NOT EXISTS configuration JSONB DEFAULT '{}'::jsonb;

-- 2. Notify PostgREST to reload schema cache
NOTIFY pgrst, 'reload schema';
