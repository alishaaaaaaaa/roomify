// Share links. The whole room is packed into the link itself (after the
// "#"), so there's no database or account: anyone who opens the link
// gets the same room. Furniture is stored compactly - just which
// product, where, and at what angle - and its details (name, price,
// size, 3D model) are looked up from the live store when the link is
// opened, so a shared room always shows current prices.

import type { FloorId } from "~/lib/flooring";
import { isFloorId } from "~/lib/flooring";
import type { Opening } from "~/lib/openings";
import type { PlacedItem, RoomShape } from "~/store/roomStore";

const PRODUCT_PREFIX = "gid://shopify/Product/";

type SharedRoom = {
  v: 1;
  // points as [x, z] pairs, height
  s: { p: Array<[number, number]>; h: number };
  w: string; // wall color
  f: FloorId;
  c: string; // custom floor color
  o: Array<[string, number, number, number, number, number]>; // type, edge, center, width, height, sill
  i: Array<[string, number, number, number]>; // product, x, z, rotation
};

export type DecodedRoom = {
  shape: RoomShape;
  wallColor: string;
  floorType: FloorId;
  floorColor: string;
  openings: Opening[];
  items: Array<{ productId: string; x: number; z: number; rotationY: number }>;
};

function toBase64Url(text: string) {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(encoded: string) {
  const padded = encoded.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(padded + "=".repeat((4 - (padded.length % 4)) % 4));
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

const round = (n: number) => Math.round(n * 10) / 10;

export function encodeRoom(room: {
  shape: RoomShape;
  wallColor: string;
  floorType: FloorId;
  floorColor: string;
  openings: Opening[];
  placedItems: PlacedItem[];
}): string {
  const data: SharedRoom = {
    v: 1,
    s: {
      p: room.shape.points.map((p) => [round(p.x), round(p.z)]),
      h: room.shape.heightCm,
    },
    w: room.wallColor,
    f: room.floorType,
    c: room.floorColor,
    o: room.openings.map((o) => [
      o.type,
      o.edgeIndex,
      round(o.centerCm),
      round(o.widthCm),
      round(o.heightCm),
      round(o.sillCm),
    ]),
    i: room.placedItems.map((item) => [
      item.productId.startsWith(PRODUCT_PREFIX)
        ? item.productId.slice(PRODUCT_PREFIX.length)
        : item.productId,
      round(item.position.x),
      round(item.position.z),
      round(item.rotationY),
    ]),
  };
  return toBase64Url(JSON.stringify(data));
}

const isNum = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n);
const isColor = (c: unknown): c is string =>
  typeof c === "string" && /^#[0-9a-fA-F]{3,8}$/.test(c);

// Returns null if the link's data is damaged or isn't a Roomify room.
export function decodeRoom(encoded: string): DecodedRoom | null {
  try {
    const data = JSON.parse(fromBase64Url(encoded)) as Partial<SharedRoom>;
    if (data.v !== 1 || !data.s || !Array.isArray(data.s.p)) return null;
    if (data.s.p.length < 3 || data.s.p.length > 60) return null;
    const points = data.s.p.map((pt) => {
      if (!Array.isArray(pt) || !isNum(pt[0]) || !isNum(pt[1])) throw new Error("bad point");
      return { x: pt[0], z: pt[1] };
    });
    if (!isNum(data.s.h) || data.s.h < 150 || data.s.h > 600) return null;

    const openings: Opening[] = [];
    for (const o of (Array.isArray(data.o) ? data.o : []).slice(0, 60)) {
      if (
        !Array.isArray(o) ||
        (o[0] !== "door" && o[0] !== "window") ||
        !o.slice(1).every(isNum)
      )
        continue;
      openings.push({
        id: crypto.randomUUID(),
        type: o[0],
        edgeIndex: o[1],
        centerCm: o[2],
        widthCm: o[3],
        heightCm: o[4],
        sillCm: o[5],
      });
    }

    const items: DecodedRoom["items"] = [];
    for (const it of (Array.isArray(data.i) ? data.i : []).slice(0, 200)) {
      if (
        !Array.isArray(it) ||
        typeof it[0] !== "string" ||
        !isNum(it[1]) ||
        !isNum(it[2]) ||
        !isNum(it[3])
      )
        continue;
      items.push({
        productId: /^\d+$/.test(it[0]) ? PRODUCT_PREFIX + it[0] : it[0],
        x: it[1],
        z: it[2],
        rotationY: it[3],
      });
    }

    return {
      shape: { points, heightCm: data.s.h },
      wallColor: isColor(data.w) ? data.w : "#f5f0e8",
      floorType: isFloorId(data.f) ? data.f : "hardwood-light",
      floorColor: isColor(data.c) ? data.c : "#c9a876",
      openings,
      items,
    };
  } catch {
    return null;
  }
}

export const SHARE_HASH_KEY = "room";
