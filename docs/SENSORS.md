# Phone sensors and browser APIs we can use (research, 2026-11-27)

Question: what can a phone *browser* give Rehat, on Android Chrome and iPhone Safari?
Labels: FACT (with source) / ASSUMPTION / RECOMMENDATION. In-app check: `/phone` ->
"Sensor di HP ini" (feature detection on that exact phone, also shown on the laptop in
"Data Awal"). Fill the per-phone table at the bottom from it.

| API | Android Chrome | iPhone Safari | What Rehat does with it |
|---|---|---|---|
| DeviceMotion: `accelerationIncludingGravity`, `rotationRate`, `interval` | yes | yes, permission from a tap | Core: angle + angular speed (safety envelope). Unchanged. |
| DeviceMotion: `acceleration` (no gravity) | yes (most) | yes | NEW: recorded as `lx/ly/lz` + live chart. Never integrated to distance (AGENTS.md). |
| DeviceOrientation (alpha/beta/gamma) | yes | yes, own permission prompt | NEW: context only ("how was the phone strapped"). Not used for limits: alpha drifts without a magnetometer reference. |
| `webkitCompassHeading` | no | yes | NEW: shown as context. |
| Generic Sensor API (Accelerometer, Gyroscope, LinearAcceleration, Gravity, Orientation) | yes | no | Detected only. RECOMMENDATION: keep devicemotion, it works on both platforms. |
| Magnetometer, AmbientLightSensor | behind `chrome://flags` | no | NEW: read at 2 Hz if the browser exposes them. Patients will not enable flags, so treat as debug only. |
| Vibration (`navigator.vibrate`) | yes | no (ASSUMPTION: from background knowledge, not confirmed in this search) | NEW: L1 cue on a limit breach and on sensor-lost, next to the voice. |
| Battery Status (`getBattery`) | yes | no | NEW: battery at session start/end -> "battery used" per session (AGENTS.md open item: battery draw not measured). |
| Wake Lock | yes | yes | Already used. |
| BarcodeDetector (QR) | yes | no: disabled by default / behind a flag | NEW: in-app "Pindai QR" on Android. iPhone uses its Camera app (opens `/phone?room=CODE`). |
| Web Bluetooth | yes | no (no iOS browser on WebKit; Bluefy app is a workaround) | NEW, experimental: `BleSource` for the Tier 1 ESP32 node. |
| Web Share with files | yes | yes | NEW: share the history JSON via WhatsApp/email without a laptop. |
| Geolocation, microphone, contacts | — | — | Not used. Not needed for the exercise, and a privacy cost (data minimization). |

Sources: Chrome "Sensors for the web" (https://developer.chrome.com/articles/generic-sensor/),
caniuse Sensor API (https://caniuse.com/mdn-api_sensor), caniuse Web Bluetooth
(https://caniuse.com/web-bluetooth), WebKit bug 101034 (https://bugs.webkit.org/show_bug.cgi?id=101034),
caniuse BarcodeDetector (https://caniuse.com/mdn-api_barcodedetector). Support changes fast:
re-check before the pitch, and trust the in-app detection over this table.

## Web Bluetooth: what it can and cannot do
- CAN: phone or laptop Chrome connects to a BLE *peripheral* (ESP32 sensor, later insole).
  `src/lib/sensor/bleSource.ts` + `blePacket.ts` (18-byte packet from AGENTS.md, Option A).
  UUIDs are ours; the firmware must use them. Scale = MPU6050 defaults (±2 g = 16384 LSB/g,
  ±250 °/s = 131 LSB per °/s, datasheet). Lost packets counted from `seq`.
- CANNOT: link the phone to the laptop (both are centrals; browsers cannot advertise).
  Phone <-> laptop stays on the Wi-Fi relay. CANNOT run on any iPhone browser.
- Status: decoder unit-tested, BleSource NOT tested (no firmware). Tier 1 per AGENTS.md;
  started early because the team asked. Option B (30-byte, two IMUs) not done.

## Per-phone results (fill in)
| Phone | OS / browser | linear accel | orientation | vibrate | battery | QR scan | BLE |
|---|---|---|---|---|---|---|---|
