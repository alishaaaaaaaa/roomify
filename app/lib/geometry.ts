// Small geometry helpers for working with a room as a POLYGON (a list of
// corner points) instead of a simple rectangle. None of this is
// Shopify-specific - it's plain math, used by the room setup screen,
// the 2D floor plan, and (indirectly) the 3D walkthrough.

export type RoomPoint = { x: number; z: number };

// The "ray casting" algorithm: imagine drawing a horizontal ray from the
// point off to infinity, and counting how many of the polygon's edges
// it crosses. Cross an odd number of times -> you were inside. Cross an
// even number -> you were outside. This works for ANY polygon shape,
// including L-shapes and other non-convex rooms, not just rectangles.
export function isPointInPolygon(point: RoomPoint, polygon: RoomPoint[]): boolean {
  let inside = false;

  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i];
    const b = polygon[j];

    const crossesRay =
      a.z > point.z !== b.z > point.z &&
      point.x < ((b.x - a.x) * (point.z - a.z)) / (b.z - a.z) + a.x;

    if (crossesRay) inside = !inside;
  }

  return inside;
}

// A placed item can now be rotated to ANY angle, not just 90-degree
// steps, so its on-the-ground "footprint" - the smallest axis-aligned
// box that contains it - has to be worked out with real trigonometry
// instead of just swapping width/depth. This is the classic rotated-
// rectangle bounding-box formula: project the rectangle's half-width
// and half-depth onto the room's X and Z axes and add up how far they
// reach. At exactly 0/90/180/270 degrees this reduces to the plain
// (or width/depth-swapped) rectangle, so it's a drop-in replacement for
// the old 90-degree-only version.
export function getEffectiveFootprint(
  widthCm: number,
  depthCm: number,
  rotationY: number
) {
  const radians = (rotationY * Math.PI) / 180;
  const cos = Math.abs(Math.cos(radians));
  const sin = Math.abs(Math.sin(radians));
  return {
    width: widthCm * cos + depthCm * sin,
    depth: widthCm * sin + depthCm * cos,
  };
}

// The smallest rectangle that fully contains the polygon. Used to size
// the 2D canvas and to know how "big" an irregularly-shaped room is
// overall, since we can't just read off a single width/length anymore.
export function getPolygonBounds(polygon: RoomPoint[]) {
  const xs = polygon.map((p) => p.x);
  const zs = polygon.map((p) => p.z);
  return {
    minX: Math.min(...xs),
    maxX: Math.max(...xs),
    minZ: Math.min(...zs),
    maxZ: Math.max(...zs),
  };
}

// --- Furniture placement: staying inside the room, not overlapping ---
//
// All of these work in centimeters, in the room's own coordinates
// (x and z measured from the top-left of the room's bounding box - the
// same frame a placed item's `position` uses).

function clampNumber(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

// The four corners of a piece of furniture, turned by `rotationDeg`
// around its center. The rotation direction matches the CSS rotate()
// used to draw it in the 2D floor plan.
export function getItemCorners(
  centerX: number,
  centerZ: number,
  widthCm: number,
  depthCm: number,
  rotationDeg: number
): RoomPoint[] {
  const radians = (rotationDeg * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  const halfW = widthCm / 2;
  const halfD = depthCm / 2;
  return [
    [-halfW, -halfD],
    [halfW, -halfD],
    [halfW, halfD],
    [-halfW, halfD],
  ].map(([dx, dz]) => ({
    x: centerX + dx * cos - dz * sin,
    z: centerZ + dx * sin + dz * cos,
  }));
}

function projectOnto(points: RoomPoint[], axisX: number, axisZ: number) {
  let min = Infinity;
  let max = -Infinity;
  for (const p of points) {
    const d = p.x * axisX + p.z * axisZ;
    if (d < min) min = d;
    if (d > max) max = d;
  }
  return { min, max };
}

// Do two (possibly tilted) rectangles overlap? This is the "separating
// axis" test: two rectangles do NOT overlap if you can find a line
// (always one of the rectangles' own edge directions) such that, when
// both are squashed flat onto it, they land in separate places. If no
// such line exists, they overlap.
//
// `toleranceCm` lets pieces touch or sit flush without counting as
// overlapping, and absorbs tiny rounding errors.
export function rectsOverlap(a: RoomPoint[], b: RoomPoint[], toleranceCm = 0.5) {
  for (const polygon of [a, b]) {
    for (let i = 0; i < polygon.length; i++) {
      const p1 = polygon[i];
      const p2 = polygon[(i + 1) % polygon.length];
      // A direction at right angles to this edge
      const nx = p2.z - p1.z;
      const nz = p1.x - p2.x;
      const length = Math.hypot(nx, nz) || 1;
      const axisX = nx / length;
      const axisZ = nz / length;

      const projA = projectOnto(a, axisX, axisZ);
      const projB = projectOnto(b, axisX, axisZ);
      const overlap = Math.min(projA.max, projB.max) - Math.max(projA.min, projB.min);
      if (overlap <= toleranceCm) return false; // found a gap
    }
  }
  return true;
}

// Just the fields placement needs - a placed item has these (and more).
export type PlacementItem = {
  id: string;
  widthCm: number;
  depthCm: number;
  rotationY: number;
  position: { x: number; z: number }; // top-left of the rotated bounding box
};

// Where an item's center is, given the top-left of its rotated bounding box.
export function getItemCenter(item: PlacementItem): RoomPoint {
  const footprint = getEffectiveFootprint(item.widthCm, item.depthCm, item.rotationY);
  return {
    x: item.position.x + footprint.width / 2,
    z: item.position.z + footprint.depth / 2,
  };
}

export type PlacementRoom = {
  // The room's outline, in the same room-local coordinates as items
  polygon: RoomPoint[];
  widthCm: number; // bounding box
  depthCm: number;
};

export type PlacementCheck =
  | { ok: true }
  | { ok: false; reason: "outside" | "overlap"; blockedBy?: string };

// Is it OK to put this item here? It must be fully inside the room and
// must not overlap any of the other items.
export function checkPlacement(args: {
  center: RoomPoint;
  widthCm: number;
  depthCm: number;
  rotationY: number;
  others: PlacementItem[];
  room: PlacementRoom;
}): PlacementCheck {
  const { center, widthCm, depthCm, rotationY, others, room } = args;
  const footprint = getEffectiveFootprint(widthCm, depthCm, rotationY);
  const slack = 0.01;

  // 1. Inside the room's bounding box
  if (
    center.x - footprint.width / 2 < -slack ||
    center.z - footprint.depth / 2 < -slack ||
    center.x + footprint.width / 2 > room.widthCm + slack ||
    center.z + footprint.depth / 2 > room.depthCm + slack
  ) {
    return { ok: false, reason: "outside" };
  }

  // 2. Every corner inside the room's real outline. The corners are
  // tested on a rectangle 1cm smaller all round, because a point exactly
  // on a wall can count as either side, and furniture pushed flush
  // against a wall must still be allowed.
  const insetCorners = getItemCorners(
    center.x,
    center.z,
    Math.max(1, widthCm - 2),
    Math.max(1, depthCm - 2),
    rotationY
  );
  if (!insetCorners.every((corner) => isPointInPolygon(corner, room.polygon))) {
    return { ok: false, reason: "outside" };
  }

  // 3. Not overlapping any other item
  const corners = getItemCorners(center.x, center.z, widthCm, depthCm, rotationY);
  for (const other of others) {
    const otherCenter = getItemCenter(other);
    const otherCorners = getItemCorners(
      otherCenter.x,
      otherCenter.z,
      other.widthCm,
      other.depthCm,
      other.rotationY
    );
    if (rectsOverlap(corners, otherCorners)) {
      return { ok: false, reason: "overlap", blockedBy: other.id };
    }
  }

  return { ok: true };
}

export type PlacementResult =
  | { ok: true; center: RoomPoint }
  | { ok: false; reason: "outside" | "overlap"; blockedBy?: string };

// Finds a legal spot for an item as close as possible to where the
// person dropped it. If the dropped spot is fine it's used as-is; if
// it's slightly blocked (say, dropped half on top of a table), the item
// is nudged outward in small steps to the nearest free spot. If nothing
// free is close by, it's refused.
export function findValidCenter(args: {
  desired: RoomPoint;
  widthCm: number;
  depthCm: number;
  rotationY: number;
  others: PlacementItem[];
  room: PlacementRoom;
  maxSearchCm?: number;
  stepCm?: number;
}): PlacementResult {
  const { desired, widthCm, depthCm, rotationY, others, room } = args;
  const maxSearchCm = args.maxSearchCm ?? 80;
  const stepCm = args.stepCm ?? 5;
  const footprint = getEffectiveFootprint(widthCm, depthCm, rotationY);

  // Keeps the center far enough from the room's edges that the item fits
  const clampCenter = (c: RoomPoint): RoomPoint => ({
    x: clampNumber(c.x, footprint.width / 2, room.widthCm - footprint.width / 2),
    z: clampNumber(c.z, footprint.depth / 2, room.depthCm - footprint.depth / 2),
  });
  const check = (c: RoomPoint) =>
    checkPlacement({ center: c, widthCm, depthCm, rotationY, others, room });

  const start = clampCenter(desired);
  const first = check(start);
  if (first.ok) return { ok: true, center: start };

  for (let radius = stepCm; radius <= maxSearchCm; radius += stepCm) {
    let best: RoomPoint | null = null;
    let bestDistance = Infinity;
    for (let dx = -radius; dx <= radius; dx += stepCm) {
      for (let dz = -radius; dz <= radius; dz += stepCm) {
        // Only the outer ring of this square - inner points were
        // already tried at smaller radii.
        if (Math.max(Math.abs(dx), Math.abs(dz)) !== radius) continue;
        const candidate = clampCenter({ x: start.x + dx, z: start.z + dz });
        const distance = Math.hypot(candidate.x - start.x, candidate.z - start.z);
        if (distance >= bestDistance) continue;
        if (check(candidate).ok) {
          best = candidate;
          bestDistance = distance;
        }
      }
    }
    if (best) return { ok: true, center: best };
  }

  return { ok: false, reason: first.reason, blockedBy: first.blockedBy };
}

// --- Walls for the 3D view -------------------------------------------

export type WallSegment = {
  // The wall slab itself: its center, how long it is, and the turn
  // around the vertical axis that lines it up with its edge.
  centerX: number;
  centerZ: number;
  length: number;
  angleY: number;
  // A unit direction pointing away from the inside of the room
  outwardX: number;
  outwardZ: number;
  // The room edge this wall stands on
  edgeMidX: number;
  edgeMidZ: number;
  edgeLength: number;
};

// Builds one wall slab per edge of the room's outline. Each slab sits
// just OUTSIDE its edge (so the floor area stays exactly as drawn), and
// is stretched a little at convex corners so neighbouring slabs meet
// without a gap. Works for any outline - rectangles, L-shapes, angles.
// Points are in meters (or any unit - `thickness` just has to match).
export function getWallSegments(points: RoomPoint[], thickness: number): WallSegment[] {
  const n = points.length;
  if (n < 3) return [];

  // Which way does the outline wind? (Decides which side is "outside".)
  let area2 = 0;
  for (let i = 0; i < n; i++) {
    const a = points[i];
    const b = points[(i + 1) % n];
    area2 += a.x * b.z - b.x * a.z;
  }
  const winding = area2 >= 0 ? 1 : -1;

  const segments: WallSegment[] = [];
  for (let i = 0; i < n; i++) {
    const prev = points[(i - 1 + n) % n];
    const a = points[i];
    const b = points[(i + 1) % n];
    const next = points[(i + 2) % n];

    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const edgeLength = Math.hypot(dx, dz);
    if (edgeLength === 0) continue;
    const ux = dx / edgeLength;
    const uz = dz / edgeLength;
    const outwardX = winding > 0 ? uz : -uz;
    const outwardZ = winding > 0 ? -ux : ux;

    // How far to stretch the slab past a corner: only at convex corners,
    // and by an amount that depends on how sharply the outline turns.
    const extension = (
      from: RoomPoint,
      corner: RoomPoint,
      to: RoomPoint
    ) => {
      const d1x = corner.x - from.x;
      const d1z = corner.z - from.z;
      const d2x = to.x - corner.x;
      const d2z = to.z - corner.z;
      const l1 = Math.hypot(d1x, d1z);
      const l2 = Math.hypot(d2x, d2z);
      if (l1 === 0 || l2 === 0) return 0;
      const cross = d1x * d2z - d1z * d2x;
      if (cross * winding <= 0) return 0; // reflex corner: no stretching
      const cosTurn = clampNumber((d1x * d2x + d1z * d2z) / (l1 * l2), -1, 1);
      const turn = Math.acos(cosTurn);
      return (thickness * Math.min(Math.tan(turn / 2), 3)) / 2;
    };
    const extStart = extension(prev, a, b);
    const extEnd = extension(a, b, next);

    const along = (edgeLength + extEnd - extStart) / 2;
    segments.push({
      centerX: a.x + ux * along + outwardX * (thickness / 2),
      centerZ: a.z + uz * along + outwardZ * (thickness / 2),
      length: edgeLength + extStart + extEnd,
      angleY: Math.atan2(-dz, dx),
      outwardX,
      outwardZ,
      edgeMidX: (a.x + b.x) / 2,
      edgeMidZ: (a.z + b.z) / 2,
      edgeLength,
    });
  }
  return segments;
}