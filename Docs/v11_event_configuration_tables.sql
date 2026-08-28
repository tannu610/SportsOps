-- ==============================================================================
-- Migration v11: Event Configuration Relational Database Layer
-- Tables: event_sports, event_categories, event_facilities
-- Run this in the Supabase SQL Editor
-- ==============================================================================

-- 1. Ensure events table has required columns
ALTER TABLE events ADD COLUMN IF NOT EXISTS configuration JSONB DEFAULT '{}'::jsonb;

-- 2. Create event_sports Table
-- Stores the sports associated with an event
CREATE TABLE IF NOT EXISTS event_sports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  sport TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()),
  CONSTRAINT uq_event_sport UNIQUE (event_id, sport)
);

-- 3. Create event_categories Table
-- Stores categories for each sport under an event
CREATE TABLE IF NOT EXISTS event_categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_sport_id UUID NOT NULL REFERENCES event_sports(id) ON DELETE CASCADE,
  category TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()),
  CONSTRAINT uq_event_sport_category UNIQUE (event_sport_id, category)
);

-- 4. Create event_facilities Table
-- Stores the physical facilities (e.g. courts, tables, grounds) for each sport
CREATE TABLE IF NOT EXISTS event_facilities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_sport_id UUID NOT NULL REFERENCES event_sports(id) ON DELETE CASCADE,
  facility_type TEXT NOT NULL,
  facility_count INTEGER NOT NULL CHECK (facility_count > 0),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()),
  CONSTRAINT uq_event_sport_facility UNIQUE (event_sport_id)
);

-- 5. Performance Indexes
CREATE INDEX IF NOT EXISTS idx_event_sports_event_id ON event_sports(event_id);
CREATE INDEX IF NOT EXISTS idx_event_categories_sport_id ON event_categories(event_sport_id);
CREATE INDEX IF NOT EXISTS idx_event_facilities_sport_id ON event_facilities(event_sport_id);

-- 6. Row Level Security (RLS)
ALTER TABLE event_sports ENABLE ROW LEVEL SECURITY;
ALTER TABLE event_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE event_facilities ENABLE ROW LEVEL SECURITY;

-- Allow public read access (for player views, court management, and admin dashboard)
DROP POLICY IF EXISTS "Public read event_sports" ON event_sports;
CREATE POLICY "Public read event_sports" ON event_sports FOR SELECT USING (true);

DROP POLICY IF EXISTS "Public read event_categories" ON event_categories;
CREATE POLICY "Public read event_categories" ON event_categories FOR SELECT USING (true);

DROP POLICY IF EXISTS "Public read event_facilities" ON event_facilities;
CREATE POLICY "Public read event_facilities" ON event_facilities FOR SELECT USING (true);

-- Allow authenticated / service role full access
DROP POLICY IF EXISTS "Service role full access event_sports" ON event_sports;
CREATE POLICY "Service role full access event_sports" ON event_sports FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Service role full access event_categories" ON event_categories;
CREATE POLICY "Service role full access event_categories" ON event_categories FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Service role full access event_facilities" ON event_facilities;
CREATE POLICY "Service role full access event_facilities" ON event_facilities FOR ALL USING (true) WITH CHECK (true);

-- 7. Realtime Publication
ALTER TABLE event_sports REPLICA IDENTITY FULL;
ALTER TABLE event_categories REPLICA IDENTITY FULL;
ALTER TABLE event_facilities REPLICA IDENTITY FULL;

DO $$
BEGIN
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE event_sports;
  EXCEPTION WHEN duplicate_object THEN
    NULL;
  END;

  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE event_categories;
  EXCEPTION WHEN duplicate_object THEN
    NULL;
  END;

  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE event_facilities;
  EXCEPTION WHEN duplicate_object THEN
    NULL;
  END;
END $$;

-- 8. Atomic Stored Procedure: save_event_configuration
-- Saves an event, sports, categories, and facilities in a single ACID transaction.
CREATE OR REPLACE FUNCTION save_event_configuration(
  p_event_id UUID,
  p_name TEXT,
  p_event_date DATE,
  p_venue TEXT,
  p_sports JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_event_id UUID;
  v_sport_key TEXT;
  v_sport_data JSONB;
  v_sport_id UUID;
  v_category TEXT;
  v_facility_type TEXT;
  v_facility_count INT;
  v_enabled_count INT := 0;
  v_summary_sports TEXT := '';
BEGIN
  -- Strict Validation
  IF p_name IS NULL OR trim(p_name) = '' THEN
    RAISE EXCEPTION 'Event Name is required';
  END IF;

  IF p_event_date IS NULL THEN
    RAISE EXCEPTION 'Event Date is required';
  END IF;

  IF p_venue IS NULL OR trim(p_venue) = '' THEN
    RAISE EXCEPTION 'Venue is required';
  END IF;

  IF p_sports IS NULL OR p_sports = '{}'::jsonb THEN
    RAISE EXCEPTION 'At least one sport is required';
  END IF;

  -- Count enabled sports
  FOR v_sport_key, v_sport_data IN SELECT * FROM jsonb_each(p_sports)
  LOOP
    IF (v_sport_data->>'enabled')::boolean = true THEN
      v_enabled_count := v_enabled_count + 1;
      IF v_summary_sports = '' THEN
        v_summary_sports := v_sport_key;
      ELSE
        v_summary_sports := v_summary_sports || ', ' || v_sport_key;
      END IF;

      -- Validate facility count
      v_facility_count := COALESCE((v_sport_data->>'facilityCount')::int, 0);
      IF v_facility_count <= 0 THEN
        RAISE EXCEPTION 'Facility count for % must be a positive integer', v_sport_key;
      END IF;

      -- Validate categories array
      IF jsonb_array_length(COALESCE(v_sport_data->'categories', '[]'::jsonb)) = 0 THEN
        RAISE EXCEPTION 'At least one category is required for sport: %', v_sport_key;
      END IF;
    END IF;
  END LOOP;

  IF v_enabled_count = 0 THEN
    RAISE EXCEPTION 'At least one sport must be selected and enabled';
  END IF;

  -- 1. Create or Update the Event record
  IF p_event_id IS NOT NULL AND EXISTS (SELECT 1 FROM events WHERE id = p_event_id) THEN
    UPDATE events
    SET name = trim(p_name),
        event_date = p_event_date,
        venue = trim(p_venue),
        sport = v_summary_sports,
        configuration = jsonb_build_object('sports', p_sports)
    WHERE id = p_event_id
    RETURNING id INTO v_event_id;
  ELSE
    INSERT INTO events (id, name, event_date, venue, sport, configuration)
    VALUES (
      COALESCE(p_event_id, gen_random_uuid()),
      trim(p_name),
      p_event_date,
      trim(p_venue),
      v_summary_sports,
      jsonb_build_object('sports', p_sports)
    )
    RETURNING id INTO v_event_id;
  END IF;

  -- 2. Clear old configuration for this event (cascades to categories and facilities)
  DELETE FROM event_sports WHERE event_id = v_event_id;

  -- 3. Insert each enabled sport, its facility, and categories
  FOR v_sport_key, v_sport_data IN SELECT * FROM jsonb_each(p_sports)
  LOOP
    IF (v_sport_data->>'enabled')::boolean = true THEN
      -- Insert event_sport
      INSERT INTO event_sports (event_id, sport)
      VALUES (v_event_id, v_sport_key)
      RETURNING id INTO v_sport_id;

      -- Insert event_facility
      v_facility_type := COALESCE(v_sport_data->>'facilityType', 'Courts');
      v_facility_count := (v_sport_data->>'facilityCount')::int;

      INSERT INTO event_facilities (event_sport_id, facility_type, facility_count)
      VALUES (v_sport_id, v_facility_type, v_facility_count);

      -- Insert event_categories
      FOR v_category IN SELECT jsonb_array_elements_text(v_sport_data->'categories')
      LOOP
        IF trim(v_category) <> '' THEN
          INSERT INTO event_categories (event_sport_id, category)
          VALUES (v_sport_id, trim(v_category))
          ON CONFLICT (event_sport_id, category) DO NOTHING;
        END IF;
      END LOOP;
    END IF;
  END LOOP;

  -- Notify schema reload
  NOTIFY pgrst, 'reload schema';

  RETURN jsonb_build_object(
    'success', true,
    'event_id', v_event_id,
    'name', trim(p_name),
    'sports_count', v_enabled_count
  );
END;
$$;

NOTIFY pgrst, 'reload schema';
