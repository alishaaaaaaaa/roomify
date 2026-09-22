// A Zustand "store" is a small container for state that any component in
// the app can read from or update, without passing props down through
// every layer manually. This one holds everything about the room the
// user is currently designing: its dimensions, colors, and which pieces
// of furniture have been placed where.
//
// Note: this state lives only in memory (the browser tab). Refreshing
// the page resets it. That's fine for now - persistence (saving a
// layout so it survives a refresh, or so it can be shared) is a later
// feature, not something the setup screen needs to solve.

import { create } from "zustand";

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
  widthCm: number;
  heightCm: number;
  depthCm: number;
  position: { x: number; y: number; z: number };
  rotationY: number; // rotation around the vertical axis, in degrees
};

export type RoomDimensions = {
  widthCm: number;
  lengthCm: number;
  heightCm: number;
};

type RoomState = {
  dimensions: RoomDimensions;
  wallColor: string;
  floorColor: string;
  placedItems: PlacedItem[];
  setDimensions: (dimensions: RoomDimensions) => void;
  setWallColor: (color: string) => void;
  setFloorColor: (color: string) => void;
  addItem: (item: PlacedItem) => void;
  updateItemPosition: (id: string, position: PlacedItem["position"]) => void;
  removeItem: (id: string) => void;
};

export const useRoomStore = create<RoomState>((set) => ({
  // Sensible defaults so the setup screen isn't empty on first load -
  // a medium-sized bedroom, in centimeters.
  dimensions: { widthCm: 400, lengthCm: 400, heightCm: 250 },
  wallColor: "#f5f0e8",
  floorColor: "#c9a876",
  placedItems: [],

  setDimensions: (dimensions) => set({ dimensions }),
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

  removeItem: (id) =>
    set((state) => ({
      placedItems: state.placedItems.filter((item) => item.id !== id),
    })),
}));