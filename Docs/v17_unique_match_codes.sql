-- ==============================================================================
-- MIGRATION v17: Unique Human-Readable Match Code for All Matches
-- ==============================================================================
-- 1. Adds match_code column to matches table if not exists.
-- 2. Creates unique index idx_matches_match_code to enforce global uniqueness.
-- 3. Idempotently backfills unique 6-character Match Codes for all existing matches
--    where match_code is NULL, empty, or '-'.
-- 4. Reloads PostgREST schema cache.
-- ==============================================================================

-- 1. Ensure match_code column exists
ALTER TABLE matches ADD COLUMN IF NOT EXISTS match_code TEXT;

-- 2. Ensure unique index for match_code (allows NULL for legacy matches until backfilled)
CREATE UNIQUE INDEX IF NOT EXISTS idx_matches_match_code ON matches(match_code) WHERE match_code IS NOT NULL;

-- 3. Idempotent PL/pgSQL backfill for existing matches without a Match Code
DO $$
DECLARE
  rec RECORD;
  new_code TEXT;
  chars TEXT := '2346789ABCDEFGHJKLMNPQRTUVWXYZ';
  collision_found BOOLEAN;
  i INTEGER;
  extracted_meta TEXT;
BEGIN
  FOR rec IN 
    SELECT id, score, match_code
    FROM matches 
    WHERE match_code IS NULL OR match_code = '' OR match_code = '-' 
  LOOP
    extracted_meta := NULL;

    -- Check if match_code was stored in score JSON or MC: prefix
    IF rec.score IS NOT NULL AND rec.score != '' THEN
      IF rec.score LIKE 'MC:%' THEN
        extracted_meta := substring(rec.score from 4);
      ELSIF rec.score LIKE '{%}' THEN
        BEGIN
          extracted_meta := (rec.score::jsonb)->>'match_code';
        EXCEPTION WHEN OTHERS THEN
          extracted_meta := NULL;
        END;
      END IF;
    END IF;

    IF extracted_meta IS NOT NULL AND length(extracted_meta) = 6 THEN
      new_code := upper(extracted_meta);
    ELSE
      -- Generate new 6-character unique code
      LOOP
        new_code := '';
        FOR i IN 1..6 LOOP
          new_code := new_code || substr(chars, floor(random() * length(chars) + 1)::integer, 1);
        END LOOP;
        
        SELECT EXISTS(SELECT 1 FROM matches WHERE match_code = new_code) INTO collision_found;
        EXIT WHEN NOT collision_found;
      END LOOP;
    END IF;

    -- Update row with new match_code
    UPDATE matches 
    SET match_code = new_code
    WHERE id = rec.id;
  END LOOP;
END $$;

-- 4. Reload PostgREST schema cache
NOTIFY pgrst, 'reload schema';
