// A rep = go above `upDeg`, then come back below `downDeg`. Two thresholds (hysteresis)
// so noise around a single line cannot count one movement twice.
export interface RepConfig {
  upDeg: number;
  downDeg: number;
}

export class RepCounter {
  count = 0;
  private up = false;

  cfg: RepConfig;

  constructor(cfg: RepConfig) {
    this.cfg = cfg;
  }

  /** Returns true on the sample that completes a rep. */
  update(angleDeg: number): boolean {
    if (!this.up && angleDeg >= this.cfg.upDeg) this.up = true;
    else if (this.up && angleDeg <= this.cfg.downDeg) {
      this.up = false;
      this.count++;
      return true;
    }
    return false;
  }
}
