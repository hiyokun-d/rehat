# Isi wajib migrasi pertama

Sumber: `docs/SCHEMA-REVIEW.md` (M3b, P6, S8). Prisma tidak bisa menyatakan ketiga hal ini di `schema.prisma`, jadi semuanya ditulis sebagai SQL di migrasi pertama. Saat database sudah ada: jalankan `prisma migrate dev --create-only`, tambahkan SQL di bawah ke file `migration.sql` yang dihasilkan, lalu terapkan.

Dua file migrasi sudah disiapkan dan belum dijalankan:
`prisma/migrations/20261128000000_init/migration.sql` (DDL dari schema, dihasilkan offline dengan `prisma migrate diff --from-empty --to-schema prisma/schema.prisma --script`) dan `prisma/migrations/20261128000001_guards/migration.sql` (salinan `prisma/guards.sql`). Keduanya belum diuji di Postgres. Untuk Supabase, jalankan `bunx prisma migrate deploy` setelah `.env` terisi; itu menghindari kebutuhan shadow database dari `migrate dev`.

## Checklist

- [ ] **M3b. Tiga CHECK constraint pada `CareLink`.** Akses caregiver hanya sah bila ACTIVE, dan ACTIVE hanya sah bila sudah ada consent. Tanpa constraint, kode yang salah menulis status bisa membuka akses tanpa persetujuan. SQL ada di `prisma/guards.sql` bagian 1.

  ```sql
  ALTER TABLE "CareLink" ADD CONSTRAINT carelink_active_has_consent
    CHECK (status <> 'ACTIVE' OR ("consentAt" IS NOT NULL AND "caregiverId" IS NOT NULL AND "revokedAt" IS NULL));

  ALTER TABLE "CareLink" ADD CONSTRAINT carelink_revoked_has_time
    CHECK (status <> 'REVOKED' OR "revokedAt" IS NOT NULL);

  ALTER TABLE "CareLink" ADD CONSTRAINT carelink_pending_no_consent
    CHECK (status <> 'PENDING' OR "consentAt" IS NULL);
  ```

  Tes integrasi: coba INSERT yang melanggar masing-masing constraint dan pastikan ditolak.

- [ ] **P6. FK `Profile.id` ke `auth.users` dengan `ON DELETE RESTRICT`.** `Profile.id` sama dengan `auth.users.id`. RESTRICT dipilih supaya penghapusan akun auth tidak cascade ke data kesehatan. Penghapusan permanen harus lewat prosedur soft delete, lalu hapus permanen secara sengaja dan terjadwal. Keputusan Abe 28 Nov 2026: RESTRICT plus prosedur terjadwal. SQL ada di `prisma/guards.sql` bagian 2.

  ```sql
  ALTER TABLE "Profile" ADD CONSTRAINT profile_id_fkey
    FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE RESTRICT;
  ```

- [ ] **S8. `REVOKE UPDATE, DELETE` pada `AuditLog`.** Guard di `src/lib/prisma.ts` hanya berlaku di aplikasi. Ini menutupnya di database. Keputusan Abe 28 Nov 2026: `DATABASE_URL` memakai role `postgres`/service role, yang memiliki tabel sehingga REVOKE tidak berlaku untuknya; guard aplikasi tetap menjadi penegakan untuk role itu. SQL ada di `prisma/guards.sql` bagian 4.

  ```sql
  REVOKE UPDATE, DELETE ON "AuditLog" FROM app_role;
  -- Supabase: role bawaan yang bisa dipakai lewat PostgREST.
  REVOKE UPDATE, DELETE ON "AuditLog" FROM anon, authenticated;
  ```

  Tes integrasi: UPDATE dan DELETE pada `AuditLog` lewat role aplikasi harus gagal dengan `permission denied`.

## Bagian dari SQL yang sama

- **R1-S3. Akses REST Supabase ke data pasien.** KEPUTUSAN Abe 28 Nov 2026: REVOKE dan RLS dipakai bersamaan. `prisma/guards.sql` bagian 5 mencabut hak `anon` dan `authenticated` pada semua tabel, mengubah default privileges, lalu mengaktifkan RLS dengan kebijakan tolak-semua pada 16 tabel data. Role `postgres` yang dipakai Prisma bypass RLS, jadi aplikasi tetap jalan. `MediaAsset` tidak ada di schema saat ini, jadi tidak dimasukkan.
- **R1-M1. Dua partial unique index** untuk satu program aktif per pasien dan satu latihan per program, di `prisma/guards.sql` bagian 3. Domain sudah menegakkan keduanya lebih awal dengan transaksi dan 422.


## Seed

`prisma/seed.ts` menolak jalan tanpa `ALLOW_DEMO_SEED=1`. Variabel itu tidak ada di `.env.example` dan tidak boleh ditambahkan ke sana. Pasang hanya di shell saat seed demo: `ALLOW_DEMO_SEED=1 bun run db:seed`.
