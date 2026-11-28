# Kontrak `POST /api/sync`

Kontrak akhir jalur sinkronisasi sesi dari HP ke backend. Sumber kebenaran kode: `src/lib/relay/sync.ts` (skema, `resolvePatient`, `ingestBatch`) dan `src/app/api/sync/route.ts`. Klien HP (`src/lib/api/client.ts`, `outbox.ts`) harus mengikuti dokumen ini. Temuan yang ditutup: R1-S4, R1-K3, R1-K4, R1-K5, R1-K7, R1-M2, R1-K11.

## 1. Request

```
POST /api/sync
Content-Type: application/json
Cookie: sesi Supabase (PATIENT atau CAREGIVER)
```

```jsonc
{
  "patientId": "uuid",          // HANYA caregiver, wajib. Pasien dilarang mengirimnya.
  "sessions": [ /* 1..100 item */ ]
}
```

Tidak ada header `Idempotency-Key`. Header itu boleh tetap dikirim tetapi diabaikan server (lihat bagian 5).

Satu item `sessions[]` (semua key wajib kecuali yang ditandai opsional; key lain ditolak):

| Key | Tipe | Batas |
| --- | --- | --- |
| `clientId` | uuid v4 dari HP | kunci idempotensi dan primary key `RehabSession` |
| `exercise` | string | 1..100, slug katalog |
| `status` | `COMPLETED` / `CANNOT_DO` / `POSTPONED` | |
| `startedAt` | ISO 8601 dengan offset | sampai tahun 9999 |
| `endedAt` | ISO 8601 atau `null`, opsional | |
| `envelopeVersion` | int | 0..1.000.000; versi yang HP klaim dipakai |
| `reps` | int | 0..10.000 |
| `activeMs` | int | 0..86.400.000 |
| `maxAngleDeg` | angka terhingga | -360..360 |
| `maxVelDegS` | angka terhingga | 0..10.000 |
| `pauses` | int | 0..10.000 |
| `breaches` | array | 0..1.000 item |
| `difficulty` | int 1..5 atau `null`, opsional | disimpan ke `Feedback` |
| `note` | string atau `null`, opsional | maks 500 karakter, disimpan ke `Feedback` |

Satu `breaches[]`: `kind` (`angle` / `velocity`), `value` dan `limit` (angka terhingga, -10.000..10.000), `heldMs` (int 0..86.400.000), `atMs` (int 0..86.400.000, offset dari `startedAt`). `startedAt + atMs` harus tetap berupa tanggal yang valid (tahun <= 9999), kalau tidak item ditolak.

Tidak ada di kontrak, dan ditolak bila dikirim: `trace`, `repList` (tidak disimpan, jadi tidak dijanjikan), `deviceId`, `deviceLabel`, `reportedBy`, `reporterId`, dan key lain apa pun. Batas angka di atas adalah batas kewajaran, bukan batas klinis. Nilai di luar batas ditolak, tidak dipotong. Semua int dari klien muat di kolom `Int` 32 bit.

## 2. Siapa pasiennya (`patientId`)

| Login | Body `patientId` | Hasil |
| --- | --- | --- |
| PATIENT | tidak ada | pasien = akun itu sendiri |
| PATIENT | ada (termasuk id sendiri) | 400 |
| CAREGIVER | tidak ada | 400 |
| CAREGIVER | ada, caregiver punya `CareLink` ACTIVE ke pasien itu dan pasien belum `deletedAt` | pasien = `patientId` itu |
| CAREGIVER | ada, tanpa link ACTIVE, link sudah dicabut/PENDING, atau pasien terhapus | 403 |

Pengecekan memakai `caregiverId`, `patientId`, `status = ACTIVE`, `deletedAt = null` pada link dan `patient.deletedAt = null` (BOLA). `reportedBy` dan `reporterId` selalu dari login, tidak pernah dari body. Peran lain (THERAPIST) dapat 403 dari `requireRole`.

## 3. Respons

Status 200 selama request sah dan login valid, walaupun ada item yang ditolak. Batch tidak pernah gagal di tengah karena satu item buruk.

```jsonc
{
  "stored": 1, "duplicate": 1, "rejected": 1,
  "results": [
    { "index": 0, "clientId": "uuid", "result": "stored",    "envelopeMismatch": false },
    { "index": 1, "clientId": "uuid", "result": "duplicate", "envelopeMismatch": false },
    { "index": 2, "clientId": "uuid", "result": "rejected",  "reason": "unknown_exercise", "envelopeMismatch": false }
  ]
}
```

`results` berurutan sama dengan `sessions` (`index` = posisi di request). `clientId` bernilai `null` bila item rusak sehingga id-nya tidak terbaca.

| `result` | Arti | Tindakan HP |
| --- | --- | --- |
| `stored` | Sesi, ringkasan, breach, feedback, dan audit tersimpan | hapus dari outbox |
| `duplicate` | `clientId` sudah ada dan milik pasien dan pelapor yang sama; isi retry diabaikan, tulisan pertama menang | hapus dari outbox |
| `rejected` | Tidak disimpan; lihat `reason` | jangan kirim ulang apa adanya |

| `reason` | Sebab | Catatan untuk HP |
| --- | --- | --- |
| `invalid_payload` | gagal skema (key asing, angka di luar batas, tanggal overflow, dst.) | bug klien; jangan retry isi yang sama |
| `unknown_exercise` | latihan tidak ada di program aktif pasien (program dihapus atau nonaktif juga masuk sini) | tarik bundle ulang |
| `no_envelope` | latihan belum diberi batas oleh terapis | tunggu terapis; sesi tidak bisa disimpan |
| `envelope_version_unknown` | `envelopeVersion` yang HP klaim tidak pernah ada. `envelopeMismatch: true` | tarik bundle ulang |
| `client_id_conflict` | `clientId` sudah dipakai pasien atau pelapor lain (R1-S4) | sesi TIDAK tersimpan; jangan anggap terkirim |

`envelopeMismatch: true` pada item `stored` berarti versi yang HP klaim ada tetapi bukan versi yang berlaku sekarang. Sesi tetap tersimpan dengan versi klaimnya dan audit mencatat keduanya. Penanda ini bukan penolakan.

`client_id_conflict` setara dengan "409" di tingkat item: respons HTTP tetap 200 agar item lain di batch yang sama tidak ikut gagal.

Kegagalan di tingkat request (bukan item): 400 body tidak valid atau `patientId` salah aturan, 401/403 login atau peran atau link, 429 batas 120 POST per jam per login, 500 galat server. Pada 500 (misalnya database putus) item yang sudah selesai tersimpan penuh; HP mengirim ulang batch yang sama dan item itu kembali sebagai `duplicate`. Tidak pernah ada sesi setengah jadi.

## 4. Atomisitas

Satu sesi = satu `$transaction` interaktif yang berisi `RehabSession`, `AttemptSummary`, `BreachEvent`, `Feedback` (bila ada `difficulty` atau `note`), dan `AuditLog`. Bila salah satu langkah gagal, semuanya dibatalkan, jadi retry menulis seluruh sesi dari awal dan tidak berakhir sebagai `duplicate` kosong (R1-K3).

`AttemptSummary` ditulis untuk semua `status`, bukan hanya `COMPLETED` (R1-K5). Waktu kejadian breach = `startedAt + atMs`. Waktu terima server dicatat di audit (`serverReceivedAt`), terpisah dari jam HP.

Satu `Alert` per sesi bisa dibuat di transaksi yang sama bila sesi punya breach dan envelope yang dipakai HP meminta `CUE_AND_PAUSE` atau `notifyCaregiver` (F4). `level` = `L2` untuk pause yang ditetapkan terapis, `L1` untuk cue plus pemberitahuan caregiver. `status` = `PENDING` karena push FCM belum dipasang. `breachEventId` menunjuk breach pertama. Tidak ada Alert bila tidak ada breach atau perilakunya `CUE_ONLY` tanpa notifikasi.

Insert `RehabSession` memakai `ON CONFLICT ("id") DO NOTHING`. Dua POST bersamaan dengan `clientId` sama menghasilkan satu baris; yang kedua menunggu transaksi pertama selesai, lalu membaca pemilik baris itu.

## 5. Idempotensi

Murni dari `clientId` (R1-K11). Tidak ada tabel kunci idempotensi di MVP.

- Retry persis sama: `duplicate`.
- Retry dengan isi berbeda (misalnya `note` diedit): `duplicate`, isi baru diabaikan, tulisan pertama menang. HP tidak boleh menganggap edit ikut tersimpan.
- `clientId` yang sama dari pasien atau pelapor lain: `rejected` / `client_id_conflict`, bukan `duplicate`. Baris pemilik asli tidak diubah.
- `clientId` harus dibuat sekali di HP dan dipakai pada setiap retry sesi itu. Jangan buat ulang.

## 6. Yang sengaja belum ada

- Tidak ada tabel idempotensi per request, jadi perbedaan isi pada retry tidak terdeteksi (keputusan konduktor untuk MVP).
- Caregiver wajib menyebut `patientId` di setiap POST; tidak ada tebakan "satu-satunya link".
- Batas ukuran body dan insert breach per batch ada di R1-S8 dan R1-K14, di luar item ini.
- SQL mentah `INSERT ... ON CONFLICT` belum pernah dijalankan di Postgres sungguhan; tes memakai Prisma tiruan (R1-K12). Verifikasi pertama pada migrasi nyata.
- Aturan "sesi berhenti di tengah" (R1-M6) belum diputuskan; `status` tetap tiga nilai.

## 7. Status klien HP

Klien di `src/lib/api/{client,outbox}.ts`, `src/lib/api/bundleCache.ts`, dan `src/app/phone/useBackend.ts` sudah mengikuti kontrak ini:

- `repList` sudah dihapus dari `toSyncItem`. Server tetap menolaknya sebagai `invalid_payload`.
- Hasil per item dibaca. `stored` dan `duplicate` menandai baris outbox terkirim, `rejected` menandainya ditolak dan tidak dikirim ulang apa adanya. `envelopeMismatch` atau alasan `unknown_exercise` / `envelope_version_unknown` memicu tarik bundle ulang.
- Header `Idempotency-Key` tidak lagi dikirim. Idempotensi hanya dari `clientId`.
- Bundle membaca `removed` dan membuang latihan yang dihapus dari cache. Latihan yang dihapus lalu ditambah lagi dengan id baru tetap bertahan.
- Pembulatan int tetap tugas klien (`activeMs`, `heldMs`, `atMs` harus bilangan bulat); nilai desimal ditolak.

Belum selesai: caregiver wajib mengirim `patientId`, tetapi klien belum punya cara mengambil id pasien yang ditautkan dan `/api/bundle` masih khusus PATIENT. Alur caregiver menunggu keputusan R1-K15.
