# Tinjauan schema Prisma terhadap temuan peninjau

Peninjau: kirocrew-worker (read-only, report-only). Yang ditinjau: `prisma/schema.prisma` dan `prisma/seed.ts` di working tree saat tinjauan. Pembanding: `docs/BACKEND-PLAN-REVIEW.md` (K3, M1, M2, M3, P6) dan `AGENTS.md` (hard rules). Tidak ada file lain yang diubah, tidak ada commit, dan `.env` tidak dibaca.

Label: PASS = terpenuhi, dengan bukti. GAGAL = tidak terpenuhi atau belum terbukti, dengan perbaikan schema.

Catatan kondisi: folder `prisma/migrations` belum ada. Semua klaim yang bergantung pada SQL migrasi (FK ke `auth.users`, CHECK constraint, REVOKE) belum bisa diverifikasi dan dicatat sebagai GAGAL sampai migrasi ada.

---

## Ringkasan

| Kode | Temuan | Status |
|---|---|---|
| K3a | Envelope menempel ke PlanExercise, bukan katalog Exercise | PASS |
| K3b | Entitas F0 dan alur inti dossier lengkap | GAGAL sebagian |
| K3c | `envelope_version` di sesi | PASS |
| K3d | Katalog Exercise terpisah dari PlanExercise | PASS |
| M1a | Tidak ada `@default` angka klinis pada envelope | PASS |
| M1b | Seed bertanda contoh | PASS (dengan catatan) |
| M2 | Tidak ada kolom safe/dangerous/severity | PASS |
| M3a | CareLink memuat status PENDING, consent, dan revoked | PASS |
| M3b | Aturan "ACTIVE hanya jika sudah consent" dijaga database | GAGAL |
| M3c | EmergencyContact punya consentAt | PASS |
| P6 | FK Profile.id ke `auth.users` | GAGAL (belum ada migrasi) |
| X1 | Hapus caregiver ikut menghapus log sesi pasien | GAGAL (temuan baru) |
| X2 | Filter `deletedAt: null` dipaksa oleh kode | GAGAL (temuan baru) |

---

## Temuan per item

**K3a. Envelope ke PlanExercise, bukan katalog. PASS.**
Bukti: `model SafetyEnvelope` (baris 202) punya `planExerciseId` ke `PlanExercise` (baris 212-213). `model Exercise` (baris 152) tidak punya relasi ke envelope; hanya `planExercises PlanExercise[]`.

**K3b. Entitas F0 dan alur inti dossier. GAGAL sebagian.**
Ada: Profile, CareLink, EmergencyContact, Exercise, Program, PlanExercise, SafetyEnvelope, RehabSession, AttemptSummary, BreachEvent, Alert, Device, PushToken, AuditLog.
Tidak ada:
- `ScheduledSession`: jadwal harian belum punya model. Tanpa itu, sesi terjadwal dan sesi yang dilaporkan tidak bisa dibedakan.
- `Feedback`: kesulitan dan catatan pasien tidak punya tempat. Dossier menaruhnya terpisah dari log.
- `TherapistReview`: catatan terapis tidak punya tempat. Ini bagian dari MVP (terapis menulis catatan).
- `MediaAsset`: boleh ditunda ke fase berikut, tetapi perlu dicatat sebagai ditunda.
- `CaregiverInvite`: tidak ada model terpisah. Token undangan disimpan sebagai `CareLink.tokenHash`. Ini keputusan desain yang masuk akal (satu tabel), jadi bukan GAGAL, tetapi F0 perlu menyebutnya.
- `RehabSession` dipakai sebagai ExerciseLog dossier. Nama berbeda, fungsi sama. Status COMPLETED, CANNOT_DO, POSTPONED dan `reporter` (PATIENT, CAREGIVER) sudah ada.

Perbaikan (schema):
```prisma
model ScheduledSession {
  id            String    @id @default(uuid()) @db.Uuid
  scheduledFor  DateTime
  createdAt     DateTime  @default(now())
  deletedAt     DateTime?
  patientId     String    @db.Uuid
  patient       Profile   @relation("PatientSchedule", fields: [patientId], references: [id], onDelete: Cascade)
  planExerciseId String   @db.Uuid
  planExercise  PlanExercise @relation(fields: [planExerciseId], references: [id], onDelete: Restrict)
  sessions      RehabSession[]

  @@index([patientId, scheduledFor])
}

model Feedback {
  id        String       @id @default(uuid()) @db.Uuid
  difficulty Int?
  note      String?
  createdAt DateTime     @default(now())
  deletedAt DateTime?
  sessionId String       @unique @db.Uuid
  session   RehabSession @relation(fields: [sessionId], references: [id], onDelete: Cascade)
}

model TherapistReview {
  id          String    @id @default(uuid()) @db.Uuid
  note        String
  createdAt   DateTime  @default(now())
  deletedAt   DateTime?
  patientId   String    @db.Uuid
  patient     Profile   @relation("PatientReviews", fields: [patientId], references: [id], onDelete: Cascade)
  therapistId String    @db.Uuid
  therapist   Profile   @relation("TherapistReviews", fields: [therapistId], references: [id], onDelete: Restrict)

  @@index([patientId, createdAt(sort: Desc)])
}
```
Tambahkan juga di `model Profile`: `scheduledSessions ScheduledSession[] @relation("PatientSchedule")`, `reviewsAsPatient TherapistReview[] @relation("PatientReviews")`, `reviewsAsTherapist TherapistReview[] @relation("TherapistReviews")`. Di `model RehabSession` tambahkan `scheduledSessionId String? @db.Uuid` dan `scheduledSession ScheduledSession? @relation(fields: [scheduledSessionId], references: [id], onDelete: SetNull)`. Di `model PlanExercise` tambahkan `scheduledSessions ScheduledSession[]`.
`Feedback` dibuat sebagai model terpisah sesuai dossier. Kalau tim memilih dua kolom di RehabSession saja untuk MVP, itu juga sah, tetapi keputusannya harus dicatat.

**K3c. `envelope_version` di sesi. PASS.**
Bukti: `RehabSession.envelopeVersion Int` (dekat baris 231-232). Relasi komposit `envelope` memakai `[planExerciseId, envelopeVersion]` ke `[planExerciseId, version]` (baris 242), dan `SafetyEnvelope` punya `@@unique([planExerciseId, version])`. Database menolak sesi yang menunjuk versi yang tidak ada.

**K3d. Katalog terpisah dari PlanExercise. PASS.**
Bukti: `Exercise` (baris 152) hanya berisi `slug`, `name`, `description`, tanpa batas. `PlanExercise.exerciseId` (baris 190) ke `Exercise` dengan `onDelete: Restrict`.

**M1a. Tidak ada default klinis. PASS.**
Bukti: `grep "@default"` pada schema. Kolom envelope `maxAngleDeg Float` (baris 205), `maxVelDegPerS`, dan `debounceMs Int` tidak punya default. Satu-satunya default adalah `uuid()` dan `now()`.

**M1b. Seed bertanda contoh. PASS dengan catatan.**
Bukti: `prisma/seed.ts` baris 1 ("Demo data"), baris 25 (`// contoh, bukan nilai klinis`), nama "Terapis Demo", "Pasien Demo", "Program demo". Nilai 90, 120, 300 masuk ke tabel `SafetyEnvelope` yang sama dengan data nyata. Tidak ada kolom penanda dan tidak ada penjaga.
Perbaikan (kode seed, bukan schema): di awal `main()` tolak jalan jika `process.env.NODE_ENV === "production"` atau jika `DIRECT_URL` mengarah ke database produksi. Cara paling sederhana: tambahkan `if (process.env.ALLOW_DEMO_SEED !== "1") throw new Error("Seed hanya untuk demo. Set ALLOW_DEMO_SEED=1.");`. Nilai variabel itu tidak boleh di `.env.example` sebagai `1`.

**M2. Tidak ada kolom safe, dangerous, atau severity. PASS.**
Bukti: `grep -niE "safe|danger|severity|bahaya|aman"` pada schema tidak menemukan kolom. Hanya ada `AlertLevel` (L1, L2) dan `AlertStatus` (FALSE_ALARM), yang tidak menyatakan penilaian keselamatan. Komentar `BreachEvent` memakai "went past a limit the therapist set", sesuai aturan.

**M3a. CareLink memuat PENDING, consent, dan revoked. PASS.**
Bukti: `enum CareLinkStatus { PENDING ACTIVE REVOKED }`, `status CareLinkStatus` (baris 107), `consentAt DateTime?` (baris 115), `revokedAt DateTime?` (baris 116), `consentedById` (relasi `LinkConsentedBy`), dan komentar baris 103-104 yang menyatakan hanya ACTIVE memberi akses.

**M3b. Aturan ACTIVE hanya dengan consent, dijaga database. GAGAL.**
Schema tidak memaksa bahwa status ACTIVE harus punya `consentAt` dan `caregiverId`, atau bahwa REVOKED harus punya `revokedAt`. Komentar di schema hanya berupa teks. Kode yang salah menulis status bisa membuat akses tanpa persetujuan. Prisma tidak bisa menyatakan CHECK constraint, jadi perbaikannya ada di SQL migrasi:
```sql
ALTER TABLE "CareLink" ADD CONSTRAINT carelink_active_has_consent
  CHECK (status <> 'ACTIVE' OR ("consentAt" IS NOT NULL AND "caregiverId" IS NOT NULL AND "revokedAt" IS NULL));
ALTER TABLE "CareLink" ADD CONSTRAINT carelink_revoked_has_time
  CHECK (status <> 'REVOKED' OR "revokedAt" IS NOT NULL);
ALTER TABLE "CareLink" ADD CONSTRAINT carelink_pending_no_consent
  CHECK (status <> 'PENDING' OR "consentAt" IS NULL);
```
Ketiga constraint ini dibuat di migrasi pertama. Tes integrasi harus mencoba INSERT yang melanggar dan memastikan ditolak.

**M3c. EmergencyContact punya consentAt. PASS.**
Bukti: `EmergencyContact.consentAt DateTime?` (baris 141), komentar "Null = no consent recorded, so this contact must not be messaged". Catatan: kontrak "tidak dikirimi pesan bila consentAt null" belum ditegakkan di schema. Itu tugas kode WhatsApp, yang sudah diparkir (L3).

**P6. FK Profile.id ke auth.users. GAGAL (belum ada migrasi).**
Bukti: `model Profile` baris 75 `id String @id @db.Uuid`, tanpa relasi. Komentar di baris 71-73 menyebut FK ditambahkan di migrasi SQL, tetapi folder migrasi belum ada.
Perbaikan (SQL migrasi):
```sql
ALTER TABLE "Profile" ADD CONSTRAINT profile_id_fkey
  FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE RESTRICT;
```
`ON DELETE RESTRICT` dipilih agar menghapus akun auth tidak diam-diam menghapus semua data kesehatan lewat cascade. Penghapusan pasien harus lewat prosedur yang sengaja (soft delete lalu hapus permanen terjadwal). Ini keputusan yang memengaruhi kebijakan hapus data, jadi pemilik proyek perlu mengonfirmasinya.

**X1 (temuan baru). Hapus caregiver menghapus log sesi pasien. GAGAL.**
Bukti: `RehabSession.reporter` (baris 239) memakai `onDelete: Cascade`. Kalau profil caregiver dihapus, semua `RehabSession` yang ia laporkan ikut terhapus, termasuk log pasien. Log itu adalah data pasien dan bukan milik caregiver.
Perbaikan: ubah baris 239 menjadi `onDelete: Restrict`. Kolom `reporterId` wajib, jadi SetNull tidak bisa. Profil caregiver yang punya log hanya bisa di-soft-delete.

**X2 (temuan baru). Filter deletedAt tidak dipaksa. GAGAL.**
Komentar schema (baris 8-9) mewajibkan setiap query data pasien memakai `deletedAt: null`, tetapi tidak ada yang menegakkannya. Perbaikan: di `src/lib/prisma.ts` pakai Prisma client extension yang menambahkan `deletedAt: null` pada `findMany`, `findFirst`, `findUnique`, dan `count` untuk model yang punya `deletedAt`. Tambahkan tes yang memastikan baris yang sudah di-soft-delete tidak muncul.

**Auditlog (K3, S8 di BACKEND-PLAN-REVIEW). Sebagian.**
Schema: `model AuditLog` (baris 320-an) tanpa relasi, sesuai komentar. Guard append-only ada di `src/lib/prisma.ts` baris 8-21 (update dan delete ditolak). Guard itu hanya di aplikasi. `REVOKE UPDATE, DELETE` belum ada karena migrasi belum dibuat.

---

## Yang belum bisa diverifikasi

Tidak ada database, jadi constraint, FK, dan seed belum dijalankan. Tidak ada `prisma validate` atau `prisma generate` yang saya jalankan, untuk menghindari efek samping di luar tinjauan. Isi `.env` tidak dibaca. Klaim tentang perilaku Supabase (RLS, PostgREST, `auth.users`) tidak saya cek ke dokumentasi.

Risiko: temuan M3b, P6, dan X1 berdampak langsung pada data kesehatan dan sebaiknya diperbaiki sebelum migrasi pertama dibuat.
