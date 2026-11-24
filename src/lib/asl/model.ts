// Loads the pretrained ASL model (TFLite, run by LiteRT.js on WebAssembly) from our own server.
// Model: ceydaakin2004/asl-realtime-transformer (Kaggle, CC BY 4.0), 250 isolated ASL signs.
// Input: the 64-frame window from preprocess.ts + mask. Output: 250 probabilities.
import { type AslWindow, INPUT_SIZE, N_COLS } from "./preprocess";

export interface AslPrediction {
  top: { sign: string; p: number }[]; // best first
  all: Float32Array; // probability per sign (index = signs[i])
  ms: number; // model time only
}

export type AslClassifier = ((w: AslWindow) => Promise<AslPrediction>) & {
  signs: string[];
};

export async function loadAslClassifier(): Promise<AslClassifier> {
  const { Tensor, loadAndCompile, loadLiteRt } = await import("@litertjs/core");
  await loadLiteRt("/litert/wasm/");
  const [model, signs] = await Promise.all([
    loadAndCompile("/asl/asl.tflite", { accelerator: "wasm" }),
    fetch("/asl/signs.json").then((r) => r.json() as Promise<string[]>),
  ]);
  // The converter does not keep input names: tell xy and mask apart by rank (as upstream does).
  const xyFirst = model.getInputDetails()[0].shape.length === 4;

  const run = async (w: AslWindow): Promise<AslPrediction> => {
    const inputs = [
      new Tensor(w.xy, [1, INPUT_SIZE, N_COLS, 2]),
      new Tensor(w.mask, [1, INPUT_SIZE]),
    ];
    const start = performance.now();
    const outputs = await model.run(xyFirst ? inputs : [...inputs].reverse());
    const all = Float32Array.from(outputs[0].toTypedArray() as Float32Array);
    const ms = performance.now() - start;
    for (const t of [...inputs, ...outputs]) t.delete();
    const top = Array.from(all, (p, i) => ({ sign: signs[i], p }))
      .sort((a, b) => b.p - a.p)
      .slice(0, 5);
    return { top, all, ms };
  };
  return Object.assign(run, { signs });
}
