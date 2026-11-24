// 2D "spring bone" chain for avatar hair/ears: the same update VTuber avatars use (VRM 0.x
// spring bones: stiffness, drag, gravity), integrated with Verlet + a length constraint
// (Jakobsen, "Advanced Character Physics", GDC 2001). Per joint, each frame:
//   inertia = (current - previous) * (1 - drag)          keeps swinging (momentum)
//   stiff   = restDirection * length * stiffness * dt    pulls back to the drawn shape
//   ext     = gravity * dt                               droops
//   next    = current + inertia + stiff + ext
//   next    = parent + unit(next - parent) * length      bones do not stretch
// Units: pixels and seconds. Values are for looks, tuned by eye.

export interface SpringParams {
  stiffness: number; // 0..~4  higher = springs back faster
  drag: number; // 0..1    higher = calmer, less bouncy
  gravity: number; // px/s per frame-step, downwards
}

interface Joint {
  x: number;
  y: number;
  px: number;
  py: number;
}

export class SpringChain {
  joints: Joint[] = [];
  segLen: number;
  p: SpringParams;
  private n: number;

  constructor(n: number, segLen: number, p: SpringParams) {
    this.n = n;
    this.segLen = segLen;
    this.p = p;
  }

  /**
   * root = where the chain is attached (moves with the head); restAngle = direction the chain
   * points when nothing moves (radians, 0 = right, PI/2 = down), already including head tilt.
   */
  step(
    root: { x: number; y: number },
    restAngle: number,
    dtS: number,
    segLen = this.segLen,
  ) {
    this.segLen = segLen;
    const dt = Math.min(0.05, Math.max(0.001, dtS)); // frame drops must not explode the sim
    const rx = Math.cos(restAngle);
    const ry = Math.sin(restAngle);
    if (this.joints.length !== this.n + 1) {
      this.joints = Array.from({ length: this.n + 1 }, (_, i) => {
        const x = root.x + rx * segLen * i;
        const y = root.y + ry * segLen * i;
        return { x, y, px: x, py: y };
      });
    }
    const j0 = this.joints[0];
    j0.px = j0.x;
    j0.py = j0.y;
    j0.x = root.x;
    j0.y = root.y;
    for (let i = 1; i < this.joints.length; i++) {
      const parent = this.joints[i - 1];
      const j = this.joints[i];
      let nx =
        j.x +
        (j.x - j.px) * (1 - this.p.drag) +
        rx * segLen * this.p.stiffness * dt;
      let ny =
        j.y +
        (j.y - j.py) * (1 - this.p.drag) +
        ry * segLen * this.p.stiffness * dt +
        this.p.gravity * dt;
      const dx = nx - parent.x;
      const dy = ny - parent.y;
      const d = Math.hypot(dx, dy) || 1;
      nx = parent.x + (dx / d) * segLen;
      ny = parent.y + (dy / d) * segLen;
      j.px = j.x;
      j.py = j.y;
      j.x = nx;
      j.y = ny;
    }
    return this.joints;
  }
}
