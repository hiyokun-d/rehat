// One numeric input (not 4 boxes): works with paste, autofill and screen readers.
export interface CodeInputProps {
  value: string;
  onChange: (v: string) => void;
  length?: number;
  label: string;
}

export function CodeInput({
  value,
  onChange,
  length = 4,
  label,
}: CodeInputProps) {
  return (
    <label className="block">
      <span className="mb-2 block text-base font-medium">{label}</span>
      <input
        inputMode="numeric"
        autoComplete="one-time-code"
        pattern="[0-9]*"
        maxLength={length}
        value={value}
        onChange={(e) =>
          onChange(e.target.value.replace(/\D/g, "").slice(0, length))
        }
        placeholder={"0".repeat(length)}
        className="h-20 w-full rounded-(--radius-control) border-2 border-border bg-surface text-center text-5xl font-semibold tracking-[0.4em] tabular-nums placeholder:text-border focus:border-primary focus:outline-none"
      />
    </label>
  );
}
