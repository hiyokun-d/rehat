import { ExampleBadge } from "./Badge";

export interface SliderProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  unit?: string;
  example?: boolean; // shows "CONTOH, bukan nilai klinis"
  onChange: (v: number) => void;
}

export function Slider({
  label,
  value,
  min,
  max,
  step = 1,
  unit,
  example,
  onChange,
}: SliderProps) {
  return (
    <label className="block">
      <div className="mb-1 flex flex-wrap items-center justify-between gap-2 text-base">
        <span className="font-medium">{label}</span>
        <span className="font-semibold tabular-nums">
          {value}
          {unit && <span className="ml-0.5 text-muted">{unit}</span>}
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="h-2 w-full cursor-pointer accent-primary"
      />
      {example && (
        <div className="mt-1">
          <ExampleBadge />
        </div>
      )}
    </label>
  );
}
