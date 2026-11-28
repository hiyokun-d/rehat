// Where a phone is strapped. One patient can wear several phones (arm, forearm, leg, head ...),
// and every phone tells the room its placement so screens can group and fuse them.
//
// What one phone measures: the tilt of ONE body segment against gravity, from its calibrated
// start pose (src/lib/rehab/angle.ts). Two phones on neighbouring segments give an estimate of
// the joint between them (fusion.ts). Only the two MVP arm exercises are the team's validated
// path; everything marked `experimental` is shown with that label (AGENTS.md: no claims about
// leg tracking or trunk compensation until the team has measured it).

export type Segment =
  | "upper-arm"
  | "forearm"
  | "hand"
  | "thigh"
  | "shank"
  | "foot"
  | "trunk"
  | "head";

export type Side = "L" | "R" | "C"; // left, right, centre (trunk/head)

export interface Placement {
  segment: Segment;
  side: Side;
}

export const SEGMENTS: Record<
  Segment,
  { label: string; experimental: boolean; axial: boolean }
> = {
  "upper-arm": { label: "Lengan atas", experimental: false, axial: false },
  forearm: { label: "Lengan bawah", experimental: false, axial: false },
  hand: { label: "Tangan", experimental: true, axial: false },
  thigh: { label: "Paha", experimental: true, axial: false },
  shank: { label: "Betis", experimental: true, axial: false },
  foot: { label: "Kaki", experimental: true, axial: false },
  trunk: { label: "Dada / batang tubuh", experimental: true, axial: true },
  head: { label: "Kepala", experimental: true, axial: true },
};

export const SIDE_LABEL: Record<Side, string> = {
  L: "kiri",
  R: "kanan",
  C: "",
};

export function placementLabel(p: Placement): string {
  const seg = SEGMENTS[p.segment];
  return seg.axial ? seg.label : `${seg.label} ${SIDE_LABEL[p.side]}`;
}

/** Axial segments have no side; limbs must have one. Normalises user input. */
export function normalizePlacement(p: Placement): Placement {
  if (SEGMENTS[p.segment].axial) return { segment: p.segment, side: "C" };
  return { segment: p.segment, side: p.side === "C" ? "R" : p.side };
}

export function isPlacement(x: unknown): x is Placement {
  const p = x as Placement;
  return (
    !!p &&
    typeof p.segment === "string" &&
    p.segment in SEGMENTS &&
    (p.side === "L" || p.side === "R" || p.side === "C")
  );
}

/** A joint = proximal segment -> distal segment on the same side. */
export interface JointDef {
  id: string;
  label: string;
  proximal: Segment;
  distal: Segment;
  experimental: boolean;
}

export const JOINTS: JointDef[] = [
  // The MVP elbow exercise rests the upper arm on a table. The second phone on the upper arm
  // then also shows whether the upper arm really stayed still.
  {
    id: "elbow",
    label: "Siku",
    proximal: "upper-arm",
    distal: "forearm",
    experimental: true,
  },
  {
    id: "wrist",
    label: "Pergelangan tangan",
    proximal: "forearm",
    distal: "hand",
    experimental: true,
  },
  {
    id: "knee",
    label: "Lutut",
    proximal: "thigh",
    distal: "shank",
    experimental: true,
  },
  {
    id: "ankle",
    label: "Pergelangan kaki",
    proximal: "shank",
    distal: "foot",
    experimental: true,
  },
];
