// Safety envelope check. The limits come from the therapist (here: sliders on /screen).
// The app does not decide what is safe; it only reports "over the limit you were given".
export interface SafetyEnvelope {
  maxAngleDeg: number;
  maxVelDegPerS: number;
  debounceMs: number; // breach must last this long before it counts (filters spikes)
}

export type BreachKind = "angle" | "velocity";

/** Set by the therapist per exercise. The app never chooses this itself. */
export type BreachAction = "CUE_ONLY" | "CUE_AND_PAUSE";

/** Phone-only default: cue only. A therapist's value arrives from the bundle. */
export function breachActionOf(config: {
  onBreach?: BreachAction;
}): BreachAction {
  return config.onBreach ?? "CUE_ONLY";
}

export function shouldPauseOnBreach(config: {
  onBreach?: BreachAction;
}): boolean {
  return breachActionOf(config) === "CUE_AND_PAUSE";
}

export interface BreachEvent {
  kind: BreachKind;
  value: number;
  limit: number;
  heldMs: number;
  t: number;
}

export class EnvelopeChecker {
  private since: Record<BreachKind, number | null> = {
    angle: null,
    velocity: null,
  };
  private fired: Record<BreachKind, boolean> = {
    angle: false,
    velocity: false,
  };

  env: SafetyEnvelope;

  constructor(env: SafetyEnvelope) {
    this.env = env;
  }

  /** Returns at most one event per breach episode; re-arms when the value is back inside. */
  update(t: number, angleDeg: number, velDegS: number): BreachEvent | null {
    return (
      this.check("angle", t, angleDeg, this.env.maxAngleDeg) ??
      this.check("velocity", t, velDegS, this.env.maxVelDegPerS)
    );
  }

  private check(
    kind: BreachKind,
    t: number,
    value: number,
    limit: number,
  ): BreachEvent | null {
    if (value <= limit) {
      this.since[kind] = null;
      this.fired[kind] = false;
      return null;
    }
    this.since[kind] ??= t;
    const heldMs = t - (this.since[kind] as number);
    if (this.fired[kind] || heldMs < this.env.debounceMs) return null;
    this.fired[kind] = true;
    return { kind, value, limit, heldMs, t };
  }
}
