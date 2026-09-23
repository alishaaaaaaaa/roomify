// A Zustand "store" is a small container for state that any component in
// the app can read from or update, without passing props down through
// every layer manually. This one holds everything about the room the
// user is currently designing: its shape, colors, and which pieces of
// furniture have been placed where.
//
// Note: this state lives only in memory (the browser tab). Refreshing
// the page resets it. That's fine for now - persistence (saving a
// layout so it survives a refresh, or so it can be shared) is a later
// feature, not something the setup screen needs to solve.

import { create } from "zustand";
import type { RoomPoint } from "~/lib/geometry";

export type RoomShape = {
  // Corners of the room's floor, in centimeters, listed in order around
  // the perimeter (point 0 connects to point 1, point 1 to point 2, and
  // the last point connects back to point 0). A plain rectangle is just
  // 4 points - this is what lets a room be ANY shape (an L-shape, a
  // bumped-out alcove, angled walls), not only a rectangle.
  points: RoomPoint[];
  heightCm: number; // ceiling height, the same all the way around
};

export type PlacedItem = {
  id: string; // a unique id for this *placed instance* - not the product id,
  // since the same product could be placed in the room more than once
  productId: string;
  // needed to actually add this item to a real Shopify cart later -
  // see the note on ShopifyProduct.variantId in shopify.server.ts
  variantId: string;
  title: string;
  price: string;
  currencyCode: string;
  imageUrl: string | null;
  // The actual product's 3D model (a .glb URL from Shopify's AR media),
  // if one has been uploaded for it - see modelUrl on ShopifyProduct in
  // shopify.server.ts. null means the 3D walkthrough falls back to a
  // plain placeholder box for this item.
  modelUrl: string | null;
  widthCm: number;
  heightCm: number;
  depthCm: number;
  position: { x: number; y: number; z: number };
  rotationY: number; // rotation around the vertical axis, in degrees
};

type RoomState = {
  shape: RoomShape;
  wallColor: string;
  floorColor: string;
  placedItems: PlacedItem[];
  setShape: (shape: RoomShape) => void;
  setWallColor: (color: string) => void;
  setFloorColor: (color: string) => void;
  addItem: (item: PlacedItem) => void;
  updateItemPosition: (id: string, position: PlacedItem["position"]) => void;
  updateItemPlacement: (
    id: string,
    position: PlacedItem["position"],
    rotationY: number
  ) => void;
  removeItem: (id: string) => void;
};

// A default simple rectangle (400cm x 400cm) so the app isn't empty
// before the user draws their own shape on the setup screen.
const DEFAULT_SHAPE: RoomShape = {
  points: [
    { x: 0, z: 0 },
    { x: 400, z: 0 },
    { x: 400, z: 400 },
    { x: 0, z: 400 },
  ],
  heightCm: 250,
};

export const useRoomStore = create<RoomState>((set) => ({
  shape: DEFAULT_SHAPE,
  wallColor: "#f5f0e8",
  floorColor: "#c9a876",
  placedItems: [],

  setShape: (shape) => set({ shape }),
  setWallColor: (wallColor) => set({ wallColor }),
  setFloorColor: (floorColor) => set({ floorColor }),

  addItem: (item) =>
    set((state) => ({ placedItems: [...state.placedItems, item] })),

  updateItemPosition: (id, position) =>
    set((state) => ({
      placedItems: state.placedItems.map((item) =>
        item.id === id ? { ...item, position } : item
      ),
    })),

  // Used when rotating an item: position and rotation change together
  // (rotating in place shifts the item's top-left corner even though
  // its center stays put), so they're updated in one go rather than as
  // two separate store writes.
  updateItemPlacement: (id, position, rotationY) =>
    set((state) => ({
      placedItems: state.placedItems.map((item) =>
        item.id === id ? { ...item, position, rotationY } : item
      ),
    })),

  removeItem: (id) =>
    set((state) => ({
      placedItems: state.placedItems.filter((item) => item.id !== id),
    })),
}));
