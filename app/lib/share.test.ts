import { describe, expect, it } from "vitest";
import { decodeRoom, encodeRoom } from "./share";
import type { PlacedItem } from "~/store/roomStore";

const room = {
  shape: {
    points: [
      { x: 0, z: 0 },
      { x: 500, z: 0 },
      { x: 500, z: 400 },
      { x: 0, z: 400 },
    ],
    heightCm: 250,
  },
  wallColor: "#f1ece4",
  floorType: "hardwood-dark" as const,
  floorColor: "#c9a876",
  openings: [
    { id: "x", type: "door" as const, edgeIndex: 2, centerCm: 120, widthCm: 90, heightCm: 205, sillCm: 0 },
    { id: "y", type: "window" as const, edgeIndex: 0, centerCm: 250, widthCm: 130, heightCm: 120, sillCm: 90 },
  ],
  placedItems: [
    {
      id: "item-1",
      productId: "gid://shopify/Product/123456",
      variantId: "gid://shopify/ProductVariant/9",
      title: "Linen Sofa",
      price: "150.00",
      currencyCode: "CAD",
      imageUrl: null,
      modelUrl: null,
      widthCm: 200,
      heightCm: 85,
      depthCm: 90,
      position: { x: 60.04, y: 0, z: 40.5 },
      rotationY: 30,
    } satisfies PlacedItem,
  ],
};

describe("share links", () => {
  it("round-trips a room through encode and decode", () => {
    const decoded = decodeRoom(encodeRoom(room));
    expect(decoded).not.toBeNull();
    expect(decoded!.shape).toEqual(room.shape);
    expect(decoded!.wallColor).toBe("#f1ece4");
    expect(decoded!.floorType).toBe("hardwood-dark");
    expect(decoded!.openings.map(({ id: _id, ...rest }) => rest)).toEqual(
      room.openings.map(({ id: _id, ...rest }) => rest)
    );
    expect(decoded!.items).toEqual([
      { productId: "gid://shopify/Product/123456", x: 60, z: 40.5, rotationY: 30 },
    ]);
  });

  it("produces a URL-safe string", () => {
    expect(encodeRoom(room)).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("returns null for damaged or foreign data instead of throwing", () => {
    expect(decodeRoom("garbage")).toBeNull();
    expect(decodeRoom("")).toBeNull();
    expect(decodeRoom(btoa(JSON.stringify({ hello: "world" })))).toBeNull();
  });

  it("rejects rooms with too few corners or a silly ceiling height", () => {
    const tooFew = encodeRoom({ ...room, shape: { ...room.shape, points: room.shape.points.slice(0, 2) } });
    expect(decodeRoom(tooFew)).toBeNull();
    const tooTall = encodeRoom({ ...room, shape: { ...room.shape, heightCm: 9000 } });
    expect(decodeRoom(tooTall)).toBeNull();
  });

  it("falls back to safe defaults for bad colors", () => {
    const encoded = encodeRoom({ ...room, wallColor: "red; background:url(x)" });
    expect(decodeRoom(encoded)!.wallColor).toBe("#f5f0e8");
  });
});
