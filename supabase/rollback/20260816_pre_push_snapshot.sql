-- ============================================================
-- Pre-push snapshot — captured 2026-08-16T12:54:21Z, project dnmecnpugjxkjonqsfxx
--
-- Taken immediately before pushing the five backlogged migrations:
--   20260812120000_min_service_price      (reprices every service < ₾5 to ₾5)
--   20260813120000_remove_recurring       (drops recurrence_series + series_id)
--   20260813130000_customer_sms_policy
--   20260814120000_remove_pending_status  (drops organisations.require_approval)
--   20260816120000_block_unpaid_bookings
--
-- Only the values below are NOT recoverable from the schema itself. Everything
-- else (dropped tables/columns) is recreatable from the migration history.
--
-- To roll a value back you must ALSO relax the constraint the migration added,
-- e.g. `ALTER TABLE services DROP CONSTRAINT services_price_min;` before
-- restoring a ₾0 price, and re-add the column before restoring require_approval.
-- ============================================================

-- ── Service prices (47 rows, 11 orgs) ─────────────────────────
-- Most are e2e residue on the seed org ("Online consult NNNNNN"); the Georgian
-- names are real catalogue entries on two salon orgs.
UPDATE services SET price = 0.00 WHERE id = '128b3403-7d4b-4b25-9be4-e314b94d42dd';  -- 654654
UPDATE services SET price = 0.00 WHERE id = '18f4ef68-ebb3-4882-9aef-7dee9e7ef464';  -- დასდა
UPDATE services SET price = 0.00 WHERE id = '1d101fa2-cbb8-4277-a353-f1a68f5a6d36';  -- tr
UPDATE services SET price = 0.00 WHERE id = '1e7b4df4-0e52-4353-88d0-1fa02c6b0827';  -- Online consult 444746
UPDATE services SET price = 0.00 WHERE id = '1e8bddf1-d9b4-4d83-836a-5addb75e6dc1';  -- Online consult 573871
UPDATE services SET price = 0.00 WHERE id = '37493c80-f55e-4949-b64c-2e517bfe54c9';  -- vvc
UPDATE services SET price = 0.00 WHERE id = '3dadeea5-a797-4805-b51d-5a672c8fd737';  -- Online consult 655703
UPDATE services SET price = 0.00 WHERE id = '3e00e9c1-6f54-466e-95d4-5d00c8fd7f6e';  -- რამე
UPDATE services SET price = 0.00 WHERE id = '3e8ad035-21ba-4558-a9eb-5b54125d175f';  -- თმის შეჭრა
UPDATE services SET price = 0.00 WHERE id = '402e4c4e-7a2e-4be3-bfd1-63d5f57b744b';  -- Online consult 527412
UPDATE services SET price = 0.00 WHERE id = '403c998a-2c5b-45cd-8e7f-373bc002cc6c';  -- Online consult 505884
UPDATE services SET price = 0.00 WHERE id = '4c432219-8bca-46d3-91f5-50c0cf995a29';  -- Online consult 794181
UPDATE services SET price = 0.00 WHERE id = '54aeef84-f697-4237-914f-dac27bd2e0be';  -- Online consult 537783
UPDATE services SET price = 0.00 WHERE id = '5a0bd56c-c95d-41ae-aaf6-3f287491f599';  -- Online consult 151702
UPDATE services SET price = 0.00 WHERE id = '5cf54484-daf9-4399-be64-9c3673dbbef0';  -- Online consult 572483
UPDATE services SET price = 0.00 WHERE id = '6ab96b97-d0a6-456a-9360-ccd85f667052';  -- რამე მეორე სერვისი
UPDATE services SET price = 0.00 WHERE id = '72b050f2-8036-4216-bb20-d4e03e76abf5';  -- Online consult 959671
UPDATE services SET price = 0.00 WHERE id = '732de323-0239-49b7-a60e-c341a2965a3b';  -- gfd
UPDATE services SET price = 0.00 WHERE id = '8247ec60-5b1a-49b3-82c1-28d6a344311e';  -- Online consult 543044
UPDATE services SET price = 0.00 WHERE id = '851dea5d-541e-4f08-bc83-643f77c4e7bc';  -- Online consult 373451
UPDATE services SET price = 0.00 WHERE id = '8aac448e-ee04-47e6-ba03-fec898a7c6a5';  -- Online consult 034519
UPDATE services SET price = 0.00 WHERE id = '92c377b7-2eca-4f7a-876a-06494989ced9';  -- Online consult 720795
UPDATE services SET price = 0.00 WHERE id = '98984ca2-2e99-46d8-a7d2-3d460c2cc65a';  -- Online consult 107926
UPDATE services SET price = 0.00 WHERE id = '9e8f9096-a9bc-4c32-a95e-37801875f3c2';  -- თმის შეღებვა
UPDATE services SET price = 0.00 WHERE id = 'a014fcf0-35a9-481c-a377-0608ae34e537';  -- Online consult 326809
UPDATE services SET price = 0.00 WHERE id = 'a1b13f06-f50a-4008-9233-7cd7c20725ef';  -- Online consult 728374
UPDATE services SET price = 0.00 WHERE id = 'a485461e-e9d9-4fb2-9ae3-9bf2d1355841';  -- io
UPDATE services SET price = 0.00 WHERE id = 'a774729a-e63f-4694-9261-9578bbc4656d';  -- Online consult 392840
UPDATE services SET price = 0.00 WHERE id = 'b0c33ff1-9cfe-4ef4-801e-d65afc73dbf0';  -- Online consult 699442
UPDATE services SET price = 0.00 WHERE id = 'b3cb2865-85ed-48db-b242-1af90d4a78c9';  -- Online consult 160810
UPDATE services SET price = 0.00 WHERE id = 'b80a8ec7-4966-4cce-99ab-f10306cbac2a';  -- Online consult 855282
UPDATE services SET price = 0.00 WHERE id = 'b9ec5825-b038-42b9-93ce-e61a054c8082';  -- Online consult 629561
UPDATE services SET price = 0.00 WHERE id = 'c23edfb5-298f-4240-b10a-9edd68df81e4';  -- თმის შეღებვა
UPDATE services SET price = 0.00 WHERE id = 'cbc9d422-0c2c-4255-9c03-bae532c05700';  -- Online consult 719393
UPDATE services SET price = 0.00 WHERE id = 'ccc64a3a-c2b7-42c7-bd1e-4ef933c52f3d';  -- lkmkl
UPDATE services SET price = 0.00 WHERE id = 'd0f71ef9-04f7-4909-8f7b-9a40260e4388';  -- Online consult 120507
UPDATE services SET price = 0.00 WHERE id = 'd8030580-29a2-46ba-875e-497f3e24f547';  -- Online consult 679642
UPDATE services SET price = 0.00 WHERE id = 'd93a0429-c4d8-47cf-a0dd-7aaced1827fb';  -- Online consult 277398
UPDATE services SET price = 0.00 WHERE id = 'ea4091cb-eade-4b18-8279-b6cdaec2fec6';  -- Online consult 039170
UPDATE services SET price = 0.00 WHERE id = 'f5dd29b4-3c10-426e-a290-41fbca241dad';  -- Online consult 123324
UPDATE services SET price = 0.00 WHERE id = 'f72cd149-6136-4aa1-926e-d5921258bc92';  -- რამე სერვისი
UPDATE services SET price = 0.00 WHERE id = 'f776d814-b654-4fdf-a4d0-2f08f2dd8e78';  -- Online consult 186386
UPDATE services SET price = 0.00 WHERE id = 'f826eb8c-4725-4434-bde4-24ec1b4b9041';  -- Online consult 186725
UPDATE services SET price = 0.00 WHERE id = 'f92d6413-e9eb-4d17-a066-d6ddb2eac58c';  -- Online consult 215788
UPDATE services SET price = 0.00 WHERE id = 'fcdfffd2-27f9-4f83-a776-2735136ade99';  -- Online consult 434447
UPDATE services SET price = 0.00 WHERE id = 'fcf5a6e2-ee7c-416c-9397-5473fc556a9b';  -- თმის შეჭრა
UPDATE services SET price = 0.00 WHERE id = 'fe5b8e80-742b-4a74-bd7d-1d6c07db7862';  -- Online consult 563926

-- ── organisations.require_approval (4 orgs; column is DROPPED by 20260814120000) ──
-- Confirmed as test orgs by the owner on 2026-08-16.
-- ALTER TABLE organisations ADD COLUMN require_approval boolean NOT NULL DEFAULT false;
UPDATE organisations SET require_approval = true WHERE id = '3f24301e-b2d6-4ce3-bb5f-14939819ec63';  -- rame-b7c3
UPDATE organisations SET require_approval = true WHERE id = '9116d9b6-793c-4cb3-90d7-374ef3ec4894';  -- autoschool
UPDATE organisations SET require_approval = true WHERE id = 'a7241971-ae67-4b40-8a6e-7f8cedfe3001';  -- barbershop
UPDATE organisations SET require_approval = true WHERE id = 'de1db18c-b9cf-4997-af69-c6bbdaa09abd';  -- pdspds

-- ── Appointments that were 'pending' (promoted to 'approved' by 20260814120000) ──
-- b86545ee-7e8c-4bf7-a6a6-65bea2ff1750  org 28f2a0aa…  2026-07-28T06:00Z
-- 52340380-47d5-41fe-9390-d340204c852d  org b242545b…  2026-07-10T12:00Z
-- a5b27d19-a984-4efd-80ae-a8332c4ca3fc  org cd04647b…  2026-07-30T10:00Z
-- 51c0d0d1-ec26-493e-b1c3-d5b637ea8fe2  org cd04647b…  2026-07-30T12:00Z

-- ── recurrence_series: 30 rows / 97 linked appointments ───────
-- 29 of 30 are status='cancelled'; the single 'active' one is
-- d357ec3c-f659-4b0f-95ef-c7862213eeae (org cd04647b…, weekly ×3 from 2027-02-28).
-- The appointments themselves survive the drop — only the series link is lost.
