-- ============================================================
-- 019_notifications_realtime.sql
-- Run AFTER 018_booking_theme_blue.sql.
--
-- The notifications table (defined in 001) drives the dashboard
-- notification bell. Add it to the supabase_realtime publication so
-- the client receives live INSERTs (new appointment requests) and the
-- unread badge updates without a refresh. RLS still applies to realtime
-- streams, so each admin only receives their own notifications.
-- ============================================================

ALTER PUBLICATION supabase_realtime ADD TABLE notifications;
