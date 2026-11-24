# Testing checklist (no developer needed)

Setup: `bun dev` running on the laptop. Phone on the same Wi-Fi.
Phone URL: `https://<LAN IP>:3443/phone` (accept the certificate warning once).
Do every section on **one Android (Chrome)** and **one iPhone (Safari)**. Write results + phone
model in docs/NOTES.md.

## M0 — connection
- [ ] Laptop `http://localhost:3000/screen` shows a 4-digit code and a QR. **Pass:** "Terhubung".
- [ ] Phone scans the QR. **Pass:** /phone opens with the code pre-filled.
- [ ] Wrong code (e.g. 0000) -> **Pass:** "Kode ruang tidak ditemukan".
- [ ] Reload the laptop tab. **Pass:** same code, phone reconnects by itself.
- [ ] Turn phone Wi-Fi off 5 s and on. **Pass:** relay pill goes "Menyambung ulang" then "Terhubung".

## M1 — sensor
- [ ] Tap Mulai. iPhone: permission prompt appears; allow. **Pass:** "Sensor aktif".
- [ ] Detail teknis: Hz shown. **Record** the Hz and event.interval for this phone.
- [ ] Rekam 10 s, Berhenti. **Pass:** recording listed; "Kirim ke laptop" downloads it on the laptop.
- [ ] Deny permission (iPhone: fresh tab, Tolak). **Pass:** red "Izin sensor gerak ditolak".

## M2 — Mode 1
Shoulder flexion: phone on the outer upper arm, top toward the shoulder.
- [ ] Kalibrasi while moving. **Pass:** "Kalibrasi gagal: HP bergerak".
- [ ] Kalibrasi while still. **Pass:** voice "Kalibrasi selesai", phase "Latihan berjalan", angle ~0.
- [ ] Raise arm to ~90° and back, 5 times. **Pass:** reps = 5 (not 4, not 10).
- [ ] Hold above the max angle > debounce. **Pass:** voice cue in Indonesian + red alert on phone
      and screen with the value. Brief overshoot (< debounce) **does not** alert.
- [ ] Move fast. **Pass:** velocity alert.
- [ ] Lock the phone screen mid-exercise. **Pass:** screen shows "dijeda" within ~1.5 s; after
      unlocking, phone shows "Sensor terputus, latihan dijeda" and Lanjutkan works.
- [ ] Close the phone tab mid-exercise. **Pass:** screen shows "HP terputus dari server".
- [ ] No Indonesian voice installed. **Pass:** yellow warning, cue still spoken with default voice.
- [ ] Phone only (no code): limits panel on the phone works, chart shows.
- [ ] Elbow: upper arm on table, phone on forearm. Same rep + alert checks.

### Validation (our own error number)
Tab "Validasi" on the screen. Per phone, per exercise, at least 10 angles between 0° and 120°:
calibrate, move, hold still, measure with a goniometer app/protractor, type it, Catat.
- [ ] Export JSON. Record n, mean |error|, bias, max error in NOTES.md.
Healthy teammates only. Results say nothing about stroke patients.

### Record per phone in NOTES.md
Model · OS/browser · Hz · event.interval · learned gyro sign · Indonesian voice yes/no ·
wake lock works yes/no · validation numbers.

## M3-M5 — Mode 2 (experimental)
Prep on the laptop once: `bun run assets` (copies MediaPipe wasm, downloads the hand model).
Phone: `https://<LAN IP>:3443/gesture`, tap Mulai, allow camera + motion.
- [ ] Hand visible -> landmarks drawn on the hand. **Record** FPS + GPU/CPU per phone.
      **Pass:** >= 15 FPS (*our bar, not from literature*). Below that, note it in NOTES.md.
- [ ] Camera used by another app -> **Pass:** "Kamera sedang dipakai aplikasi lain".
- [ ] Kalibrasi istirahat (still 3 s). Then move: pill goes "Mulai: merekam", stop: "Berhenti".
      **Pass:** every deliberate gesture gives exactly one start and one stop; a twitch gives none.
- [ ] Latih: for 3-4 words, 5-10 repetitions each. Counts go up by one per repetition.
- [ ] Kenali: perform trained words. **Pass:** correct word spoken + shown; random movement
      gives "Tidak dikenali" and **no speech**.
- [ ] /screen tab "Mode 2: Gestur": subtitle appears, "..." while moving, line clears after ~4 s.
- [ ] Uji: 10 prompts. Save JSON. **Record** accuracy, rejection, wrong-word rate, median latency.
- [ ] HP disandarkan: phone on a stand, camera only. Repeat Kenali.

## Iteration checks
- [ ] Mode 1 calibration with a normal (not rigid) arm: **Pass:** succeeds within ~3-5 s;
      a deliberate movement makes the bar restart, not fail.
- [ ] Latih: after the first recording of a word, the skeleton replay loops above the counter.
- [ ] Pengaturan: set your name; record "nama saya {nama}"; Kenali says "nama saya <name>".
- [ ] Two or more words recognised -> "Ucapkan kalimat" speaks the whole line.
- [ ] Laptop camera: phone on /gesture (same room), laptop /screen -> Mode 2 -> Pakai kamera laptop.
      Move only the phone hand. **Pass:** dashed "perkiraan HP" box follows that hand; the free
      hand gets no box. Record the "cocok" values you see.

## Faster recognition + face
- [ ] Kenali with "Kenali lebih cepat" on: **Pass:** for words with a distinct start, the
      result line shows "x ms sebelum tangan berhenti". Record how often the early word was wrong
      in Uji (wrong early words are spoken!).
- [ ] Same Uji run with it off: compare accuracy and median latency.
- [ ] "Pakai ekspresi wajah" on: badge says "Wajah terlihat" with face in frame. Note FPS with and
      without face on each phone (target >= 15 FPS).
- [ ] Record 2 words with the same hand movement but different face (e.g. brows up vs neutral).
      **Pass:** with face on they are told apart; with face off they are "ambiguous".

## ASL siap pakai (/gesture -> "ASL siap pakai")
- [ ] `bun run assets` once (downloads Holistic 13.7 MB + ASL model 1.5 MB).
- [ ] Laptop: Mulai kamera. All rows in "Yang dilihat kamera sekarang" green with face, shoulders
      and elbows in view. Note FPS and light %. Try "Perjelas kamera" in a dim room.
- [ ] Pick 10 signs in Latihan, watch "Lihat caranya", sign each 3x. Record: rank of the target,
      its %, whether it was spoken. This is OUR accuracy (healthy, non-signing teammates; says
      nothing about Deaf signers or stroke patients).
- [ ] Avatar view: gloves follow fingers, mask eyes blink, mouth opens.
- [ ] Mirror: laptop "Hubungkan HP ke kamera ini" -> scan QR on phone -> phone shows "Dari
      kamera laptop", draws the tracker, speaks results. Phone "Pakai kamera HP ini" -> local.
- [ ] Phone on a stand (no laptop): FPS with Holistic. If < 10 FPS, prefer the laptop + mirror.

## Tracker / avatars / phone position
- [ ] "Coba tanpa kamera": all 4 views animate (Kerangka, Avatar, Kiko, Manusia 3D).
- [ ] Real camera: skeleton lines sit ON your hands/arms (phone portrait and laptop).
- [ ] Laptop "Tampilkan di HP" -> phone scans QR -> phone "Kirim gerak HP" while holding it in
      view of the laptop camera. **Pass:** dashed "HP xx%" box on the holding hand; tilting the
      phone rotates the box the same way (note if it rotates the wrong way, per phone/OS).

## Faster signing (phone gyro)
- [ ] Laptop `/screen` -> ASL siap pakai -> "Tampilkan di HP"; phone joins, taps "Kirim gerak HP",
      phone held in the signing hand. **Pass:** badge "Isyarat cepat: gyro HP", meter shows
      Diam / Bergerak.
- [ ] Do 3 signs in a row, pausing ~0.3 s between, hand NOT lowered. **Pass:** 3 separate words.
      Write down the "ms setelah tangan berhenti" numbers (median of 10).
- [ ] Lock the phone mid-session. **Pass:** badge disappears within ~1 s, normal mode works.
