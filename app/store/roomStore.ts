// A Zustand "store" is a small container for state that any component in
// the app can read from or update, without passing props down through
// every layer manually. This one holds everything about the room the
// user is currently designing: its shape, colors, flooring, and which
// pieces of furniture have been placed where.
//
// The room is SAVED in the browser (localStorage), so refreshing the page
// or coming back later picks up where you left off. It's saved per
// browser, not per account - there are no accounts yet, so a layout
// can't follow someone to another device. (That would need a database.)

import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import type { RoomPoint } from "~/lib/geometry";
import { DEFAULT_FLOOR_ID, isFloorId, type FloorId } from "~/lib/flooring";

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

// The parts of a Shopify product that can change after someone has
// already placed it in their room (a new price, a newly uploaded 3D
// model...). See syncWithCatalog below.
export type CatalogProduct = {
  id: string;
  variantId: string;
  title: string;
  price: string;
  currencyCode: string;
  imageUrl: string | null;
  modelUrl: string | null;
};

type RoomState = {
  shape: RoomShape;
  wallColor: string;
  // Which floor was picked (tile, hardwood...). "custom" means a single
  // flat color, which is `floorColor`.
  floorType: FloorId;
  floorColor: string;
  placedItems: PlacedItem[];
  // True once saved data has been loaded from the browser. Not saved.
  hasHydrated: boolean;
  setShape: (shape: RoomShape) => void;
  setWallColor: (color: string) => void;
  setFloorType: (floorType: FloorId) => void;
  setFloorColor: (color: string) => void;
  addItem: (item: PlacedItem) => void;
  updateItemPosition: (id: string, position: PlacedItem["position"]) => void;
  updateItemPlacement: (
    id: string,
    position: PlacedItem["position"],
    rotationY: number
  ) => void;
  removeItem: (id: string) => void;
  clearItems: () => void;
  syncWithCatalog: (catalog: ReadonlyArray<CatalogProduct>) => void;
  setHasHydrated: (value: boolean) => void;
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

export const useRoomStore = create<RoomState>()(
  persist(
    (set) => ({
      shape: DEFAULT_SHAPE,
      wallColor: "#f5f0e8",
      floorType: DEFAULT_FLOOR_ID,
      floorColor: "#c9a876",
      placedItems: [],
      hasHydrated: false,

      setShape: (shape) => set({ shape }),
      setWallColor: (wallColor) => set({ wallColor }),
      setFloorType: (floorType) => set({ floorType }),
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

      clearItems: () => set({ placedItems: [] }),

      // Since the room is saved, an item placed yesterday carries
      // yesterday's copy of its product details. This refreshes each
      // placed item from the live Shopify catalog - most importantly
      // so a 3D model uploaded AFTER the item was placed shows up, and
      // so prices stay current. Items whose product isn't in the list
      // are left alone (the list might just be a partial page).
      syncWithCatalog: (catalog) =>
        set((state) => {
          let changed = false;
          const placedItems = state.placedItems.map((item) => {
            const product = catalog.find((p) => p.id === item.productId);
            if (!product) return item;
            if (
              item.variantId === product.variantId &&
              item.title === product.title &&
              item.price === product.price &&
              item.currencyCode === product.currencyCode &&
              item.imageUrl === product.imageUrl &&
              item.modelUrl === product.modelUrl
            ) {
              return item;
            }
            changed = true;
            return {
              ...item,
              variantId: product.variantId,
              title: product.title,
              price: product.price,
              currencyCode: product.currencyCode,
              imageUrl: product.imageUrl,
              modelUrl: product.modelUrl,
            };
          });
          return changed ? { placedItems } : state;
        }),

      setHasHydrated: (hasHydrated) => set({ hasHydrated }),
    }),
    {
      name: "roomify-room-v1",
      version: 1,
      storage: createJSONStorage(() => localStorage),

      // Loading saved data is deliberately NOT automatic. The server
      // builds each page with the default room (it has no access to
      // this browser's saved data), so if the browser also started from
      // saved data, the two pages would disagree and React would
      // complain. Instead the page loads with the default first, and
      // root.tsx loads the saved room right after - see rehydrate() there.
      skipHydration: true,

      // Only these are saved - not the functions, not hasHydrated.
      partialize: (state) => ({
        shape: state.shape,
        wallColor: state.wallColor,
        floorType: state.floorType,
        floorColor: state.floorColor,
        placedItems: state.placedItems,
      }),

      // How saved data is combined with the defaults when loading.
      // Saved data comes from outside the code (and might be from an
      // older version of the app), so each piece is checked.
      merge: (persisted, current) => {
        const saved = (persisted ?? {}) as Partial<RoomState>;
        const savedPoints = saved.shape?.points;
        return {
          ...current,
          ...saved,
          // A half-drawn room (fewer than 3 corners) isn't worth keeping
          shape:
            saved.shape && savedPoints && savedPoints.length >= 3
              ? saved.shape
              : current.shape,
          floorType: isFloorId(saved.floorType)
            ? saved.floorType
            : current.floorType,
          placedItems: Array.isArray(saved.placedItems)
            ? saved.placedItems
            : current.placedItems,
        };
      },

      onRehydrateStorage: () => (state) => {
        state?.setHasHydrated(true);
      },
    }
  )
);