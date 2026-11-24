import type { Candidate } from "@/lib/gesture/classifier";
import { ScoreBars } from "./ScoreBars";

/**
 * Top-3 words as "closeness" bars. DTW gives a distance (lower = closer); we show
 * closeness = 1 - distance / (2 x maxDistance), so the acceptance limit sits at the middle.
 */
export function CandidatesList({
  candidates,
  maxDistance = 1.2,
}: {
  candidates: Candidate[];
  maxDistance?: number;
}) {
  return (
    <ScoreBars
      threshold={0.5}
      thresholdLabel={`batas jarak ${maxDistance.toFixed(2)}`}
      items={candidates.slice(0, 3).map((c) => ({
        key: c.word,
        label: c.word,
        sub: `jarak ${c.distance.toFixed(2)}`,
        value: Math.max(0, 1 - c.distance / (2 * maxDistance)),
      }))}
    />
  );
}
