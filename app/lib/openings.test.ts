import { describe, expect, it } from "vitest";
import {
  edgeLength,
  getOpeningLine,
  sanitizeOpenings,
  snapToWall,
  type Opening,
} from "./openings";

// 400 x 300 room. Edge 0 = top, 1 = right, 2 = bottom, 3 = left.
const points = [
  { x: 0, z: 0 },
  { x: 400, z: 0 },
  { x: 400, z: 300 },
  { x: 0, z: 300 },
];

const opening = (patch: Partial<Opening> = {}): Opening => ({
  id: "o1",
  type: "window",
  edgeIndex: 0,
  centerCm: 200,
  widthCm: 120,
  heightCm: 120,
  sillCm: 90,
  ...patch,
});

describe("edgeLength", () => {
  it("measures a wall, including the one that closes the outline", () => {
    expect(edgeLength(points, 0)).toBe(400);
    expect(edgeLength(points, 3)).toBe(300);
  });
  it("returns 0 for a wall that does not exist", () => {
    expect(edgeLength(points, 9)).toBe(0);
  });
});

describe("sanitizeOpenings", () => {
  it("leaves a valid opening alone", () => {
    expect(sanitizeOpenings(points, [opening()], 250)).toEqual([opening()]);
  });

  it("drops openings on walls that no longer exist", () => {
    expect(sanitizeOpenings(points, [opening({ edgeIndex: 7 })], 250)).toEqual([]);
    expect(sanitizeOpenings(points, [opening({ edgeIndex: -1 })], 250)).toEqual([]);
  });

  it("keeps an opening clear of the corners", () => {
    const [moved] = sanitizeOpenings(points, [opening({ centerCm: 5 })], 250);
    expect(moved.centerCm).toBe(70); // half the width (60) + 10cm margin
    const [other] = sanitizeOpenings(points, [opening({ centerCm: 999 })], 250);
    expect(other.centerCm).toBe(330);
  });

  it("squeezes an opening that is wider than its wall", () => {
    const [fitted] = sanitizeOpenings(points, [opening({ edgeIndex: 3, widthCm: 500 })], 250);
    expect(fitted.widthCm).toBe(280); // 300 wall - 2 x 10 margin
  });

  it("keeps an opening under the ceiling", () => {
    const [low] = sanitizeOpenings(points, [opening({ sillCm: 200, heightCm: 200 })], 250);
    expect(low.sillCm + low.heightCm).toBeLessThanOrEqual(245);
  });
});

describe("getOpeningLine", () => {
  it("gives the two ends along a wall", () => {
    expect(getOpeningLine(points, opening({ centerCm: 200, widthCm: 100 }))).toEqual({
      x1: 150,
      z1: 0,
      x2: 250,
      z2: 0,
    });
  });

  it("follows the wall's direction (down the right-hand wall)", () => {
    const line = getOpeningLine(points, opening({ edgeIndex: 1, centerCm: 150, widthCm: 100 }));
    expect(line).toEqual({ x1: 400, z1: 100, x2: 400, z2: 200 });
  });
});

describe("snapToWall", () => {
  it("snaps a point to the nearest wall and its position along it", () => {
    expect(snapToWall(points, { x: 123, z: 20 })).toEqual({ edgeIndex: 0, centerCm: 125 });
    expect(snapToWall(points, { x: 380, z: 150 })).toEqual({ edgeIndex: 1, centerCm: 150 });
  });

  it("jumps to another wall when the point is closer to it", () => {
    expect(snapToWall(points, { x: 10, z: 200 })?.edgeIndex).toBe(3);
  });

  it("stays on the wall for points far outside the room", () => {
    const result = snapToWall(points, { x: 900, z: -400 });
    expect(result).not.toBeNull();
    expect(result!.centerCm).toBeGreaterThanOrEqual(0);
  });
});
