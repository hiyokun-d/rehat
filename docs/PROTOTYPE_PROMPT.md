# Feasibility prototype — working brief

You are building a throwaway feasibility prototype, not the production app. The only question it
must answer: "does this actually work on real phones?" Optimise for: runs today, easy to test, easy
to read. No auth, no database, no Docker, no deploy. Keep it small enough that I can read every file.
Read AGENTS.md first; its hard rules apply here too.

I want to understand everything you build. After each milestone, append a short section to
docs/NOTES.md: what you built, why it works that way, what broke or surprised you. Plain language.
If you pick a number (threshold, window size), write why and mark it "tuned by testing, not from
literature" unless you have a source.

## Setup (3 devices, 1 network)
- Phone = the sensor. Opens /phone. Reads motion sensors (and camera in Mode 2).
- Laptop = the screen. Opens /screen. Shows live data / subtitles.
- Relay inside the same Node process passes messages between them.
- Pairing: /screen shows a 4-digit room code; phone types it in. One room = one phone + any number of screens.

## Stack (use what's already in the repo — do not add Vite)
- Next.js 16 (App Router) as already installed. Read node_modules/next/dist/docs/ before writing
  Next code; this version has breaking changes. Routes: /phone, /screen, plus a mode switch.
- server.mts: custom Node server = Next request handler + `ws` WebSocketServer on the SAME http
  server (path /ws). One port, one tunnel URL. Rooms by code, messages are JSON
  { type, roomId, t, payload }, no persistence, ~100 lines. Explain in NOTES.md why `ws` over Socket.IO.
- Shared message types + sensor/angle/envelope logic in src/lib/ (pure TS, no React) so it can be unit-tested.
- Package manager: bun. Lint/format: Biome (already configured).
- HTTPS is mandatory (motion + camera need a secure context). Primary: `cloudflared tunnel --url
  http://localhost:3000` (real HTTPS, works on iPhone). Fallback: local HTTPS on the LAN.
  Put both in the README with exact commands.
- iOS: DeviceMotionEvent.requestPermission() must be called from a user tap. Same tap also unlocks
  speech (speak a short utterance). Do both on one big "Mulai" button.
- Keep the screen awake during a session (Wake Lock API, ignore if unsupported).

## UI system (build this before Mode 1 screens, reuse it everywhere)
- Styling: Tailwind 4 only. Design tokens (colors, radius, spacing, shadow) as CSS variables in
  globals.css via @theme. No hex values inside components; use tokens.
- Font: Poppins via `next/font/google` (self-hosted at build time, no runtime Google request).
  Weights 400/500/600/700 only. Default sans font.
- Icons: lucide-react only. NO emoji anywhere: UI, voice text, logs, NOTES.md.
- Animation: `motion` (import from "motion/react"). Functional only: enter/exit of alerts, state
  changes. Durations <= 250 ms. Respect prefers-reduced-motion. Animation must never delay a safety alert.
- Component kit in src/components/ui/ (small, typed props, no business logic): Button, Card, Stat,
  StatusPill (icon + text, never color alone), Alert, Slider (with "CONTOH, bukan nilai klinis"
  badge prop), CodeInput, Screen (page shell), Tabs.
- Composite components in src/components/: LiveChart, RoomCodeDisplay, SubtitleBar, StateIndicator.
  Pages only compose these.
- Rule: extract a component when it's used in 2+ places or is a UI-kit primitive. No speculative
  components. Flag it if the kit grows past ~12 files.
- Accessibility: patient-facing tap targets >= 56 px, WCAG AA contrast, Indonesian labels,
  aria-label on icon-only buttons.
- Phone UI = big, few elements, one primary action per screen. Screen UI = dense dashboard is fine.

## Shared sensor layer (build first, both modes use it)
interface Sample { t: number; ax: number; ay: number; az: number;  // accelerationIncludingGravity, m/s²
                   gx: number; gy: number; gz: number }            // rotationRate, °/s
interface SensorSource { start(): Promise<void>; stop(): void;
  onSample(cb: (s: Sample) => void): void; onStatus(cb: (s: "ok" | "lost") => void): void; }
- PhoneSource (devicemotion), ReplaySource (recorded JSON). Nothing after SensorSource may know
  where data comes from.
- Measure and display the real sample rate per device (event.interval AND timestamps).
- "lost" = no sample for >500 ms. Any mode must pause on "lost".
- Record button saves raw samples as JSON. ReplaySource plays them back.
- Angles and angular speeds only. Never integrate acceleration to get position.

## MODE 1 — Rehat (main; prove the core loop)
- Exercise picker: shoulder flexion (phone on outer upper arm) or elbow flexion with upper arm
  resting on a table (phone on forearm).
- Calibrate: hold still 3 s, store gravity direction. Reject if gyro magnitude above noise floor.
- Angle: tilt from gravity fused with gyro by a complementary filter, alpha ~ 0.98.
  Joint angle relative to the calibrated start. Explain the axis choice in NOTES.md.
- Reps: up-and-back = 1 rep, with hysteresis.
- Envelope on /screen (sliders): maxAngleDeg, maxVelDegPerS, debounceMs. Defaults labelled
  "CONTOH, bukan nilai klinis". Alerts worded as "melewati batas yang diatur terapis".
- Breach held > debounceMs: phone speaks an Indonesian cue + /screen shows a red alert with the value.
- Sensor lost: session pauses on both screens.
- /screen: live chart (10 s), angle, reps, max angle, sample rate, connection status.
- Validation helper: app angle vs protractor/goniometer angle, shows mean error. Our own number.

## MODE 2 — Experimental: gesture -> speech + subtitles
ONLY after M2 passes on both phones. Speech is Phase 2 in AGENTS.md and motor-vs-speech is still
open; this is a pipeline feasibility test. NOT a sign-language translator: real BISINDO uses two
hands, facial expression and its own grammar. Research the approach from peer-reviewed papers /
official docs first; record sources in docs/MODE2_RESEARCH.md.
- MediaPipe HandLandmarker on the phone (VIDEO mode, GPU with CPU fallback, 480p, assets local),
  landmark overlay + FPS; fallback flag to run tracking on the laptop webcam.
- Rest calibration, segmentation REST -> SIGNING -> ENDED -> COOLDOWN -> REST with thresholds
  relative to baseline; ignore <250 ms and >4 s segments.
- Features: wrist-relative, scale-normalised, mirrored landmarks (63) + gravity (3) + gyro (3);
  missing hand = mask.
- Template matching: record 5-10 reps per word, resample to 32 frames, DTW + k-NN, reject on
  distance/margin ("tidak dikenali", stay silent). Top-3 debug panel.
- Output: speechSynthesis id-ID (warn if no voice), subtitle bar, latency segment-end -> subtitle.
- Seed vocab (own test gestures, NOT BISINDO): halo, ya, tidak, terima kasih, tolong, sakit, saya.
- "Uji" screen: accuracy, rejection rate, median latency, JSON export.

## Milestones
M0 server + relay, pairing, HTTPS via tunnel, README. M1 UI kit + sensor layer + record/replay +
raw view. M2 Mode 1 complete. M3 camera + landmarks + FPS. M4 rest calibration + segmentation.
M5 train, DTW classify, reject, speak, subtitles, Uji.
At each stop: what to test, on which device, what "pass" looks like (docs/TESTING.md).

## Rules
- Flag scope creep. No unrequested features.
- No runtime external network calls (fonts self-hosted, MediaPipe assets local).
- No invented clinical thresholds, no medical accuracy claims, no sign-language translation claims.
- Handle: permission denied, camera busy, no Indonesian voice, phone sleeping, socket reconnect.
- Test on one Android (Chrome) and one iPhone (Safari) before calling a milestone done.
- Healthy-teammate tests prove nothing for stroke patients; say so.
