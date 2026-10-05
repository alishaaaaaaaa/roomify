// Doors and windows. Each one sits on one wall (an "edge" of the room's
// outline - edge 0 runs from corner 0 to corner 1, edge 1 from corner 1
// to corner 2, and so on) at a distance along that wall.

import type { RoomPoint } from "~/lib/geometry";

export type OpeningType = "door" | "window";

export type Opening = {
  id: string;
  type: OpeningType;
  edgeIndex: number;
  // Distance from the wall's START corner to the opening's middle, in cm
  centerCm: number;
  widthCm: number;
  heightCm: number;
  // Height of the bottom edge above the floor (0 for doors)
  sillCm: number;
};

export const OPENING_DEFAULTS: Record<
  OpeningType,
  Pick<Opening, "widthCm" | "heightCm" | "sillCm">
> = {
  door: { widthCm: 90, heightCm: 205, sillCm: 0 },
  window: { widthCm: 120, heightCm: 120, sillCm: 90 },
};

const EDGE_MARGIN_CM = 10;

export function edgeLength(points: RoomPoint[], edgeIndex: number) {
  const a = points[edgeIndex];
  const b = points[(edgeIndex + 1) % points.length];
  if (!a || !b) return 0;
  return Math.hypot(b.x - a.x, b.z - a.z);
}

// Makes saved/typed openings safe to draw: drops ones whose wall no
// longer exists, and squeezes the rest to fit within their wall and
// under the ceiling.
export function sanitizeOpenings(
  points: RoomPoint[],
  openings: Opening[],
  ceilingCm: number
): Opening[] {
  const out: Opening[] = [];
  for (const o of openings) {
    if (!Number.isInteger(o.edgeIndex) || o.edgeIndex < 0 || o.edgeIndex >= points.length) continue;
    const len = edgeLength(points, o.edgeIndex);
    const maxWidth = len - EDGE_MARGIN_CM * 2;
    if (maxWidth < 30) continue;
    const widthCm = Math.min(Math.max(o.widthCm, 30), maxWidth);
    const centerCm = Math.min(
      Math.max(o.centerCm, widthCm / 2 + EDGE_MARGIN_CM),
      len - widthCm / 2 - EDGE_MARGIN_CM
    );
    const sillCm = Math.min(Math.max(o.sillCm, 0), Math.max(ceilingCm - 40, 0));
    const heightCm = Math.min(Math.max(o.heightCm, 30), ceilingCm - sillCm - 5);
    if (heightCm < 30) continue;
    out.push({ ...o, widthCm, centerCm, sillCm, heightCm });
  }
  return out;
}

// The two end points of an opening along its wall, in room coordinates (cm)
export function getOpeningLine(points: RoomPoint[], o: Opening) {
  const a = points[o.edgeIndex];
  const b = points[(o.edgeIndex + 1) % points.length];
  const len = Math.hypot(b.x - a.x, b.z - a.z) || 1;
  const ux = (b.x - a.x) / len;
  const uz = (b.z - a.z) / len;
  const s = o.centerCm - o.widthCm / 2;
  const e = o.centerCm + o.widthCm / 2;
  return {
    x1: a.x + ux * s,
    z1: a.z + uz * s,
    x2: a.x + ux * e,
    z2: a.z + uz * e,
  };
}

export const DOOR_COLOR = "#a16207";
export const WINDOW_COLOR = "#38bdf8";

// Given a point (cm) the user is dragging an opening to, finds the wall
// closest to it and where along that wall the point lands. Walls are the
// only places an opening can go, so this always snaps to one.
export function snapToWall(
  points: RoomPoint[],
  point: RoomPoint,
  stepCm = 5
): { edgeIndex: number; centerCm: number } | null {
  let best: { edgeIndex: number; centerCm: number; dist: number } | null = null;
  for (let i = 0; i < points.length; i++) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const len = Math.hypot(dx, dz);
    if (len === 0) continue;
    const t = Math.min(
      Math.max(((point.x - a.x) * dx + (point.z - a.z) * dz) / (len * len), 0),
      1
    );
    const dist = Math.hypot(point.x - (a.x + t * dx), point.z - (a.z + t * dz));
    if (!best || dist < best.dist) {
      best = { edgeIndex: i, centerCm: t * len, dist };
    }
  }
  if (!best) return null;
  return {
    edgeIndex: best.edgeIndex,
    centerCm: Math.round(best.centerCm / stepCm) * stepCm,
  };
}