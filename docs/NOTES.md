# Prototype notes

Plain-language log per milestone: what was built, why, what surprised us.
Numbers marked *tuned by testing* have no literature source.

## M0 — server, relay, pairing, HTTPS (2026-11-24)

**Built.** `server.mts` runs Next.js and a WebSocket relay in one Node process. One HTTP port
(3000) for the laptop, one HTTPS port (3443) for phones on the same Wi-Fi, same rooms behind both.
Room logic is in `src/lib/relay/rooms.ts` (no `ws` inside, so it is unit-tested).

**Why `ws`, not Socket.IO.** We only need "join room" and "forward to the others". That is ~40
lines with `ws`. Socket.IO would add its own protocol, a client library and long-polling
fallbacks we do not need.

**Rooms.** A screen creates a room (4-digit code). A phone can only join an existing room. A new
phone replaces the old one: when a phone's socket reconnects, the old dead socket is still in the
room until the server notices; letting the new one win avoids a "room full" deadlock.
A screen remembers its code in sessionStorage, so reloading the laptop tab keeps the phone paired.

**Heartbeat.** A sleeping phone often never closes its TCP connection. The server pings every
5 s and drops sockets that miss a pong, so the screen learns within ~10 s. *Tuned by feel.*

**HTTPS.** Phones only give `devicemotion` (and camera) to secure pages. `http://192.168.x.x`
loads but the sensor never starts. Options: cloudflared tunnel (real cert) or a self-signed LAN
cert (`bun run cert`). We default to the LAN cert because it needs no account and no internet.
Cost: the phone shows a certificate warning once.

**Surprises.**
- Node 26 runs `.mts` directly, but only "erasable" TypeScript: `constructor(private x)` crashes.
  `erasableSyntaxOnly` is on in tsconfig so `tsc` catches it.
- Next 16 allows only one dev server per folder, and blocks dev assets for hostnames other than
  localhost. `next.config.ts` now adds this machine's LAN IPs automatically (`src/lib/lan.ts`).
  Changing next.config or server.mts needs a restart of `bun dev`.
- A browser extension injected attributes into `<html>`/`<body>` and caused hydration warnings;
  `suppressHydrationWarning` on those two tags only.

## M1 — sensor layer, record/replay, raw view

**Built.** `SensorSource` interface with `PhoneSource` (devicemotion) and `ReplaySource`
(recorded JSON). `BaseSource` holds the callbacks and the *lost* watchdog. Nothing downstream
knows where samples come from — the synthetic demo runs through exactly the same code.

**Lost = no sample for 500 ms** (from the brief). A watchdog checks every 100 ms. Screen locked,
tab in background, permission revoked, replay finished: all become "lost" the same way.

**Sample rate.** `RateMeter` measures from timestamps over a 2 s window (median gap, largest gap)
and we also show the browser's own `event.interval`. Never assumed. Desktop Chrome fires
devicemotion with nulls; those are ignored (no sample).

**Axes.** Spec: `rotationRate.alpha` = around z, `beta` = around x, `gamma` = around y. We map
them to gz, gx, gy. Sign conventions differ between browsers — handled in M2, not here.

**Storage.** Recordings, validation pairs and phone settings live in IndexedDB via Dexie
(`src/lib/db.ts`). localStorage was too small (~5 MB) and synchronous; one minute of raw samples
is ~300 KB.

## M2 — Mode 1: calibrate, angle, reps, envelope, cue, lost -> pause, validation

**Angle, axis-free.** We do not pick "the" gyro axis per placement. Calibration stores the
average gravity direction g0 (phone held still 3 s). Afterwards the segment angle is the angle
between current gravity g and g0: `acos(g·g0)`. Strap the phone slightly rotated, upside down,
or on a browser that flips signs — the angle between two gravity vectors does not change.
It is a *segment tilt from the start pose*, which equals the joint angle only when the movement
stays in one plane (shoulder flexion with the arm otherwise still; elbow flexion with the upper
arm on the table). Abduction or trunk lean will also show up as angle. We do not claim more.

**Gyro fusion.** Accelerometer tilt is noisy while the arm accelerates. The gyro gives the rate
of change: gravity seen from the phone turns as `dg/dt = -ω × g`, so `dθ/dt = -(dg/dt · g0)/sin θ`.
Complementary filter: `angle = 0.98·(angle + rate·dt) + 0.02·tilt` (α from the brief).
Near θ = 0 the direction is undefined (sin θ ≈ 0), so below 3° we use tilt only.

**Gyro sign is learned, not hard-coded.** Browsers disagree on the sign of rotationRate. During
the first clear movements (>20°/s, beyond 10°) we compare the gyro-predicted change with the
accelerometer change; after 15 votes the sign is fixed. Until then the filter uses tilt only.
The learned sign is shown in "Detail teknis" / "Data mentah" — record it per phone model.
Unit tests cover all four combinations of flipped gyro / flipped gravity.

**Velocity** for the envelope = gyro component perpendicular to gravity (°/s), i.e. how fast the
segment tilts in any direction. Conservative: sideways motion counts too.

**Calibration rejected** if gyro magnitude ever exceeds 8°/s during the 3 s. *Tuned by testing*
(a phone held on a still arm reads well below this; re-check on real phones).

**Reps.** Up past `upDeg` (30°) then back below `downDeg` (10°). Two thresholds = hysteresis.
Illustrative numbers, editable.

**Envelope.** maxAngleDeg 90, maxVelDegPerS 120, debounceMs 300 — all "CONTOH, bukan nilai
klinis". A breach must last debounceMs; one event per episode; re-arms when back inside.
Cue is spoken on the phone at most every 2.5 s (*tuned by testing*). Alerts say "melewati batas
yang diatur terapis", never "dangerous".

**Not monitored = not safe.** Sensor lost while running -> phone pauses and says so. Screen shows
"paused" when the phone reports it, when its data stops for 1.5 s, or when the phone drops off
the relay mid-exercise (that last case was a gap found in review and fixed).

**Phone-only mode (team request).** The room code is optional. Without a screen, the phone shows
its own 10 s chart and the limit sliders (saved in Dexie). With a screen connected, the screen's
limits win and the phone shows them read-only.

**Validation helper.** Screen tab "Validasi": type the angle measured with a protractor /
goniometer app; it stores app-vs-reference pairs and shows mean |error|, bias, max error. Only
logs while the phone is calibrated and the arm is still (<5°/s, *tuned by testing*).
This is our measurement error on healthy people — it proves nothing for stroke patients.

**LAN HTTPS, second attempt.** The first version ran a real `https` server next to the HTTP
one and passed its requests to Next. Pages loaded but never hydrated: Next's dev hot-reload
socket (`/_next/hmr`) silently hangs when handed a TLS socket, and the dev client waits for it.
Fix: port 3443 is now a plain TLS pass-through (`node:tls` decrypts, pipes bytes into port 3000).
Next only ever sees HTTP; Host/Origin still say the LAN address. Verified: HMR, relay, pages.

**Verified so far (synthetic data, desktop Chrome):** 60 Hz pipeline, peak 99° vs 100° generated,
reps counted, breach alert + log on both screens, QR pairing, `?room=` pre-fill, Dexie writes.
**Not verified yet:** real Android, real iPhone, voice on each, wake lock, sign per phone.

## M3-M5 — Mode 2: camera, segmentation, templates (EXPERIMENTAL)

Sources and reasoning: `docs/MODE2_RESEARCH.md`. Not a sign-language translator; seed words are
our own test gestures.

**M3 camera + landmarks.** `useCamera` (front camera, 640x480 ideal) and `useHandTracker`
(MediaPipe Hand Landmarker, VIDEO mode, `detectForVideo(video, performance.now())` inside
requestAnimationFrame, only when `video.currentTime` changed — the official web pattern).
GPU delegate first, CPU fallback. Wasm + model are served from `/mediapipe` (`bun run assets`),
no CDN. Size: ~22 MB on first load per phone (14.6 MB wasm + 7.8 MB model) — fine on LAN, flag
for anything public. FPS and delegate are shown on the video. Laptop-webcam fallback flag: not
built yet; only build it if phones measure < ~15 FPS.

**M4 rest calibration + segmentation.** 3 s rest: baseline = mean + 2 SD of gyro magnitude and of
landmark speed (*tuned by testing*). Motion energy = gyro/baseline + landmark speed/baseline
(hand only when the phone is propped). Moving = energy >= 3 (slider). Start after 150 ms moving,
end after 400 ms still, drop < 250 ms or > 4 s, 500 ms cooldown (brief values, *tuned by
testing*). Simplification vs the brief: we do not yet use "hand pose left the rest pose" as a
start trigger — energy only. Add it if slow gestures are missed.

**M5 templates + DTW.** Each segment is resampled to 32 frames. Frame distance = hand landmarks
(wrist-relative, scaled by wrist->middle MCP, left hand mirrored; missing hand = fixed cost, not
zeros) + IMU (gravity direction + gyro/200). DTW with a Sakoe-Chiba band (25%), cost per step.
Per word: mean of the 2 closest templates. Reject when best > 1.2 or when best and second are
within 15% — *both tuned by testing, starting guesses*. Rejected = "tidak dikenali", nothing is
spoken. Templates + vocabulary in Dexie, export/import JSON. "Uji" reports accuracy, rejection
rate, wrong-word rate (the costly error) and median latency (segment end -> result, on the phone;
cross-device latency is not measured because phone and laptop clocks are not synced).

**Pause rule.** If the phone IMU is lost (and the phone is not propped), detection pauses.

**Verified:** unit tests (DTW speed invariance, missing-hand cost, classify/reject, segmenter
start/end/too-long). Pages render and hydrate; screen tab + QR to /gesture work.
**Not verified yet:** MediaPipe on real phones (FPS!), segmentation feel, any accuracy number.

## Iteration after first phone tests (2026-11-24)

**Calibration was too strict.** Old rule: fail if the gyro ever exceeded 8°/s in 3 s. One tremor
spike failed it, and a human arm is never perfectly still. It also measured the wrong thing:
what sets the zero point is the *gravity direction*, not gyro silence.
New rule (`session.ts`, `angle.ts`): a 3 s "steady streak" where 95% of samples are within 5° of
the streak's mean gravity direction (percentile, so one spike does not fail it). A sample >10°
off restarts the streak (the progress bar drops back) instead of failing. Fail only after 10 s
without a steady streak. All three numbers *tuned by testing*. Tests cover tremor noise,
"move then still" and "never still".

**Latih demo.** The first recording of a word is replayed as an animated hand skeleton
(`HandSkeletonPlayer`), so later repetitions stay consistent. Deliberately NOT a "how to sign X
in BISINDO" demo: we would be inventing signs. Real BISINDO references must come from Deaf
signers / official sources, with permission.

**Laptop camera experiment (team idea).** `/screen` -> Mode 2 tab -> "Pakai kamera laptop".
Webcam tracks both hands; the phone streams its gyro magnitude (`g-imu`, 10 Hz batches). The hand
whose landmark speed correlates with the gyro over the last 1.5 s (Pearson >= 0.4, *tuned by
testing*) is taken as the phone hand and gets a dashed "perkiraan HP" box around the palm.
Manual Kiri/Kanan override. No phone-detector model (a COCO "cell phone" detector was considered:
+~5 MB and the holding hand often hides the phone). Clocks are not synced: batches are anchored
at laptop receive time, so expect ~50-150 ms skew on Wi-Fi (ASSUMPTION, not measured).
Classification still runs on the phone; moving it to the laptop is the next decision.
Trade-off: the laptop sees both hands (and later the face) with more compute, but it does not
help phone-only users — keep it as an extra setup, not a replacement.

**Vocabulary.** 145 entries in 11 groups (`src/lib/gesture/vocab.ts`), AAC-board style: core
words, greetings, self, answers, questions, needs, feelings, body, "for loved ones", exercise,
time/place. Draft list (no Indonesian AAC core list found) — validate with therapists and users.
`nama saya {nama}` is filled with the name from Pengaturan. "Ucapkan kalimat" speaks the whole
subtitle line. Only words with recorded gestures are candidates, so a big list costs nothing
until trained — but accuracy will drop as more words are trained; measure with Uji.

## Faster recognition + face channel (2026-11-24)

**Where the time went.** Measured: classify() over 300 templates = ~12 ms on the laptop
(bun, SYNTHETIC data). Compute was not the bottleneck; the 400 ms "hand must be still" wait
(`endMs`) was. So the main change is *when* we decide, not how fast DTW runs.

**Early recognition (`classifyPartial` + `EarlyDecider`).** While the hand is still moving,
every 120 ms the gesture-so-far is matched against the *start* of each template with open-end
DTW (Tormene et al. 2009): the partial is resampled at the template's time rate and may end
anywhere in the template. A word is spoken early only if, on 2 checks in a row: it is the same
word, distance <= 0.8 x maxDistance, margin >= 2 x minMargin, and >= 60% of the template is
done. Stricter than the final rule on purpose ("wrong words are worse than silence"). When the
hand stops, the word is not repeated; latency is reported as negative ("x ms before the hand
stopped"). All numbers *tuned by testing*. Toggle: Pengaturan -> "Kenali lebih cepat".
Risk: two words that share a long identical start will wait (ambiguous) until they differ —
correct behaviour, but those words gain nothing.

**DTW speed-ups** (kept because they are free): packed Float32Arrays, two rolling rows, early
abandoning (Rakthanmanon et al. 2012) above maxDistance / (1 - minMargin) — beyond that a
template cannot change the decision. Gain on synthetic data was ~0; expect more with many real
templates that are far apart. Not measured on phones yet.

**IMU at full rate.** The camera gives ~15-30 FPS, the IMU 60-100 Hz. Before, each camera frame
took only the latest IMU sample; now gyro is averaged over all samples since the previous frame,
so short motions between frames are not lost.

**Face channel (opt-in).** Sign languages use the face (brows, mouth, head nod/shake). With
"Pakai ekspresi wajah", MediaPipe Face Landmarker runs every 2nd camera frame (protect FPS) and
adds 13 blendshape scores + 3 head-pose numbers (nose vs eye midpoint, eye-line angle) per
frame (`face.ts`). In DTW the face is compared only when both frames have it and never
penalised when missing (face hidden by the hand, or templates recorded without face). Weight
slider, default 0.5 *tuned by testing*. Cost: +3.6 MB model, lower FPS — measure on phones.
Templates recorded before turning face on have no face data: re-record to benefit.

**Body pose: not added.** The phone front camera at arm's length sees face + one hand, not the
shoulders/torso. Pose fits the laptop-camera setup better; it would add another model (~5-9 MB)
and cost FPS. Decide after phone FPS numbers with hand + face.

**"Connected through Bluetooth": we are not.** The phone talks to the laptop over Wi-Fi
WebSocket. Web Bluetooth cannot connect two browsers (central-only, no iOS Safari). BLE would
not make recognition faster anyway: all recognition runs on the phone; the link only carries
results and status.

## Pretrained ASL ("ASL siap pakai" in /gesture) (2026-11-24)

**Why.** Nobody on the team signs, so "record your own words" cannot be tested meaningfully.
We found a pretrained, landmark-based model that runs in the browser:
- Model: `ceydaakin2004/asl-realtime-transformer` (Kaggle, **CC BY 4.0**), int8 TFLite 1.5 MB,
  250 isolated ASL signs (Google Isolated Sign Language Recognition data, toddler vocabulary).
  Author reports 74.7% top-1 on held-out signers, 55.1% on WLASL clips (no fine-tuning).
  0 stars, single author: treat as experimental. Our own accuracy: NOT measured.
- Preprocessing ported from github.com/ceydaakin/asl-realtime (MIT) to `src/lib/asl/preprocess.ts`;
  `tests/asl.test.ts` checks it against their fixture written by the Python training code.
- Runtime: LiteRT.js (`@litertjs/core` 2.5.3, Apache-2.0) on WebAssembly. Model ~16 ms first
  run in desktop Chrome (our check), ~3.5 ms per upstream. Phones: not measured.
- Tracker: MediaPipe Holistic (face + hands + body in one model, 13.7 MB).
- Not used: the Google ISLR dataset itself (license not verified), any video dictionary content
  (we only link to SignASL.org per sign).

**What the model reads** = 40 lip points + the dominant hand + 5 arm points, over up to 64 frames:
the face, the hand shape and the arm movement. One sign = "raise hand, sign, lower hand"
(hand absent for 8 frames ends it). A live guess runs every 6 frames while signing (shown, not
spoken). Spoken only if the top probability >= 50% (*tuned by testing*). Words shown/spoken in
Indonesian (`glossId.ts`, team-written glosses) or English.

**"Why isn't it working?" visuals.** `CameraChecks`: hand visible, hand big enough (>= 12% of
the picture height), lips visible, elbow + wrist inside the picture, light >= 25%, FPS >= 15
(all *tuned by testing*). `ScoreBars`: top-5 probabilities with the confidence line; a practice
target shows its rank out of 250. The custom-word recogniser got the same bars (closeness =
1 - distance / (2 x maxDistance), limit in the middle) plus plain-language reasons
(`explain.ts`: too far / ambiguous / hand not visible / too few recordings).

**Bad laptop webcams.** Camera asks for 1280x720 (small, far hands get more pixels).
"Perjelas kamera" draws each frame on a canvas with brightness/contrast BEFORE tracking (the
model sees the enhanced frame). Canvas `filter` is not supported everywhere; then it is a no-op.

**Avatar ("VTuber") view.** Gloves on the hands, a mask with blinking eyes and moving mouth,
sleeves on the arms, drawn from the landmarks on a plain background; the camera image is hidden.
For fun and privacy; the recogniser does not use it.

**Laptop -> phone mirror.** Laptop: Pengaturan -> "Hubungkan HP ke kamera ini" shows a QR
(`/gesture?mode=asl&room=XXXX`). The phone, while its own camera is off, receives ~15 landmark
frames/s (~2 KB each, only the points it draws, no video), status 4x/s and results, and draws
them (skeleton or avatar). The phone speaks; the laptop stays quiet while a phone is connected.
Starting the phone's own camera switches it to local recognition.

**Bluetooth (again).** Still not used: two browsers cannot pair over Web Bluetooth; the mirror
runs over the same Wi-Fi relay as everything else.

## Tracker polish, phone position, avatars (2026-11-24)

- **Smoothing (drawing only):** One Euro filter per landmark (Casiez, Roussel & Vogel, CHI 2012):
  strong smoothing when still, little lag when fast. minCutoff 1.5 Hz, beta 8 (*tuned by testing*).
  The recognisers still get raw points (the ASL model was trained on raw MediaPipe output).
- **Overlay alignment bug fixed:** the video is `object-cover` (cropped) but points were drawn
  as if uncropped, so on a portrait phone the skeleton was offset. Points now go through the
  same cover/contain mapping. The stage box also takes the picture's shape, so a laptop mirror
  or the demo is not letterboxed tiny on a phone.
- **Phone position (`phoneLocator.ts`):** the paired phone ("Kirim gerak HP") streams gyro
  magnitude + gravity. Which hand: correlation of each hand's landmark speed with the gyro over
  1.5 s (>= 0.4, switch only if the other hand wins by 0.15). Where: centred on that palm,
  1.6 x wrist-to-knuckle tall. Tilt: roll from the phone's gravity vector. Roll sign per
  platform is an ASSUMPTION, not verified on iOS/Android yet. No phone-detector model.
- **Desktop:** "ASL siap pakai" is also a tab in `/screen` (full width). Camera asks 1280x720.
- **Demo without a camera:** "Coba tanpa kamera" draws a SYNTHETIC figure (waves, blinks,
  talks, turns its head) through the same overlay, to check views/physics/layout anywhere.
- **Avatar views:** Kerangka (what the model sees), Avatar (gloves + mask), Kiko (original
  cloud-fox, 2D), Manusia 3D (original human built from Three.js spheres/cylinders, lit,
  lazy-loaded: three@0.170.0, ~150 KB gzip, only when that view is picked). Camera image is
  hidden in avatar views (privacy).
- **Physics (`springChain.ts`):** VRM-style spring bones (stiffness pulls back to the rest
  direction, drag damps, gravity droops) integrated with Verlet + a length constraint
  (Jakobsen, GDC 2001). Used for Kiko's ears/hair/sprout and the 3D hoodie strings. Values tuned
  by eye. Depth in 3D is faked by lighting: the tracker gives 2D points.

## Faster signing with the phone in the signing hand (2026-11-24)

- **Problem:** with the camera alone a sign ends only when the hand leaves the picture (lower
  the hand, then 8 frames = 270-530 ms on a 15-30 FPS webcam). So no fluent sentences.
- **Fix (`motionGate.ts`):** the phone's gyro (60-100 Hz, sent to the laptop in 40 ms batches)
  decides start/end. Start = above max(40°/s, 3x rest noise) for 60 ms. End = below
  max(20°/s, 1.5x rest noise) for 180 ms. Signs < 250 ms or > 4 s are dropped. Camera frames
  wait in a 200 ms pre-roll so the start of the sign is not lost. All numbers *tuned by testing*
  on SYNTHETIC gyro, not on real signers yet.
- **Result shows** "x ms setelah tangan berhenti" (hand stopped -> word ready) so we can measure.
- **Fallback:** no gyro for 1 s (phone locked, Wi-Fi drop, toggle off) -> back to the camera
  segmenter automatically. Badge "Isyarat cepat: gyro HP" shows which mode is active.
- **Limits:** only helps when the phone is IN the signing hand. A sign that holds still
  (some static handshapes) can end too early: ASSUMPTION, needs testing with real signs.
  The model was trained on clips cut differently (by its dataset), so cut points may change
  accuracy; unmeasured.

## Faster without the phone: cut on a pause + early accept (2026-11-24)

- **Cut on a pause (default, `CAMERA_GATE`):** the same MotionGate, fed by camera hand speed
  (mean movement of the 21 hand points, picture heights/s). Start > 0.25/s, end = below 0.1/s
  for `stillMs` (200 ms, slider 100-600). No hand = speed 0, so leaving the picture still ends
  a sign. Old rule ("hand-out", 8 frames) is still a setting.
- **Early accept:** live guess every 3 frames (was 6). If the top sign is >= the confidence
  slider AND the same as the previous live guess AND >= 8 frames of signing, the word is
  accepted before the sign ends; that sign's end result is then skipped (one sign = one word).
- **Trade-off:** faster = more wrong words, especially with confidence at 25%. Two signs done
  without any pause merge into one clip (early accept then answers only the first).
- All numbers *tuned by testing* on SYNTHETIC data. Measure with "ms setelah tangan berhenti".

## Missing everyday words + phrases (2026-11-25)

- The model's 250 signs are toddler first words (no I/ME/YOU/NAME/FRIEND...). Checked against
  `public/asl/signs.json`. It DOES have `minemy` (my/mine), `thankyou`, `please`, `hello`,
  `fine`, `not`, `hungry`, `thirsty`.
- **Kata tambahan (`customSigns.ts`):** 26 words the user records 3x (min 2). Features = the same
  window the model reads (hand + elbow + wrist), relative to the mouth centre / mouth width.
  DTW nearest recording; accepted if distance <= max(0.15, 1.5x the spread of your own repeats)
  (*tuned by testing* on SYNTHETIC data). A match beats the model. While a partial sign looks
  like a recorded word, early accept waits. Works only for the person who recorded.
- **Phrases:** the last signs are replaced by a natural sentence, e.g. MY NAME ->
  "nama saya {nama}", NICE MEET YOU, I LOVE YOU, I NEED HELP, I NOT UNDERSTAND. Written by the
  team, not checked by a Deaf signer (ASSUMPTION). Hints per word are memory aids, not lessons.
- Name is shared with "Kata saya" (`USER_NAME_KEY`). Recordings live in Dexie `aslCustom`.
