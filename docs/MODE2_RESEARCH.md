# Mode 2 research: gesture -> speech + subtitles

Scope reminder: Mode 2 is a pipeline feasibility test, not a sign-language translator. Speech is
Phase 2 in AGENTS.md and "motor vs speech" is still an open team decision.

Labels: FACT (with source) · ASSUMPTION (not validated) · RECOMMENDATION (our proposal).

## 1. Hand tracking: MediaPipe Hand Landmarker
- FACT: two-stage pipeline (palm detector, then a landmark model) that outputs 21 landmarks per
  hand as x, y and relative depth; in video the detector is skipped and the previous frame's
  landmarks give the crop. Zhang et al., "MediaPipe Hands: On-device Real-time Hand Tracking",
  CV4ARVR workshop 2020, arXiv:2006.10214. https://arxiv.org/abs/2006.10214
- FACT (official docs): web API is `@mediapipe/tasks-vision`; `runningMode: "VIDEO"` +
  `detectForVideo(video, timestamp)`; calls are synchronous and block the UI thread (the guide
  suggests a Web Worker). https://ai.google.dev/edge/mediapipe/solutions/vision/hand_landmarker/web_js
- RECOMMENDATION: run in requestAnimationFrame, only when `video.currentTime` changed; 480p
  input; GPU delegate with CPU fallback; serve wasm + model from our own server (no CDN).
- ASSUMPTION: mid-range Android phones reach usable FPS (>= 15). Measure, do not assume.

## 2. Recognition with few examples: template matching + DTW
- FACT: DTW (dynamic-programming time alignment) originates in speech recognition:
  Sakoe & Chiba, "Dynamic Programming Algorithm Optimization for Spoken Word Recognition",
  IEEE Trans. ASSP 26(1):43-49, 1978. doi:10.1109/TASSP.1978.1163055
- FACT: template matching works with very few examples per class for gestures: Wobbrock,
  Wilson & Li, "$1 Recognizer", UIST 2007, doi:10.1145/1294211.1294238 — reports >97% with one
  template and 99% with 3+ on their 2D stroke data, and performance close to DTW.
- FACT: DTW as a 1-nearest-neighbour recognizer trained with few samples, across modalities
  (Kinect, Leap Motion, Wii Remote, ...): Taranta et al., "Jackknife: A Reliable Recognizer with
  Few Samples and Many Modalities", CHI 2017, doi:10.1145/3025453.3026002.
- FACT: multivariate (N-dimensional) DTW with per-class templates and a rejection threshold:
  Gillian, Knapp & O'Modhrain, NIME 2011. https://www.nime.org/proceedings/2011/nime2011_337.pdf
- RECOMMENDATION: resample each segment to 32 frames, z-normalised features, DTW with a
  Sakoe-Chiba band, k-NN (k=1..3) over 5-10 own recordings per word, reject on distance and on
  best-vs-second margin. These accuracy numbers come from other data/modalities: our own
  numbers must come from the "Uji" screen.

## 3. Segmentation (when does a gesture start and stop)
- FACT: segmenting continuous IMU streams into gesture / non-gesture is its own problem; a
  sliding-window approach is evaluated in Wiese et al. (Utah) and continuous custom gesture
  segmentation in Taranta et al., "Machete", ACM TOCHI 2021.
  https://users.cs.utah.edu/~wiese/publications/gestureseg.pdf ·
  https://www.eecs.ucf.edu/isuelab/publications/pubs/Machete-final.pdf
- No peer-reviewed source found (in this search) for the exact "motion energy above rest
  baseline + hysteresis" rule we use. It is a simple, explainable baseline: thresholds are
  relative to a per-session rest calibration and **tuned by testing, not from literature**.

## 4. Why this is NOT sign-language translation
- FACT: sign languages carry grammar and meaning in non-manual channels (face, mouth, eyebrows,
  head); signs with similar hand shapes can differ only by facial cues. Antonakos, Roussos &
  Zafeiriou, survey on mouth modelling in SLR, FG 2015; Madhiarasan & Roy, comprehensive SLR
  review, arXiv:2204.03328 (2022).
- FACT: published BISINDO work using MediaPipe landmarks exists (e.g. JAIC, Polibatam; JDSICE,
  PENS) but uses trained neural classifiers on larger datasets, mostly alphabet or small word
  sets. https://jurnal.polibatam.ac.id/index.php/JAIC/article/view/11878 ·
  https://journals.pens.ac.id/jdsice/article/view/118 (venue/volume metadata not re-checked).
- Consequence: our vocabulary is the team's own test gestures, recorded by us, one hand + phone
  IMU. UI and code must say so.

## 5. Web Bluetooth (asked about during M2)
- FACT: Web Bluetooth is not supported in Safari on iOS (caniuse, through iOS 26.x) and not in
  Firefox; supported in Chrome/Edge on Android and desktop. https://caniuse.com/web-bluetooth ·
  https://developer.mozilla.org/en-US/docs/Web/API/Web_Bluetooth_API
- FACT (spec): it is a client (central) API — a page connects TO a BLE device's GATT server.
  A page cannot advertise or host a GATT server, so two browsers (phone <-> laptop) cannot talk
  over Web Bluetooth.
- RECOMMENDATION: keep WebSocket over Wi-Fi for phone <-> screen. Web Bluetooth only becomes
  useful with a BLE peripheral (the ESP32 node, Tier 1), and then only on Android/desktop Chrome.

## 6. Vocabulary (AAC core vocabulary)
- FACT: AAC practice builds boards from a small high-frequency "core" vocabulary plus personal
  "fringe" words. Adult high-frequency vocabulary from 330k spoken words of 66 adults:
  JSLHR 2021, doi:10.1044/2021_JSLHR-21-00211. Aphasia-oriented adult word lists: Renvall et
  al. 2013 (TalkBank). https://talkbank.org/aphasia/publications/2013/Renvall13.pdf
- FACT: AAC improved functional communication and reduced depression in Indonesian stroke
  patients with motor aphasia: Jurnal Keperawatan Indonesia 18(2), 2015.
  https://jki.ui.ac.id/index.php/jki/article/view/410
- Not found: a published Indonesian core vocabulary list. Our 145-entry list is an ASSUMPTION.
- Why not "every word" via an API: each entry needs recorded gestures (5-10 reps), and
  template DTW is for small vocabularies; open-ended text needs a different input (typing with
  word prediction from a bundled frequency list, or fingerspelling recognition). A word-list API
  would also add a network dependency for no recognition benefit.

## 7. Faster recognition and the face
- Open-end DTW (match a partial series against a prefix): Tormene, Giorgino, Quaglini,
  Stefanelli, "Matching incomplete time series with dynamic time warping", Artificial
  Intelligence in Medicine 45(1), 2009. doi:10.1016/j.artmed.2008.11.007
- Early abandoning / lower bounds for DTW search: Rakthanmanon et al., "Searching and mining
  trillions of time series subsequences under DTW", KDD 2012. doi:10.1145/2339530.2339576
- Face Landmarker + 52 blendshapes (official guide):
  https://ai.google.dev/edge/mediapipe/solutions/vision/face_landmarker/web_js
- Non-manual features matter for sign recognition: Antonakos et al. FG 2015 (section 2 sources).

## 8. Pretrained sign recognition (searched 2026-11-24)
- Chosen: ASL Realtime Transformer, ceyda akin. Code MIT: https://github.com/ceydaakin/asl-realtime ;
  weights CC BY 4.0: https://www.kaggle.com/models/ceydaakin2004/asl-realtime-transformer
- Training data: Google Isolated Sign Language Recognition (Kaggle `asl-signs`, 250 signs,
  MediaPipe Holistic landmarks). Dataset license not verified by us.
- Considered, not used: browser demos without a stated license (SignRead, SignLens, Signspeak);
  in-browser-trained ISL LSTM (SignBridge, Apache-2.0, no pretrained model); Python-only models.
- No pretrained BISINDO model with a usable license was found.

## 9. Avatar physics and smoothing
- Spring bones as used by VTuber avatars (VRM 0.x): stiffness, drag, gravity per joint.
  Parameter descriptions: VirtualCast wiki https://wiki.virtualcast.jp/wiki/en/vrm/setting/spring ;
  Godot SpringBoneSimulator3D https://docs.godotengine.org/en/4.5/classes/class_springbonesimulator3d.html
- Verlet integration + constraint relaxation: T. Jakobsen, "Advanced Character Physics", GDC 2001.
- One Euro filter: G. Casiez, N. Roussel, D. Vogel, "1 Euro Filter", CHI 2012. doi:10.1145/2207676.2208639
