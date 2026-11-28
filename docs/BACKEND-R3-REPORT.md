# Laporan ronde 3 backend

Tanggal: 28 Nov 2026. Basis: `ade193b` plus perubahan working tree ronde 1 sampai 3.
Lingkup: relay ws, bundle dan program, penyelarasan klien dengan `docs/SYNC-CONTRACT.md`.

## Hasil gate

| Cek | Hasil |
| --- | --- |
| `bun test` | 264 lulus, 0 gagal, 19 file |
| `bunx tsc --noEmit` | tanpa error |
| `bunx biome check` | bersih, 187 file |
| `bunx prisma validate` | schema valid |
| `bun run build` | sukses dengan `DATABASE_URL` dummy inline. Tanpa env, build berhenti di pengumpulan data route karena `src/lib/prisma.ts` menolak jalan tanpa `DATABASE_URL`. Itu prasyarat deploy, bukan regresi kode. |

## Status per temuan

| Temuan | Status | Bukti |
| --- | --- | --- |
| R1-S1 tiket mengikat identitas dan peran | Selesai | `tests/relay-security.test.ts`: peran dari tiket, ruang terikat terapis dan pasien pertama, tiket tanpa pasien ditolak, 5 join gagal menutup koneksi |
| R1-S2 pesan ws cacat | Selesai | `parseClientMessage` menolak 18 bentuk cacat; handler tidak melempar dan tidak meneruskan pesan |
| R1-K1 Origin | Selesai | `origin.ts` plus tes localhost, LAN, tunnel same-host, `ALLOWED_ORIGINS` |
| R1-K2 tiket lintas modul | Selesai | Store di `globalThis`; tes menukar tiket lewat dua salinan modul dan lewat jalur route ke upgrade |
| R1-S5 rate limit dan sweep tiket | Selesai | 300 tiket per jam per user, user lain tidak terpengaruh, sweeper periodik |
| R1-K6 delta bundle | Selesai | Kursor global `updatedAt`, tombstone `removed`, tes untuk latihan baru tanpa envelope dan latihan terhapus |
| R1-M1 satu program aktif dan latihan ganda | Selesai di domain | `createProgram`/`updateProgram` menonaktifkan program lain dalam transaksi; `createPlanExercise` menolak slug ganda dengan 422. Unik parsial tetap harus ditulis di migrasi |
| R1-M2 program terhapus | Selesai | Baris hidup hanya dari program aktif dan tidak terhapus; program nonaktif atau terhapus menjadi tombstone |
| Klien sync | Selesai | `repList` dihapus, hasil per item dibaca, header `Idempotency-Key` dihapus, tombstone diterapkan di cache |
| R1-K9 pemanggil klien | Selesai untuk pasien | `/api/bundle` dan `/api/sync` dipakai `useBackend`. Caregiver masih terbuka (K15) |

## Keputusan desain

### Kursor bundle

`Bundle.version` bukan lagi versi envelope tertinggi. Nilainya `max(updatedAt)` dari program dan plan exercise pasien, dalam milidetik. Setiap latihan tetap membawa `envelope.version` sendiri. Alasannya: latihan bisa berubah tanpa envelope baru (ditambah, dihapus, dipindah), dan kursor berbasis versi envelope tidak bisa melihat perubahan itu (R1-K6).

Perbandingan memakai `>=`, bukan `>`, karena `updatedAt` berpresisi milidetik. Satu baris bisa terkirim ulang, dan itu aman karena klien mengganti berdasarkan id. Transaksi yang commit setelah pull dengan `now()` lebih lama masih bisa terlewat; itu batas kursor waktu dan dicatat di komentar.

### Tombstone

Plan exercise yang dihapus, atau yang programnya nonaktif atau terhapus, dikirim sebagai id di `removed`. Ekstensi soft-delete Prisma menyaring `PlanExercise.deletedAt` di semua pembacaan biasa, jadi tombstone diambil lewat satu query mentah yang hanya memilih id dan timestamp. Query ini sengaja melewati ekstensi; tidak ada nilai kesehatan yang dibaca, dan hanya jalan saat `since > 0`.

### Kepemilikan ruang relay

Ruang milik terapis yang membuatnya, dan terikat ke satu pasien yang ditentukan oleh HP pertama yang join. Layar atau HP dari terapis lain, atau HP pasien lain, mendapat jawaban yang sama dengan kode yang tidak ada. Konsekuensinya satu ruang melayani satu pasien, dan terapis membuat kode baru untuk pasien berikutnya. Ini cukup untuk MVP satu pasien per sesi. Belum ada tes beban untuk banyak pasien bersamaan.

## Yang masih terbuka

1. Migrasi SQL pertama: RLS atau REVOKE untuk `anon` dan `authenticated`, CHECK, FK ke `auth.users`, hak tulis `AuditLog`, dan partial unique index yang disebut di `schema.prisma`. Butuh `.env` dan Postgres.
2. Query mentah bundle dan sync belum pernah dijalankan di Postgres sungguhan. Tes memakai Prisma tiruan (R1-K12).
3. Bundle dan sync untuk caregiver (R1-K15). Klien pasien tidak mengirim `patientId`, dan caregiver belum punya jalur bundle, jadi alur caregiver belum bisa dipakai.
4. F4 edge selesai: pause di HP saat breach bila `onBreach = CUE_AND_PAUSE`, dan `Alert` dibuat saat ingest. Push FCM ke caregiver dan L3 WhatsApp belum dipasang. Putusan Abe: kerjakan edge dulu tanpa FCM.
5. F5 deploy: relay ws belum punya jalur di Vercel.
6. Sisa temuan CATATAN: header keamanan, batas ukuran body, pembatalan invite massal, status sesi dihentikan, consent atas nama pasien, ekspor dan hapus data, kontak darurat.
7. Migrasi sudah disiapkan di `prisma/migrations/`, tapi belum dijalankan atau diuji di Postgres. Butuh `.env` dan database sungguhan; verifikasi minimal lewat REST dengan anon key.

## Lanjutan 28 Nov 2026: migrasi SQL dan F4 edge

Abe memutuskan: REVOKE dan RLS dipakai bersamaan, `DATABASE_URL` memakai role `postgres`/service role, FK `Profile.id` ke `auth.users` dengan `RESTRICT` plus prosedur hapus permanen terjadwal, dan F4 dikerjakan dari sisi edge dulu tanpa FCM.

- `prisma/guards.sql`: CHECK pada `CareLink`, FK `Profile.id`, dua partial unique index, `REVOKE` pada `AuditLog`, `REVOKE ALL` plus RLS tolak-semua untuk 16 tabel data pada `anon` dan `authenticated`. `docs/FIRST-MIGRATION.md` diperbarui. Belum dijalankan.
- F4 edge: `SessionConfig` membawa `onBreach` dan `notifyCaregiver` dari bundle. `applyBundle` dan `claimedVersion` membandingkan perilaku ini juga, jadi perubahan perilaku saja tidak lolos sebagai versi lama. `RehabSession.pause()` dipanggil `usePhoneSession` saat breach bila terapis memilih pause, dengan pesan suara yang menyebut batas dari terapis.
- F4 server: `ingestBatch` membuat satu `Alert` per sesi bila breach terjadi dan envelope yang dipakai meminta pause atau notifikasi caregiver. `level` L2/L1, `status` PENDING, tertaut ke breach pertama, `caregiverId` dari `CareLink` ACTIVE bersconsent atau null.
- Verifikasi lanjutan: `bun test` 273 lulus, `tsc` bersih, `biome` bersih, `prisma validate` valid, build sukses dengan env dummy.
