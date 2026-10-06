import { describe, expect, it } from "vitest";
import {
  autoPlace,
  checkPlacement,
  findValidCenter,
  getEffectiveFootprint,
  getItemCorners,
  getPolygonBounds,
  getWallSegments,
  isPointInPolygon,
  rectsOverlap,
  snapCenter,
  type PlacementItem,
  type PlacementRoom,
  type RoomPoint,
} from "./geometry";

// A plain 400 x 300 room, and an L-shaped one: 500 x 400 with the
// bottom-right 200 x 150 corner missing.
const rectPolygon: RoomPoint[] = [
  { x: 0, z: 0 },
  { x: 400, z: 0 },
  { x: 400, z: 300 },
  { x: 0, z: 300 },
];
const rectRoom: PlacementRoom = { polygon: rectPolygon, widthCm: 400, depthCm: 300 };

const lPolygon: RoomPoint[] = [
  { x: 0, z: 0 },
  { x: 500, z: 0 },
  { x: 500, z: 250 },
  { x: 300, z: 250 },
  { x: 300, z: 400 },
  { x: 0, z: 400 },
];
const lRoom: PlacementRoom = { polygon: lPolygon, widthCm: 500, depthCm: 400 };

// Builds a placed item from its CENTER (items store their top-left).
function item(
  id: string,
  cx: number,
  cz: number,
  w: number,
  d: number,
  rotationY = 0
): PlacementItem {
  const fp = getEffectiveFootprint(w, d, rotationY);
  return {
    id,
    widthCm: w,
    depthCm: d,
    rotationY,
    position: { x: cx - fp.width / 2, z: cz - fp.depth / 2 },
  };
}

describe("isPointInPolygon", () => {
  it("accepts points inside and rejects points outside a rectangle", () => {
    expect(isPointInPolygon({ x: 200, z: 150 }, rectPolygon)).toBe(true);
    expect(isPointInPolygon({ x: 450, z: 150 }, rectPolygon)).toBe(false);
    expect(isPointInPolygon({ x: 200, z: -10 }, rectPolygon)).toBe(false);
  });

  it("handles the missing corner of an L-shaped (concave) room", () => {
    expect(isPointInPolygon({ x: 100, z: 350 }, lPolygon)).toBe(true); // lower-left arm
    expect(isPointInPolygon({ x: 450, z: 100 }, lPolygon)).toBe(true); // upper-right arm
    expect(isPointInPolygon({ x: 400, z: 350 }, lPolygon)).toBe(false); // the notch
  });
});

describe("isPointInPolygon (U-shaped room)", () => {
  // Two arms joined along the bottom, with a gap between them
  const u: RoomPoint[] = [
    { x: 0, z: 0 },
    { x: 100, z: 0 },
    { x: 100, z: 200 },
    { x: 200, z: 200 },
    { x: 200, z: 0 },
    { x: 300, z: 0 },
    { x: 300, z: 300 },
    { x: 0, z: 300 },
  ];

  it("treats the gap between the arms as outside (a ray from it crosses two walls)", () => {
    expect(isPointInPolygon({ x: 150, z: 100 }, u)).toBe(false);
  });

  it("treats both arms and the base as inside", () => {
    expect(isPointInPolygon({ x: 50, z: 100 }, u)).toBe(true);
    expect(isPointInPolygon({ x: 250, z: 100 }, u)).toBe(true);
    expect(isPointInPolygon({ x: 150, z: 250 }, u)).toBe(true);
  });
});

describe("getEffectiveFootprint", () => {
  it("is the plain size at 0 and 180 degrees", () => {
    expect(getEffectiveFootprint(200, 90, 0)).toEqual({ width: 200, depth: 90 });
    const flipped = getEffectiveFootprint(200, 90, 180);
    expect(flipped.width).toBeCloseTo(200);
    expect(flipped.depth).toBeCloseTo(90);
  });

  it("swaps width and depth at 90 degrees", () => {
    const fp = getEffectiveFootprint(200, 90, 90);
    expect(fp.width).toBeCloseTo(90);
    expect(fp.depth).toBeCloseTo(200);
  });

  it("is the biggest at 45 degrees", () => {
    const fp = getEffectiveFootprint(100, 100, 45);
    expect(fp.width).toBeCloseTo(141.42, 1);
    expect(fp.depth).toBeCloseTo(141.42, 1);
  });
});

describe("getPolygonBounds", () => {
  it("finds the smallest rectangle containing the shape", () => {
    expect(getPolygonBounds(lPolygon)).toEqual({ minX: 0, maxX: 500, minZ: 0, maxZ: 400 });
  });
});

describe("getItemCorners", () => {
  it("returns the four corners of an unrotated item", () => {
    const corners = getItemCorners(100, 100, 40, 20, 0);
    expect(corners).toEqual([
      { x: 80, z: 90 },
      { x: 120, z: 90 },
      { x: 120, z: 110 },
      { x: 80, z: 110 },
    ]);
  });

  it("turns clockwise on screen (like CSS rotate) when rotated 90 degrees", () => {
    // The item's top-left corner (-w/2, -d/2) swings to the top-right
    const [first] = getItemCorners(0, 0, 40, 20, 90);
    expect(first.x).toBeCloseTo(10);
    expect(first.z).toBeCloseTo(-20);
  });
});

describe("rectsOverlap", () => {
  const a = getItemCorners(100, 100, 100, 100, 0);

  it("detects overlapping rectangles", () => {
    expect(rectsOverlap(a, getItemCorners(150, 100, 100, 100, 0))).toBe(true);
  });

  it("allows rectangles that sit flush against each other", () => {
    expect(rectsOverlap(a, getItemCorners(200, 100, 100, 100, 0))).toBe(false);
  });

  it("allows rectangles that are apart", () => {
    expect(rectsOverlap(a, getItemCorners(400, 400, 50, 50, 0))).toBe(false);
  });

  it("uses the real tilted shape, not the bounding box", () => {
    // A 45-degree square's bounding box reaches the neighbour, but its
    // actual corner does not.
    const diamond = getItemCorners(0, 0, 100, 100, 45); // reaches ~70.7
    const near = getItemCorners(100, 100, 60, 60, 0); // spans 70..130
    expect(rectsOverlap(diamond, near)).toBe(false);
    const closer = getItemCorners(90, 0, 60, 60, 0); // spans x 60..120
    expect(rectsOverlap(diamond, closer)).toBe(true);
  });
});

describe("checkPlacement", () => {
  it("accepts an item in free space", () => {
    expect(
      checkPlacement({ center: { x: 200, z: 150 }, widthCm: 100, depthCm: 50, rotationY: 0, others: [], room: rectRoom })
    ).toEqual({ ok: true });
  });

  it("allows an item flush against a wall", () => {
    expect(
      checkPlacement({ center: { x: 50, z: 25 }, widthCm: 100, depthCm: 50, rotationY: 0, others: [], room: rectRoom }).ok
    ).toBe(true);
  });

  it("rejects an item sticking out of the room", () => {
    const result = checkPlacement({ center: { x: 20, z: 150 }, widthCm: 100, depthCm: 50, rotationY: 0, others: [], room: rectRoom });
    expect(result).toEqual({ ok: false, reason: "outside" });
  });

  it("rejects an item in the notch of an L-shaped room", () => {
    const result = checkPlacement({ center: { x: 400, z: 330 }, widthCm: 60, depthCm: 60, rotationY: 0, others: [], room: lRoom });
    expect(result).toMatchObject({ ok: false, reason: "outside" });
  });

  it("rejects overlap and says what it hit", () => {
    const result = checkPlacement({
      center: { x: 220, z: 150 },
      widthCm: 100,
      depthCm: 100,
      rotationY: 0,
      others: [item("sofa", 200, 150, 100, 100)],
      room: rectRoom,
    });
    expect(result).toEqual({ ok: false, reason: "overlap", blockedBy: "sofa" });
  });

  it("takes rotation into account", () => {
    // 200 x 40 bar: fits lengthwise in a 300cm-deep room only when turned
    const bar = { widthCm: 380, depthCm: 40, others: [], room: rectRoom, center: { x: 200, z: 150 } };
    expect(checkPlacement({ ...bar, rotationY: 0 }).ok).toBe(true);
    expect(checkPlacement({ ...bar, rotationY: 90 }).ok).toBe(false);
  });
});

describe("findValidCenter", () => {
  it("uses the dropped spot when it is free", () => {
    const result = findValidCenter({ desired: { x: 200, z: 150 }, widthCm: 100, depthCm: 100, rotationY: 0, others: [], room: rectRoom });
    expect(result).toEqual({ ok: true, center: { x: 200, z: 150 } });
  });

  it("nudges a blocked drop to the nearest free spot", () => {
    const others = [item("table", 200, 150, 100, 100)];
    const result = findValidCenter({ desired: { x: 235, z: 150 }, widthCm: 100, depthCm: 100, rotationY: 0, others, room: rectRoom });
    expect(result.ok).toBe(true);
    if (result.ok) {
      // It moved away from the table, and the result is valid
      expect(result.center.x).toBeGreaterThanOrEqual(300 - 0.5);
      expect(
        checkPlacement({ center: result.center, widthCm: 100, depthCm: 100, rotationY: 0, others, room: rectRoom }).ok
      ).toBe(true);
    }
  });

  it("clamps a drop that is past the wall back into the room", () => {
    const result = findValidCenter({ desired: { x: -50, z: 150 }, widthCm: 100, depthCm: 100, rotationY: 0, others: [], room: rectRoom });
    expect(result).toEqual({ ok: true, center: { x: 50, z: 150 } });
  });

  it("refuses when the room is too full to fit it nearby", () => {
    // A wall-to-wall row of items leaves no gap
    const others = [item("a", 50, 150, 100, 300), item("b", 150, 150, 100, 300), item("c", 250, 150, 100, 300), item("d", 350, 150, 100, 300)];
    const result = findValidCenter({ desired: { x: 200, z: 150 }, widthCm: 100, depthCm: 100, rotationY: 0, others, room: rectRoom });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("overlap");
  });
});

describe("snapCenter", () => {
  const base = { widthCm: 200, depthCm: 90, rotationY: 0, others: [] as PlacementItem[], room: rectRoom };

  it("snaps an item's edges to nearby walls", () => {
    const snapped = snapCenter({ ...base, center: { x: 103, z: 47 } });
    expect(snapped.center).toEqual({ x: 100, z: 45 });
    expect(snapped.guideX).toBe(0);
    expect(snapped.guideZ).toBe(0);
  });

  it("leaves an item alone when nothing is close", () => {
    const snapped = snapCenter({ ...base, center: { x: 200, z: 150 } });
    expect(snapped.center).toEqual({ x: 200, z: 150 });
    expect(snapped.guideX).toBeNull();
    expect(snapped.guideZ).toBeNull();
  });

  it("lines up with another item's edge", () => {
    // Other item's right edge is at x = 250; ours has its left edge at ~247
    const others = [item("other", 200, 200, 100, 50)];
    const snapped = snapCenter({ ...base, others, center: { x: 347, z: 150 } });
    expect(snapped.center.x).toBe(350);
    expect(snapped.guideX).toBe(250);
  });
});

describe("autoPlace", () => {
  const items = [
    { key: "sofa", widthCm: 200, depthCm: 90 },
    { key: "desk", widthCm: 120, depthCm: 60 },
    { key: "shelf", widthCm: 80, depthCm: 35 },
    { key: "chair", widthCm: 50, depthCm: 50 },
  ];

  it("places every item that fits, inside the room, with no overlaps", () => {
    const centers = autoPlace({ items, room: lRoom });
    expect(centers.size).toBe(items.length);

    const placed = items.map((i) => {
      const c = centers.get(i.key)!;
      return item(i.key, c.x, c.z, i.widthCm, i.depthCm);
    });
    for (const p of placed) {
      const c = { x: p.position.x + p.widthCm / 2, z: p.position.z + p.depthCm / 2 };
      const result = checkPlacement({
        center: c,
        widthCm: p.widthCm,
        depthCm: p.depthCm,
        rotationY: 0,
        others: placed.filter((o) => o.id !== p.id),
        room: lRoom,
      });
      expect(result, p.id).toEqual({ ok: true });
    }
  });

  it("leaves out items that cannot fit", () => {
    const centers = autoPlace({ items: [{ key: "huge", widthCm: 900, depthCm: 900 }], room: rectRoom });
    expect(centers.has("huge")).toBe(false);
  });
});

describe("getWallSegments", () => {
  const centroid = (pts: RoomPoint[]) => ({
    x: pts.reduce((s, p) => s + p.x, 0) / pts.length,
    z: pts.reduce((s, p) => s + p.z, 0) / pts.length,
  });

  it("builds one wall per edge", () => {
    expect(getWallSegments(rectPolygon, 10)).toHaveLength(4);
    expect(getWallSegments(lPolygon, 10)).toHaveLength(6);
    expect(getWallSegments(rectPolygon.slice(0, 2), 10)).toEqual([]);
  });

  it("points each wall's outward direction away from the room, whichever way the outline winds", () => {
    const reversed = [...rectPolygon].reverse();
    for (const poly of [rectPolygon, reversed]) {
      const c = centroid(poly);
      for (const w of getWallSegments(poly, 10)) {
        const toWall = { x: w.edgeMidX - c.x, z: w.edgeMidZ - c.z };
        expect(toWall.x * w.outwardX + toWall.z * w.outwardZ).toBeGreaterThan(0);
        expect(Math.hypot(w.outwardX, w.outwardZ)).toBeCloseTo(1);
      }
    }
  });

  it("puts each wall slab just outside its edge so the floor area is unchanged", () => {
    for (const w of getWallSegments(rectPolygon, 10)) {
      const dist = (w.centerX - w.edgeMidX) * w.outwardX + (w.centerZ - w.edgeMidZ) * w.outwardZ;
      expect(dist).toBeCloseTo(5); // half the 10cm thickness
    }
  });

  it("extends walls at outer corners so they meet without gaps, but not at inner corners", () => {
    const walls = getWallSegments(rectPolygon, 10);
    // Each wall of a rectangle is stretched by a full thickness (5 + 5)
    for (const w of walls) expect(w.length).toBeCloseTo(w.edgeLength + 10);

    // The L-shape's inner (reflex) corner: the two walls that meet there
    // are NOT stretched on that end, so they are shorter than a plain
    // rectangle's would be.
    const lWalls = getWallSegments(lPolygon, 10);
    const stretched = lWalls.reduce((sum, w) => sum + (w.length - w.edgeLength), 0);
    // 5 outer corners stretch both neighbours by 5 each, 1 inner corner by 0
    expect(stretched).toBeCloseTo(5 * 10);
  });

  it("reports which edge each wall belongs to", () => {
    const walls = getWallSegments(lPolygon, 10);
    expect(walls.map((w) => w.edgeIndex)).toEqual([0, 1, 2, 3, 4, 5]);
  });
});

describe("findValidCenter search limit", () => {
  it("does not search beyond its maximum distance", () => {
    const others = [item("table", 200, 150, 100, 100)];
    // The nearest free spot is 85cm away - past the default 80cm limit...
    const near = findValidCenter({ desired: { x: 215, z: 150 }, widthCm: 100, depthCm: 100, rotationY: 0, others, room: rectRoom });
    expect(near.ok).toBe(false);
    // ...but found when the limit is raised
    const far = findValidCenter({ desired: { x: 215, z: 150 }, widthCm: 100, depthCm: 100, rotationY: 0, others, room: rectRoom, maxSearchCm: 100 });
    expect(far.ok).toBe(true);
  });
});
