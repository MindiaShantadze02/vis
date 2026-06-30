-- ============================================================
-- 047_reservation_otp_guard.sql
-- Run AFTER 046_public_org_vertical.sql.
--
-- restaurant_reservations (045) is open to anon INSERT (the public booking
-- page writes directly, mirroring appointments). Without a gate, a caller could
-- POST a reservation straight to the API and skip the SMS OTP the UI enforces.
--
-- enforce_booking_verification() (030) already keys off NEW.org_id and
-- NEW.customer_id — both present on restaurant_reservations — and exempts
-- org-member (admin) inserts. So we simply attach the SAME function as a
-- BEFORE INSERT trigger here. No function changes; no impact on appointments.
-- ============================================================

CREATE TRIGGER trg_enforce_reservation_verification
  BEFORE INSERT ON restaurant_reservations
  FOR EACH ROW
  EXECUTE FUNCTION enforce_booking_verification();
