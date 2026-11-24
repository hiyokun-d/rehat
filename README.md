# Rehat — feasibility prototype

Question this answers: **does phone-as-sensor actually work on real phones?** Not the product.
Brief: `docs/PROTOTYPE_PROMPT.md` · Notes per milestone: `docs/NOTES.md` · Checklist: `docs/TESTING.md`.

## Run
```sh
bun install
bun run cert   # once: self-signed HTTPS cert for your LAN IP (re-run if the IP changes)
bun run assets # once: MediaPipe wasm + hand model into public/mediapipe (Mode 2)
bun dev        # node server.mts: Next.js + WebSocket relay
```
The server prints:
```
> Rehat prototype on http://localhost:3000        <- laptop
> Phones (same Wi-Fi): https://192.168.1.29:3443  <- phone
```

### Phone only (no laptop needed)
Open `https://<LAN IP>:3443/phone` on the phone, accept the certificate warning once, tap **Mulai**.
Limits are set on the phone under "Latihan & batas" (all values are examples).

### Phone + screen
1. Laptop: open `http://localhost:3000/screen`. It shows a room code and a QR.
2. Phone: scan the QR (it points at the HTTPS LAN address) or open `/phone` and type the code.
3. Tap **Mulai**. Limits now come from the screen.

Why HTTPS: phone browsers only give motion sensors and camera to secure pages. Plain
`http://192.168.x.x:3000` loads but the sensor never starts.

### Alternative: tunnel (real certificate, works across networks)
```sh
brew install cloudflared
cloudflared tunnel --url http://localhost:3000
```
Open the printed `https://*.trycloudflare.com/screen` on the laptop; the QR then uses that URL.

## Mode 2 (experimental): gesture -> speech
`https://<LAN IP>:3443/gesture` on the phone; `/screen` tab "Mode 2: Gestur" for subtitles.
Not a sign-language translator. Research + sources: `docs/MODE2_RESEARCH.md`.

Two modes on that page:
- **Kata saya**: record your own gestures (any language), recognised by DTW on this device.
- **ASL siap pakai**: pretrained model, 250 American Sign Language signs, nothing to record.
  Needs `bun run assets` (Holistic tracker + model). Best on a laptop webcam; a phone can mirror
  the laptop's tracker (Pengaturan -> "Hubungkan HP ke kamera ini"). Model by ceyda akin,
  CC BY 4.0 (https://www.kaggle.com/models/ceydaakin2004/asl-realtime-transformer).

## Test without a phone
`/phone` -> "Coba tanpa sensor" -> "Data sintetis" plays generated movement (not a measurement).

## Checks
```sh
bun test       # angle filter, reps, envelope, rooms
bun run lint
```
