// Half-circle gauge: the arm's angle as a filled arc, the therapist's limit as a red tick.
// Readable from a distance (patient on a chair, phone on the arm, nurse across the room),
// and it shows "how close to the limit" without reading numbers. The number is still there.
import { cn } from "@/lib/cn";

const R = 80;
const CX = 100;
const CY = 96;
const MAX_DEG = 180; // gauge scale, not a limit

/** Point on the arc for an angle 0..180 (0 = left end, 180 = right end). */
function at(deg: number, r = R) {
  const a = Math.PI - (Math.min(MAX_DEG, Math.max(0, deg)) / MAX_DEG) * Math.PI;
  return { x: CX + r * Math.cos(a), y: CY - r * Math.sin(a) };
}

function arc(from: number, to: number) {
  const a = at(from);
  const b = at(to);
  const large = to - from > 180 ? 1 : 0;
  return `M${a.x} ${a.y} A${R} ${R} 0 ${large} 1 ${b.x} ${b.y}`;
}

export function AngleGauge({
  angleDeg,
  limitDeg,
  over,
  label = "Sudut",
  className,
}: {
  angleDeg: number | null;
  limitDeg: number;
  over?: boolean;
  label?: string;
  className?: string;
}) {
  const v = angleDeg ?? 0;
  const tickIn = at(limitDeg, R - 14);
  const tickOut = at(limitDeg, R + 12);
  return (
    <svg
      viewBox="0 0 200 112"
      role="img"
      aria-label={`${label} ${angleDeg === null ? "belum ada" : `${v.toFixed(0)} derajat`}, batas ${limitDeg} derajat`}
      className={cn("block w-full", className)}
    >
      <path
        d={arc(0, MAX_DEG)}
        fill="none"
        strokeWidth={14}
        strokeLinecap="round"
        className="stroke-surface-2"
      />
      {angleDeg !== null && v > 0.5 && (
        <path
          d={arc(0, v)}
          fill="none"
          strokeWidth={14}
          strokeLinecap="round"
          className={over ? "stroke-danger" : "stroke-primary"}
        />
      )}
      <line
        x1={tickIn.x}
        y1={tickIn.y}
        x2={tickOut.x}
        y2={tickOut.y}
        strokeWidth={4}
        strokeLinecap="round"
        className="stroke-danger"
      />
      <text
        x={tickOut.x}
        y={tickOut.y - 4}
        textAnchor="middle"
        className="fill-muted text-[9px]"
      >
        batas {limitDeg}°
      </text>
      <text
        x={CX}
        y={CY - 8}
        textAnchor="middle"
        className={cn(
          "text-[40px] font-semibold tabular-nums",
          over ? "fill-danger" : "fill-text",
        )}
      >
        {angleDeg === null ? "–" : `${v.toFixed(0)}°`}
      </text>
      <text
        x={CX}
        y={CY + 12}
        textAnchor="middle"
        className="fill-muted text-[10px]"
      >
        {label}
      </text>
    </svg>
  );
}
