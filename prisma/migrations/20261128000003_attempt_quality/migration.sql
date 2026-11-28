-- Descriptive movement quality per session, computed on the phone (src/lib/rehab/quality.ts).
-- Nullable: older phones and sessions with < 3 reps send none. Not a recovery score.
ALTER TABLE "AttemptSummary" ADD COLUMN "sparcMedian" DOUBLE PRECISION;
ALTER TABLE "AttemptSummary" ADD COLUMN "peakCv" DOUBLE PRECISION;
ALTER TABLE "AttemptSummary" ADD COLUMN "peakTrendDeg" DOUBLE PRECISION;
