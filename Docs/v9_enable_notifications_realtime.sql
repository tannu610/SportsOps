-- ==============================================================================
-- BUG-001: Enable Realtime for Player Notifications
-- Run this in the Supabase SQL Editor
-- ==============================================================================

-- 1. Ensure REPLICA IDENTITY is set to FULL on notifications table
ALTER TABLE notifications REPLICA IDENTITY FULL;

-- 2. Add notifications to the supabase_realtime publication
DO $$
BEGIN
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE notifications;
  EXCEPTION WHEN duplicate_object THEN
    NULL;
  END;
END $$;

-- 3. Reload schema cache for PostgREST
NOTIFY pgrst, 'reload schema';
