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
