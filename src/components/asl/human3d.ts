// 3D "dude" avatar built from simple shapes with Three.js (no downloaded model: no asset
// licence, nothing to load but the library). Driven by the tracker each frame:
//  - joints = spheres at landmark positions, bones = cylinders between them (arms, fingers);
//  - head follows the face: position/size from the face outline, roll from the eye line,
//    yaw/nod from the nose vs the eyes (headPose in face.ts); eyes blink, mouth talks;
//  - hoodie strings are spring chains (springChain.ts) so they swing like VTuber physics.
// Everything lives in screen pixels on a flat plane (orthographic camera): the tracker gives
// 2D points, so depth is faked with lighting, not measured.
import type * as THREE_NS from "three";
import { EYES, FACE_OVAL } from "@/lib/asl/faceIndices";
import { headPose } from "@/lib/gesture/face";
import { HAND_BONES } from "@/lib/gesture/handTopology";
import { SpringChain } from "@/lib/tracking/springChain";

type THREE = typeof THREE_NS;
type Pt = { x: number; y: number; z?: number };
type Proj = (p: Pt) => readonly [number, number];

export interface HumanColors {
  skin: string;
  hair: string;
  hoodie: string;
  ink: string;
  string: string;
}

const ARM_BONES: [number, number][] = [
  [11, 13],
  [13, 15],
  [12, 14],
  [14, 16],
];
const STRING = { stiffness: 1.5, drag: 0.15, gravity: 260 }; // hoodie strings, tuned by eye

export class Human3D {
  private T: THREE;
  private renderer: THREE_NS.WebGLRenderer;
  private scene: THREE_NS.Scene;
  private camera: THREE_NS.OrthographicCamera;
  private sphere: THREE_NS.SphereGeometry;
  private cyl: THREE_NS.CylinderGeometry;
  private mats: Record<keyof HumanColors, THREE_NS.MeshStandardMaterial>;
  private pools = new Map<string, THREE_NS.Mesh[]>();
  private used = new Map<string, number>();
  private head: THREE_NS.Group;
  private eyes: THREE_NS.Mesh[];
  private mouth: THREE_NS.Mesh;
  private strings = [
    new SpringChain(4, 1, STRING),
    new SpringChain(4, 1, STRING),
  ];
  private lastT = 0;

  constructor(T: THREE, canvas: HTMLCanvasElement, c: HumanColors) {
    this.T = T;
    this.renderer = new T.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: true,
    });
    this.scene = new T.Scene();
    this.camera = new T.OrthographicCamera(0, 1, 0, -1, -2000, 2000);
    this.scene.add(new T.HemisphereLight(0xffffff, 0x445566, 1.6));
    const key = new T.DirectionalLight(0xffffff, 2.2);
    key.position.set(-300, 400, 900); // light from top-left-front: gives the 3D look
    this.scene.add(key);
    this.sphere = new T.SphereGeometry(1, 24, 16);
    this.cyl = new T.CylinderGeometry(1, 1, 1, 18);
    const mat = (col: string, rough = 0.6) =>
      new T.MeshStandardMaterial({ color: new T.Color(col), roughness: rough });
    this.mats = {
      skin: mat(c.skin, 0.55),
      hair: mat(c.hair, 0.8),
      hoodie: mat(c.hoodie, 0.85),
      ink: mat(c.ink, 0.3),
      string: mat(c.string, 0.5),
    };

    // Head: skull + hair cap + ears + eyes + mouth, as one group we move/rotate.
    this.head = new T.Group();
    const skull = new T.Mesh(this.sphere, this.mats.skin);
    skull.scale.set(0.82, 1, 0.85);
    const hair = new T.Mesh(
      new T.SphereGeometry(1, 24, 16, 0, Math.PI * 2, 0, Math.PI * 0.42),
      this.mats.hair,
    );
    hair.scale.set(0.88, 1.06, 0.9);
    hair.rotation.x = -0.25;
    hair.position.y = 0.04;
    const ears = [-1, 1].map((s) => {
      const e = new T.Mesh(this.sphere, this.mats.skin);
      e.scale.set(0.12, 0.2, 0.1);
      e.position.set(s * 0.82, 0, 0);
      return e;
    });
    this.eyes = [-1, 1].map((s) => {
      const e = new T.Mesh(this.sphere, this.mats.ink);
      e.position.set(s * 0.32, 0.08, 0.78);
      return e;
    });
    this.mouth = new T.Mesh(this.sphere, this.mats.ink);
    this.mouth.position.set(0, -0.45, 0.72);
    const nose = new T.Mesh(this.sphere, this.mats.skin);
    nose.scale.set(0.1, 0.14, 0.12);
    nose.position.set(0, -0.12, 0.86);
    this.head.add(skull, hair, ...ears, ...this.eyes, this.mouth, nose);
    this.scene.add(this.head);
  }

  /** Reusable meshes per kind, so nothing is allocated per frame. */
  private mesh(
    kind: string,
    geo: THREE_NS.BufferGeometry,
    mat: THREE_NS.Material,
  ) {
    const pool = this.pools.get(kind) ?? [];
    this.pools.set(kind, pool);
    const i = this.used.get(kind) ?? 0;
    this.used.set(kind, i + 1);
    if (!pool[i]) {
      pool[i] = new this.T.Mesh(geo, mat);
      this.scene.add(pool[i]);
    }
    pool[i].visible = true;
    return pool[i];
  }

  private joint(
    kind: string,
    x: number,
    y: number,
    r: number,
    mat: THREE_NS.Material,
    z = 0,
  ) {
    const m = this.mesh(kind, this.sphere, mat);
    m.position.set(x, -y, z);
    m.scale.setScalar(r);
  }

  private bone(
    kind: string,
    a: readonly [number, number],
    b: readonly [number, number],
    r: number,
    mat: THREE_NS.Material,
    z = 0,
  ) {
    const T = this.T;
    const m = this.mesh(kind, this.cyl, mat);
    const from = new T.Vector3(a[0], -a[1], z);
    const to = new T.Vector3(b[0], -b[1], z);
    const dir = to.clone().sub(from);
    const len = dir.length() || 0.001;
    m.position.copy(from).add(to).multiplyScalar(0.5);
    m.quaternion.setFromUnitVectors(new T.Vector3(0, 1, 0), dir.normalize());
    m.scale.set(r, len, r);
  }

  render(
    w: number,
    h: number,
    dpr: number,
    P: Proj,
    res: { face?: Pt[]; pose?: Pt[]; left?: Pt[]; right?: Pt[] },
  ) {
    const now = performance.now();
    const dt = this.lastT ? (now - this.lastT) / 1000 : 1 / 30;
    this.lastT = now;
    this.renderer.setPixelRatio(dpr);
    this.renderer.setSize(w, h, false);
    Object.assign(this.camera, { left: 0, right: w, top: 0, bottom: -h });
    this.camera.updateProjectionMatrix();
    for (const pool of this.pools.values())
      for (const m of pool) m.visible = false;
    this.used.clear();

    const { face, pose, left, right } = res;
    let shoulder = 80;
    // Body: torso box-ish (two capsules), arms as sleeves, neck.
    if (pose) {
      const L = P(pose[11]);
      const R = P(pose[12]);
      shoulder = Math.hypot(L[0] - R[0], L[1] - R[1]) || shoulder;
      const r = shoulder * 0.16;
      const mid: [number, number] = [(L[0] + R[0]) / 2, (L[1] + R[1]) / 2];
      this.bone(
        "torso",
        [mid[0], mid[1] + shoulder * 0.2],
        [mid[0], mid[1] + shoulder * 2.2],
        shoulder * 0.5,
        this.mats.hoodie,
        -60,
      );
      this.bone("torso", L, R, r * 1.3, this.mats.hoodie, -40);
      for (const [a, b] of ARM_BONES)
        this.bone("arm", P(pose[a]), P(pose[b]), r, this.mats.hoodie);
      for (const i of [11, 12, 13, 14])
        this.joint("elbow", ...P(pose[i]), r, this.mats.hoodie);
      // Hoodie strings: spring chains hanging from the collar.
      this.strings.forEach((ch, k) => {
        const s = k ? 1 : -1;
        const js = ch.step(
          { x: mid[0] + s * shoulder * 0.12, y: mid[1] + shoulder * 0.15 },
          Math.PI / 2,
          dt,
          shoulder * 0.12,
        );
        for (let i = 1; i < js.length; i++)
          this.bone(
            "string",
            [js[i - 1].x, js[i - 1].y],
            [js[i].x, js[i].y],
            shoulder * 0.018,
            this.mats.string,
            60,
          );
        const tip = js[js.length - 1];
        this.joint(
          "stringTip",
          tip.x,
          tip.y,
          shoulder * 0.035,
          this.mats.string,
          60,
        );
      });
    }

    // Head.
    this.head.visible = false;
    if (face?.length) {
      const oval = FACE_OVAL.map((i) => P(face[i])).filter(([x]) =>
        Number.isFinite(x),
      );
      if (oval.length) {
        const cx = oval.reduce((s, p) => s + p[0], 0) / oval.length;
        const cy = oval.reduce((s, p) => s + p[1], 0) / oval.length;
        const [e1, e2] = [P(face[33]), P(face[263])].sort(
          (a, b) => a[0] - b[0],
        );
        const span = Math.hypot(e2[0] - e1[0], e2[1] - e1[1]) || 1;
        const R = span * 1.25;
        this.head.visible = true;
        this.head.position.set(cx, -cy, 40);
        this.head.scale.setScalar(R);
        const [turn, nod] = Number.isFinite(face[1]?.x)
          ? headPose(face as never)
          : [0, 0];
        // Mirrored view: turning right on camera = turning right on screen.
        this.head.rotation.set(
          -nod * 0.8,
          -turn * 1.2,
          -Math.atan2(e2[1] - e1[1], e2[0] - e1[0]),
        );
        // Neck.
        if (pose) {
          const L = P(pose[11]);
          const Rr = P(pose[12]);
          this.bone(
            "neck",
            [cx, cy + R * 0.6],
            [(L[0] + Rr[0]) / 2, (L[1] + Rr[1]) / 2],
            R * 0.35,
            this.mats.skin,
            -20,
          );
        }
        // Eyes blink with the real eyelids; mouth opens with the real lips.
        EYES.forEach(([outer, inner, up, low], k) => {
          const wE =
            Math.hypot(
              P(face[outer])[0] - P(face[inner])[0],
              P(face[outer])[1] - P(face[inner])[1],
            ) || 1;
          const open = Math.min(
            1,
            (Math.hypot(
              P(face[up])[0] - P(face[low])[0],
              P(face[up])[1] - P(face[low])[1],
            ) /
              wE) *
              3.2,
          );
          this.eyes[k].scale.set(0.11, Math.max(0.015, 0.13 * open), 0.06);
        });
        const talk = Math.min(
          1,
          (Math.hypot(
            P(face[13])[0] - P(face[14])[0],
            P(face[13])[1] - P(face[14])[1],
          ) /
            span) *
            2.5,
        );
        this.mouth.scale.set(0.22, Math.max(0.025, 0.2 * talk), 0.08);
      }
    }

    // Hands: knuckle spheres + finger bones (skin), thicker towards the palm.
    for (const hand of [left, right]) {
      if (!hand?.length) continue;
      const pts = hand.map((p) => P(p));
      const size =
        Math.hypot(pts[0][0] - pts[9][0], pts[0][1] - pts[9][1]) || 1;
      for (const [a, b] of HAND_BONES)
        this.bone(
          "finger",
          pts[a],
          pts[b],
          size * (a === 0 ? 0.16 : 0.09),
          this.mats.skin,
          80,
        );
      pts.forEach(([x, y], i) => {
        this.joint(
          "knuckle",
          x,
          y,
          size * (i === 0 ? 0.18 : 0.1),
          this.mats.skin,
          80,
        );
      });
      this.bone("palm", pts[5], pts[17], size * 0.2, this.mats.skin, 75);
      this.bone("palm", pts[0], pts[9], size * 0.3, this.mats.skin, 75);
    }

    this.renderer.render(this.scene, this.camera);
  }

  dispose() {
    this.renderer.dispose();
    this.sphere.dispose();
    this.cyl.dispose();
    for (const m of Object.values(this.mats)) m.dispose();
  }
}
