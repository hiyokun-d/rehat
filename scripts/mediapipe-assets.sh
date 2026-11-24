#!/bin/sh
# Serve all ML assets from our own server (no CDN at runtime). Run once: `bun run assets`.
#  - MediaPipe wasm (from node_modules) + official hand / face / holistic landmarker models
#  - LiteRT.js wasm (from node_modules), runs the pretrained ASL .tflite model
#  - Pretrained ASL model (CC BY 4.0, ceydaakin2004/asl-realtime-transformer on Kaggle)
set -e
cd "$(dirname "$0")/.."
mkdir -p public/mediapipe/wasm public/litert/wasm public/asl
cp node_modules/@mediapipe/tasks-vision/wasm/* public/mediapipe/wasm/
# All LiteRT builds (plain / threaded / JSPI / compat); the browser downloads only the one it picks.
cp node_modules/@litertjs/core/wasm/* public/litert/wasm/

get() { [ -f "$1" ] || curl -fsSL -o "$1" "$2"; }
MP=https://storage.googleapis.com/mediapipe-models
get public/mediapipe/hand_landmarker.task "$MP/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task"
# Optional face channel (Mode 2 "Pakai ekspresi wajah"), ~3.6 MB.
get public/mediapipe/face_landmarker.task "$MP/face_landmarker/face_landmarker/float16/1/face_landmarker.task"
# Face + hands + body in one model, for the pretrained ASL page (/asl), ~13.7 MB.
get public/mediapipe/holistic_landmarker.task "$MP/holistic_landmarker/holistic_landmarker/float16/latest/holistic_landmarker.task"

if [ ! -f public/asl/asl.tflite ]; then
  tmp=$(mktemp -d)
  curl -fsSL -o "$tmp/m.tgz" \
    https://www.kaggle.com/api/v1/models/ceydaakin2004/asl-realtime-transformer/tfLite/int8/1/download
  tar -xzf "$tmp/m.tgz" -C "$tmp"
  cp "$tmp/asl_int8.tflite" public/asl/asl.tflite
  cp "$tmp/signs.json" public/asl/signs.json
  rm -rf "$tmp"
fi
ls -la public/mediapipe public/litert/wasm public/asl
