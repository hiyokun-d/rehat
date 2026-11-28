# Pembuatan akun (MVP)

Tiga peran: THERAPIST, PATIENT, CAREGIVER. Peran selalu dibaca dari tabel `Profile`, tidak pernah dari
`user_metadata` Supabase dan tidak pernah dari body request. Tidak ada endpoint yang menerima atau mengubah `role`.

Semua akun dimulai sebagai pengguna Supabase Auth (email + kata sandi, atau metode lain yang dipakai proyek).
Yang berbeda hanya cara `Profile`-nya terbentuk.

## 1. Terapis: lewat SQL atau seed oleh pemilik

Tidak ada pendaftaran terbuka sebagai terapis. Hak terapis diberikan oleh pemilik sistem, sekali per orang.

1. Terapis mendaftar di Supabase Auth seperti pengguna biasa, lalu memanggil API sekali (mis. `GET /api/me`).
   Profile-nya otomatis dibuat sebagai PATIENT (bagian 2).
2. Pemilik menyalin UUID pengguna itu dari Supabase (Authentication, Users) dan menjalankan di SQL editor
   Supabase atau `psql` dengan role pemilik database:

```sql
-- Ganti placeholder. Jangan tempel kunci atau kata sandi di sini.
UPDATE "Profile"
SET "role" = 'THERAPIST',
    "displayName" = '<NAMA TERAPIS>',
    "therapistId" = NULL
WHERE "id" = '<UUID-PENGGUNA-SUPABASE>'::uuid
  AND "deletedAt" IS NULL;

INSERT INTO "AuditLog" ("id", "actorId", "patientId", "action", "entityType", "entityId")
VALUES (gen_random_uuid(), NULL, NULL, 'profile.role_therapist', 'Profile', '<UUID-PENGGUNA-SUPABASE>');
```

Bila terapis belum pernah memanggil API, buat barisnya langsung:

```sql
INSERT INTO "Profile" ("id", "role", "displayName", "updatedAt")
VALUES ('<UUID-PENGGUNA-SUPABASE>'::uuid, 'THERAPIST', '<NAMA TERAPIS>', now());
```

Untuk lingkungan dev, `prisma/seed.ts` membuat terapis demo dan hanya jalan bila `ALLOW_DEMO_SEED` diset.
Tabel `Profile` tidak boleh dapat ditulis oleh role `anon` atau `authenticated` dari klien Supabase (lihat
`docs/FIRST-MIGRATION.md`); bila dibiarkan, pengguna dapat menaikkan perannya sendiri lewat REST Supabase.

## 2. Pasien: otomatis, lalu didaftarkan terapis

**Otomatis.** Saat pengguna Supabase yang valid pertama kali memanggil route API mana pun yang memakai guard dan
belum punya `Profile`, guard membuatnya dengan peran PATIENT, satu transaksi dengan audit log
`profile.autocreate`. Panggilan bersamaan menghasilkan satu baris dan satu audit. Profile yang sudah dihapus
lunak tidak dibuat ulang dan tetap ditolak. PATIENT sebagai default aman karena hak akses datang dari
kepemilikan data (pasien hanya melihat datanya sendiri), bukan dari peran.

**Didaftarkan terapis.** `POST /api/patients` (THERAPIST saja):

```json
{ "authUserId": "<UUID-PENGGUNA-SUPABASE>", "displayName": "Nama Pasien" }
```

- Body ketat: field lain, termasuk `role` dan `therapistId`, ditolak 400. `therapistId` diambil dari login.
- Pengguna belum punya Profile: dibuat sebagai PATIENT milik terapis. Sudah ada sebagai PATIENT tanpa terapis:
  dilengkapi. Sudah milik terapis ini: tidak berubah (200).
- Milik terapis lain, atau bukan PATIENT (terapis atau caregiver): 409 dengan pesan yang sama untuk semua sebab.
- Berhasil membuat atau melengkapi: 201 dan audit log `patient.register`.
- `authUserId` harus pengguna Supabase yang sudah ada. Setelah migrasi pertama, FK ke `auth.users` menolak
  UUID yang tidak ada (404).

Batas yang diketahui: pendaftaran oleh terapis belum meminta persetujuan pasien. Persetujuan yang tercatat
hanya ada di alur caregiver (bagian 3). Tambahkan konfirmasi pasien sebelum dipakai di luar pilot klinik.

## 3. Caregiver: lewat undangan

1. Terapis: `POST /api/invites` `{ "patientId": "<uuid pasien miliknya>" }`. Tautan PENDING dibuat dan token
   mentah dikembalikan sekali (berlaku 48 jam, hanya hash-nya yang disimpan).
2. Caregiver mendaftar di Supabase Auth, lalu `POST /api/invites/accept` `{ "token": "..." }`.
   Profile otomatis PATIENT; token yang sah mengubahnya menjadi CAREGIVER dalam transaksi yang sama (audit
   `profile.role_caregiver`). Pengguna yang punya terapis (pasien terdaftar) ditolak 403 dan token tidak
   terpakai. Token tidak valid tidak mengubah apa pun. Tautan tetap PENDING dan belum memberi akses.
3. Pasien, atau terapisnya bila pasien tidak bisa: `POST /api/invites/consent` `{ "careLinkId": "<uuid>" }`.
   Tautan menjadi ACTIVE dengan `consentAt`.
4. Pencabutan, kapan saja: `POST /api/invites/revoke` `{ "careLinkId": "<uuid>" }` oleh pasien pemilik tautan
   atau caregiver pada tautan itu. Terapis tidak bisa mencabut. Status menjadi REVOKED, `revokedAt` terisi,
   `tokenHash` dikosongkan, audit `invite.revoke`. Pihak lain atau id tak dikenal: 403. Sudah dicabut: 409.
   Tautan REVOKED tidak bisa diaktifkan lagi (consent hanya menerima PENDING). Semua pembaca CareLink harus
   menyaring `status = 'ACTIVE'`; `POST /api/sync` sudah begitu, dan F4 (alert, push) wajib begitu juga.

## 4. Melihat akun sendiri

`GET /api/me` mengembalikan `id`, `role`, `displayName`, dan `therapistId` milik pemanggil.

## Ringkasan

| Peran | Cara terbentuk | Siapa yang menentukan peran |
| --- | --- | --- |
| THERAPIST | SQL atau seed | pemilik sistem |
| PATIENT | otomatis saat panggilan API pertama, atau `POST /api/patients` | sistem (selalu PATIENT) |
| CAREGIVER | `POST /api/invites/accept` dengan token sah | token dari terapis |

## Catatan keamanan

- Dua pengguna yang baru masuk tidak bisa saling menaikkan peran: tidak ada jalur API yang menulis `role` selain
  accept-invite (PATIENT tanpa terapis menjadi CAREGIVER, dengan token sah).
- Trade-off auto-create: siapa pun yang punya akun Supabase mendapat baris `Profile` PATIENT. Kosongnya data
  membuatnya tidak berbahaya, tetapi pendaftaran Supabase sebaiknya dibatasi (konfirmasi email, rate limit)
  agar tabel tidak dipenuhi akun sampah.
- SQL mentah di bagian 1 tidak dijalankan terhadap database nyata di sini (belum ada database hidup).
