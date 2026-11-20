<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

Home-based stroke rehabilitation platform: a closed loop between therapist and home, with a sensor-based safety layer.
Full background, reasoning and history: `docs/HANDOFF.md` (the v2 handoff prompt). Read it before any design decision. This file is the short version that must always hold.

## How to work with this team

- Reply in the language the user writes in (usually casual Indonesian + English tech terms).
- Label claims: **FACT** (with source), **ASSUMPTION** (not validated yet), **RECOMMENDATION** (a proposal the team can change).
- For key decisions use: Options → Trade-offs → Recommendation → What would change it.
- Explain the _why_ behind code and design. The bar: a teammate could rebuild it without you. Code nobody understands is a liability.
- If an assumption here looks wrong, say so and give reasons. Do not just agree.
- Flag scope creep, size creep and new network dependencies the moment you see them.
- Not medical or legal advice. Say so when it matters.

## Hard rules (never break)

1. **Never invent clinical thresholds.** Every angle, speed or time in this repo is ILLUSTRATIVE until a therapist sets it. Real limits come from the therapist, per patient, per exercise.
2. Rehat does **not** diagnose, does **not** change exercise programs automatically, and does **not** replace therapists. Reject features that do.
3. Adherence (exercise completion %) is **not** a recovery indicator. Never show or name it as one.
4. "Dangerous movement" = whatever the therapist's safety envelope says. The app does not decide what is safe.
5. Position alerts as "based on limits set by your therapist", never as the app judging medical safety (medical-device regulation risk).
6. Not monitored = not safe: if the sensor link drops, pause the exercise and tell the user.
7. Competitor info (PulihGo) comes only from its Devpost page. Do not claim anything about their repo unless someone has checked it.

## Product in one screen

- **Core loop:** therapist sets program + safety envelope → patient exercises at home (with a companion if present) → sensor checks movement against limits, alerts on breach → activity, difficulties and safety events are logged → therapist reviews and adjusts → repeat.
- **Users**
  - Therapist (web dashboard): registers patients, builds plans, sets safety envelopes, reviews logs and safety events.
  - Patient (mobile): today's exercises (big buttons, demo video), start/finish, can mark "cannot do" or "postponed" without it counting as failure.
  - Caregiver (mobile, Level 1): reminders, alerts, can log on the patient's behalf. A _role_ linked by invite + consent, not a type of person.
  - Emergency contact (Level 0): name + WhatsApp number, no account. Receives escalations.
- Every log stores `reported_by` (patient or caregiver).
- **Differentiators vs PulihGo:** therapist–patient–companion loop; therapist-set limits per patient; tiered escalation; multimodal path (IMU → insole → camera), including lower limbs.

## Architecture (RECOMMENDATION, provisional)

- Modular monolith, not microservices (small team, centralized domain, easier to deploy and debug).
- **Safety decisions run on the phone (edge)**, not the cloud: low latency, works offline. Events sync to the backend later through an offline queue.
- Store events and session summaries, **not raw sensor streams** (data minimization).

| Part                | Choice                                                           | Alternatives                                    |
| ------------------- | ---------------------------------------------------------------- | ----------------------------------------------- |
| Mobile              | React Native (Expo **dev build**, BLE libs don't run in Expo Go) | Flutter                                         |
| Therapist dashboard | React + Vite or Next.js                                          |                                                 |
| Backend             | NestJS + Prisma                                                  | Express; Laravel if the team is stronger in PHP |
| DB                  | PostgreSQL                                                       |                                                 |
| Auth                | JWT access + rotating refresh; RBAC **plus** relationship check  |                                                 |
| Notifications       | FCM; add Redis + queue only when retries are needed              |                                                 |
| Storage             | S3-compatible, private bucket, presigned URLs                    |                                                 |
| Firmware            | ESP32, Arduino framework / PlatformIO                            | ESP-IDF                                         |
| Deploy              | Docker + VPS, GitHub Actions                                     |                                                 |
| Tests               | Jest, Supertest, Playwright                                      |                                                 |

Suggested layout (RECOMMENDATION):

```
apps/api         NestJS backend
apps/mobile      React Native (patient + caregiver)
apps/dashboard   therapist web
firmware/        ESP32 sensor node
packages/shared  shared types, BLE packet codec, envelope check
docs/            HANDOFF.md, decisions, interview notes
```

Keep the envelope check and the packet decoder in `packages/shared` so mobile and tests use the exact same logic.

## Domain model (outline)

User → Therapist / Patient / Caregiver profile · Patient → CareLink (pending / active / revoked, consent time) · Patient → EmergencyContact · Patient → RehabPlan → PlanExercise → Exercise (catalog) · PlanExercise → SafetyEnvelope · PlanExercise → ScheduledSession → ExerciseLog → Feedback, SafetyEvent · TherapistReview · MediaAsset · AuditLog.

- Keep `Exercise` (catalog) separate from `PlanExercise` (applied to one patient).
- **SafetyEnvelope** (per PlanExercise, set by therapist): `maxAngleDeg`, `maxVelDegPerS`, `debounceMs`, `onBreach` (cue only | cue + pause), `notifyCaregiver`.
- **CareLink flow:** therapist registers patient → invite code/QR (single-use, expiring, rate-limited) → caregiver signs up and enters code → patient (or therapist if the patient can't) approves → active → revocable.

Key endpoints: `POST /patients`, `POST /patients/:id/invites`, `POST /invites/accept`, `POST /patients/:id/plans`, `PUT /plan-exercises/:id/envelope`, `GET /me/schedule`, `POST /sessions/:id/logs`, `POST /safety-events`, `POST /safety-events/:id/ack`, `GET /patients/:id/dashboard`, `POST /media/presign`.

**Authorization test that must always pass:** caregiver A requesting patient B → `403`.

## Sensor node (IoT Tier 1 = MVP)

- ESP32 + MPU6050 over BLE, 2 nodes (upper arm + forearm). One IMU gives a segment's tilt, not a joint angle; the joint angle comes from the two nodes together.
- BLE characteristics: Sensor Stream (Notify), Control (Write: start, stop, calibrate, set sample rate), Status (Read/Notify: battery, firmware, error).
- **Packet, 18 bytes, little-endian:** `seq u16 | tMs u32 | ax ay az i16 | gx gy gz i16`. 50 Hz ≈ 900 B/s, fits the default 20-byte payload. Use `seq` to detect lost packets.
- Send raw data; do sensor fusion on the phone (iterate without reflashing).
- Edge pipeline: 50 Hz → neutral-pose calibration → complementary filter → angle + angular velocity → rep detection (peak-and-return with hysteresis) → envelope check with debounce → cue / pause / push / escalate → summary + events to backend.
- Known issues: MPU6050 has no magnetometer, so yaw drifts (pick exercises with a gravity reference, calibrate each session, BNO055 if needed). Placement varies (marked straps). Must be attachable with one hand. Battery draw not measured yet. Insole FSRs saturate (relative use only); ESP32 ADC2 conflicts with WiFi (use ADC1 or ADS1115).

## Escalation ladder

- L1: breach → voice or vibration cue.
- L2: sustained/repeated breach → pause + push to caregiver.
- L3: no acknowledgement within N seconds (illustrative 30–60 s) → WhatsApp to emergency contact. Stretch goal; official WhatsApp Business API vs other gateways not researched yet (unofficial gateways risk bans).
- L4: new/worsening symptoms or a fall (later) → point to local emergency services. No automated medical advice.
- Against false alarms: debounce + hysteresis, per-session calibration, therapist-tunable sensitivity, "this alert was wrong" button, cap on pushes per session, log every alert.

## MVP scope

**IN:** auth + roles · linking with invite + consent (emergency contact at minimum) · exercise library + plan builder · daily schedule + push reminders · logging (done / cannot / postponed / difficulty + notes + reporter) · therapist dashboard (adherence kept separate from clinical outcome) · one arm exercise with 1–2 IMU nodes + envelope + voice cue + push.

**OUT (do not build):** caregiver marketplace, diagnosis, automatic exercise recommendations, AI recovery scoring, medical-record integration, payments, telehealth video.

**Phase 2:** speech recorder, camera pose estimation (phone/tablet, never ESP32-CAM), insole, offline access, periodic reports, official WhatsApp, fall detection.

**MVP is done when this runs without a developer touching anything:** therapist creates program + envelope → companion links, patient approves → exercise starts from the schedule → IMU node breach triggers cue + pause + push → exercise logged with reporter → therapist sees logs and safety events and writes a note.

## Testing and ethics

- Unit: angle filter, rep counter, envelope check, authorization policy. Integration: API + DB. E2E: Playwright on the dashboard. Hardware-in-the-loop: latency, BLE drop, battery.
- Sensor validation: healthy teammates do scripted correct and out-of-limit reps with ground truth (video or a second person measuring). Report sensitivity = TP/(TP+FN), false-alarm rate, rep-count accuracy, alert latency, angle error.
- Tests on healthy people **do not** prove anything for stroke patients. Say this in the pitch.
- Written consent, no recording without permission, anonymized data, never trial the device on patients without permission and professional supervision.

## Open decisions (do not assume an answer)

- Initial focus: motor, speech, or both.
- Whether caregiver L1 is in the MVP or only the emergency contact.
- Team size, skills, final platform, deadline.
- Who gives consent when the patient can't.
- Not validated yet: patients struggle to attach sensors alone; the companion is the main operator; therapists will actually use the dashboard; PulihGo has no caregiver/dashboard.
- **No therapist or family interview has been done yet.** Interview questions are in `docs/HANDOFF.md` section 9.

<!-- END:nextjs-agent-rules -->
