-- Guard tambahan yang tidak bisa dinyatakan di schema.prisma.
-- Migrasi kedua, dijalankan setelah 20261128000000_init. Sumber: prisma/guards.sql.
--
-- Keputusan Abe, 28 Nov 2026:
--   akses REST ditutup dengan REVOKE dan RLS bersamaan;
--   DATABASE_URL memakai role postgres/service role;
--   FK Profile.id ke auth.users memakai RESTRICT, hapus permanen lewat prosedur terjadwal;
--   F4 edge dulu tanpa FCM.

-- 1. CareLink hanya sah dengan consent (M3b).
ALTER TABLE "CareLink" ADD CONSTRAINT carelink_active_has_consent
  CHECK (
    status <> 'ACTIVE'
    OR (
      "consentAt" IS NOT NULL
      AND "caregiverId" IS NOT NULL
      AND "revokedAt" IS NULL
    )
  );

ALTER TABLE "CareLink" ADD CONSTRAINT carelink_revoked_has_time
  CHECK (status <> 'REVOKED' OR "revokedAt" IS NOT NULL);

ALTER TABLE "CareLink" ADD CONSTRAINT carelink_pending_no_consent
  CHECK (status <> 'PENDING' OR "consentAt" IS NULL);

-- 2. Profile.id adalah auth.users.id (P6). RESTRICT mencegah penghapusan akun auth
--    menghapus data kesehatan. Hapus permanen menyusul lewat prosedur eksplisit dan terjadwal.
ALTER TABLE "Profile" ADD CONSTRAINT profile_id_fkey
  FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE RESTRICT;

-- 3. Satu latihan per program dan satu program aktif per pasien (R1-M1).
--    Prisma tidak mendukung partial unique, jadi keduanya ditulis manual.
CREATE UNIQUE INDEX "PlanExercise_one_exercise_per_program"
  ON "PlanExercise" ("programId", "exerciseId")
  WHERE "deletedAt" IS NULL;

CREATE UNIQUE INDEX "Program_one_active_per_patient"
  ON "Program" ("patientId")
  WHERE "active" AND "deletedAt" IS NULL;

-- 4. AuditLog append-only juga di database (S8). Guard di src/lib/prisma.ts tetap dipakai
--    untuk koneksi postgres/service role, karena REVOKE tidak berlaku untuk pemilik tabel.
REVOKE UPDATE, DELETE ON "AuditLog" FROM anon, authenticated;

-- 5. Tutup PostgREST (R1-S3). Aplikasi memakai Prisma lewat role koneksi sendiri, bukan REST.
--    Keduanya dipakai: REVOKE menolak sebelum query, RLS menolak per baris bila hak masih ada.
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  REVOKE ALL ON TABLES FROM anon, authenticated;

DO $$
DECLARE
  t text;
BEGIN
  FOR t IN SELECT unnest(ARRAY[
    'Profile', 'CareLink', 'EmergencyContact', 'Program', 'PlanExercise',
    'SafetyEnvelope', 'RehabSession', 'AttemptSummary', 'BreachEvent', 'Alert',
    'ScheduledSession', 'Feedback', 'TherapistReview', 'Device', 'PushToken', 'AuditLog'
  ]) LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY no_rest_access ON %I FOR ALL TO anon, authenticated USING (false) WITH CHECK (false)',
      t
    );
  END LOOP;
END $$;

-- Verify after running (dengan anon key, bukan service role):
--   SELECT * FROM rest/v1/RehabSession  -> 401/403 atau 0 baris
--   UPDATE "AuditLog" SET ...          -> permission denied
--   INSERT INTO "CareLink" ... ACTIVE tanpa consent -> check constraint violation
