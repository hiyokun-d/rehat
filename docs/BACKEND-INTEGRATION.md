# Titik integrasi backend (survei read-only)

Dibuat dari membaca kode per 27 Nov 2026 (commit `ade193b`). Tidak ada kode yang diubah.
Semua nama file relatif terhadap `src/` kecuali disebut lain.

Istilah arah: **HP→server** = data dari app `/phone`. **Server→layar** = data ke app `/screen`.
Kolom "usulan API" hanya usulan. Path dan bentuk final ikut keputusan backend.

## 1. Relay WebSocket (`server.mts`, `lib/relay/`, `hooks/useRelay.ts`)

Server hanya membaca pesan `join`. Pesan lain diteruskan apa adanya ke anggota ruang lain (`rooms.relay`). Tidak ada validasi isi dan tidak ada autentikasi.

| Tipe pesan | Arah | Payload (sumber) | Dibaca di |
|---|---|---|---|
| `join` | klien→server | `{ role, roomId? }` | `server.mts` (satu-satunya yang ditafsir) |
| `joined` | server→klien | `{ role, roomId }` | `useRelay` |
| `peers` | server→klien | `{ phones, screens }` | `useRelay` |
| `error` | server→klien | `{ code: no-room \| bad-message \| replaced, message }` | `useRelay` |
| `hello` | HP→layar | `PhoneInfo` (`deviceId`, `deviceLabel`, `capabilities`, `hasIndonesianVoice`) | `ScreenApp` |
| `state` | HP→layar | `PhoneState` (fase, sudut, kecepatan, reps, sensor, rate) | `ScreenApp` |
| `telemetry` | HP→layar | `{ points: TelemetryPoint[] }`, sekitar 10 Hz | `ScreenApp` |
| `breach` | HP→layar | `BreachEvent` (`kind`, `value`, `limit`, `heldMs`, `t`) | `ScreenApp` |
| `calibration` | HP→layar | `CalibrationResult` | tidak ada handler di `ScreenApp` |
| `sessions` | HP→layar | `{ sessions: SessionSummary[] }`, per 10 sesi | `ScreenApp` → `storeSessions` |
| `recording` | HP→layar | `Recording` (sampel mentah) | `ScreenApp` |
| `config` | layar→HP | `SessionConfig` | `PhoneApp` (`s.setConfig`) |
| `sync-request` | layar→HP | `{ deviceId, have: string[] }` | `PhoneApp` |
| `sessions-ack` | layar→HP | `{ ids: string[] }` | `PhoneApp` |
| `asl-frame`, `asl-result`, `asl-status`, `asl-imu` | campuran | data ASL (`app/gesture/AslApp.tsx`) | belum disurvei rinci |
| `g-status`, `g-result`, `g-imu` | campuran | data Mode 2 gesture (`GestureApp.tsx`, `ScreenApp`) | arah pengirim belum saya pastikan |

Catatan: `ScreenApp` tidak menangani `calibration`. Pesan itu hanya dipakai untuk sinkron tampilan lewat `state`.

## 2. Tabel integrasi per lokasi

| Lokasi | Data | Arah | Usulan permukaan API |
|---|---|---|---|
| `hooks/usePhoneSession.ts` `onSample` → `send("breach")` | Breach event langsung dari HP | HP→server→layar | `POST /sessions/:id/breaches` (idempoten per `t`) atau pesan ws `breach` yang server simpan |
| `hooks/usePhoneSession.ts` → `send("state")`, `send("telemetry")` | Status live, titik sudut | HP→layar (tidak disimpan) | Tetap ws. Jangan disimpan di server (sesuai AGENTS.md: tidak menyimpan stream mentah) |
| `lib/rehab/session.ts` `SessionConfig` (`exercise`, `envelope`, `reps`) | Batas keamanan per latihan | layar→HP, dan HP menyimpan lokal | `GET /patients/:pid/envelopes` (dari server ke HP), `PUT /patients/:pid/envelopes/:exerciseId` (dari terapis) |
| `components/rehab/EnvelopeCard.tsx` via `ScreenApp` `useState(DEFAULT_CONFIG)` | Slider batas dari terapis | layar→HP | sama dengan atas. Sekarang hanya di memori. Hilang saat reload |
| `app/phone/PhoneApp.tsx` `changeConfig` → Dexie `settings["phone-config"]` | Batas saat mode tanpa laptop | lokal HP | `GET /me/envelopes` saat login, ganti kalau tersambung |
| `lib/rehab/defaults.ts` `EXERCISES` | Katalog latihan (id, nama, cara pasang) | server→HP dan server→layar | `GET /exercises`. Dipakai `EnvelopeCard`, `SessionHistory`, `PhoneApp` |
| `lib/rehab/defaults.ts` `EXAMPLE_ENVELOPE`, `EXAMPLE_REPS`, `CALIBRATION_*`, `CUE_GAP_MS` | Nilai contoh (bukan klinis). Konstanta kalibrasi dan jeda cue | lokal | Tidak perlu API. Konstanta kalibrasi tetap di HP |
| `lib/rehab/summary.ts` `SessionRecorder.finish` → `SessionSummary` | Ringkasan sesi: reps, `repList`, `breaches`, `trace`, `config`, `reportedBy` | HP→server | `POST /sessions` (upsert per `id`) |
| `app/phone/PhoneApp.tsx` `saveSession` (Dexie `sessions.put` lalu `sendSessions`) | Sesi selesai, disimpan dulu lalu dikirim | HP→layar lalu server | `POST /sessions` dari HP langsung. ws `sessions` jadi cadangan |
| `app/phone/PhoneApp.tsx` `sync-request` / `sessions-ack` | Sesi yang belum sampai | layar→HP | `GET /sessions?deviceId=…&since=…`. Sinkron ditentukan server, bukan layar |
| `app/screen/ScreenApp.tsx` `storeSessions` | Sesi dari HP, `receivedAt`, `therapistNote` lama | HP→layar | `POST /sessions` (server yang menyimpan `receivedAt`) |
| `components/rehab/SessionHistory.tsx` `therapistNote` | Catatan terapis | layar→server | `PATCH /sessions/:id { therapistNote }`. Sekarang hanya Dexie layar |
| `lib/rehab/sessionFiles.ts`, `summary.ts` `makeExport`, `parseImport` | Ekspor/impor JSON | lokal | Tetap sebagai jalur luring. Tambah `POST /sessions/import` opsional |
| `hooks/useSessions.ts` (liveQuery Dexie `sessions`) | Daftar sesi di layar dan HP | lokal | Ganti sumber data ke `GET /sessions`, Dexie jadi cache |
| `lib/device.ts` `getDeviceIdentity` | `deviceId` acak per browser | HP | Hapus sebagai identitas. Ganti dengan id perangkat terikat login (lihat bagian 4) |
| `app/screen/ScreenApp.tsx` `breaches` (max 8, memori) | Daftar breach untuk layar | server→layar | `GET /sessions/:id/breaches` atau `GET /patients/:pid/breaches` |
| `components/rehab/RecordingsCard.tsx`, `ScreenApp` `recording` | Sampel mentah (rekaman uji) | HP→layar→Dexie | Tetap lokal. Jangan dikirim ke server tanpa persetujuan (minimisasi data) |
| `components/rehab/ValidationPanel.tsx` | `appDeg` vs `refDeg` (uji sudut vs busur) | layar lokal | Kandidat backend jika data validasi perlu dikumpulkan. Keputusan tim |
| `server.mts` + `lib/relay/rooms.ts` | Kode ruang 4 digit, satu HP per ruang | ws | Lihat bagian 4 |
| `components/RoomCodeDisplay.tsx` `fetch("/__lan")` | URL LAN untuk QR | server→klien | Tidak perlu pindah ke backend |

## 3. Data yang sekarang hanya hidup di Dexie atau memori

Dexie `rehat-prototype` (IndexedDB), per perangkat:

- `sessions`: `SessionSummary`. Di HP: tanpa `therapistNote`. Di layar: dengan `therapistNote`, `receivedAt`. Harus pindah ke backend (riwayat, breach, catatan terapis).
- `settings`:
  - `device-id`: identitas anonim perangkat. Harus diganti id terikat akun.
  - `phone-config`: batas keamanan di HP. Harus diambil dari server saat login.
  - `reporter`: "patient" atau "caregiver". Harus diganti peran dari akun (AGENTS.md: setiap log menyimpan `reported_by`).
  - `user-name`: hanya Mode 2 (gesture).
- `recordings`: sampel mentah. Tetap lokal, lihat tabel.
- `validations`: data validasi sudut. Lokal.
- `templates`, `gestureTests`, `aslCustom`: Mode 2 (gesture/ASL). Tidak disurvei rinci.

Memori atau sessionStorage saja:

- `ScreenApp` `config` (batas dari terapis) hilang saat reload. Ini gap paling jelas untuk backend.
- `ScreenApp` `breaches` (8 terakhir). Hilang saat reload.
- `sessionStorage["rehat-room"]`: kode ruang. Harus diganti sesi relay bertoken.
- Grafik dan buffer telemetri di kedua sisi. Sengaja tidak disimpan.
- `calibration` (hasil kalibrasi): tidak disimpan di mana pun kecuali lewat ws ke layar. Usulkan simpan sebagai field di ringkasan sesi kalau tim mau bukti kalibrasi.

## 4. Hal yang perlu diputuskan sebelum backend dibangun

1. **Autentikasi relay.** `server.mts` menerima pesan `join` dari siapa pun. Kode ruang 4 digit (`rooms.ts` `newCode`) mudah ditebak. Pesan di luar `join` diteruskan tanpa validasi. Usulan: `join` membawa JWT Supabase. Server cek `patient:{id}` dan peran, lalu validasi pesan (misal zod) sebelum relay.
2. **Relasi peran.** AGENTS.md menyebut terapis, pasien, pendamping, dan kontak darurat dengan relasi berconsent. Kode sekarang hanya punya `phone` dan `screen`, dan `reporter` = patient/caregiver. Belum ada `patientId`.
3. **Arsitektur.** AGENTS.md mengusulkan NestJS + Prisma dan React Native. Repo ini Next.js + Bun + `ws` + Dexie. Permintaan Anda Prisma + Supabase Auth. Ini berbeda dari AGENTS.md, jadi perlu keputusan tim.
4. **Idempotensi.** `SessionSummary.id` dibuat HP (`newId`). Cocok sebagai kunci upsert. `sessions-ack` hanya sekarang bisa diganti dengan respons 200 dari `POST /sessions`.
5. **Ekspor.** `makeExport` menyertakan `therapistNote` karena hanya menghapus `syncedAt` dan `receivedAt`. Ini bertentangan dengan komentar di `summary.ts` yang menyatakan catatan tidak dikirim balik. Ini hanya soal file ekspor lokal, bukan relay.

## 5. Cek yang belum dilakukan

- Tidak membaca `.env` atau file rahasia. Tidak ada env yang dipakai di sini.
- Tidak menjalankan `tsc`, tes, atau app.
- Tidak menyurvei `app/gesture`, `hooks/useGestureSession.ts`, `useAslRecognizer.ts`, `lib/asl`, `lib/gesture` secara rinci. Baris pesan Mode 2 hanya dari grep.
- Tidak membaca `lib/sensor/*` dan `components/rehab/*` selain yang disebut.
- Status repo: `bun.lock` dan `package.json` sudah termodifikasi sebelum survei ini. Tidak saya sentuh.
