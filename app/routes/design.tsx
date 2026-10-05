// The real 2D floor planner. It shows:
//  - a sidebar of real furniture pulled live from Shopify (via the
//    loader below, which runs on the server before the page renders)
//  - a top-down "canvas" scaled to the room's real shape - which can now
//    be ANY polygon (an L-shape, an alcove, angled walls), not just a
//    plain rectangle
//  - drag-and-drop: drag a product from the sidebar and drop it onto
//    the canvas to place it; drag a placed item to reposition it
//
// The scaling idea: we don't draw the room at its real size in pixels.
// Instead we compute a "pixels per cm" scale factor, based on the
// smallest rectangle that fully contains the room's shape, so the room
// always fits nicely on screen no matter how big or small it really is.
//
// Styling note: most of this file uses Tailwind utility classes for
// anything that's the SAME every time (colors, spacing, fonts). A few
// elements still use plain inline `style` - those are values that are
// only known at runtime (a computed pixel position, a user-picked hex
// color, a drag transform), which Tailwind's static classes can't
// express.

import { useEffect, useRef, useState } from "react";
import { Form, Link, redirect } from "react-router";
import {
  DndContext,
  useDraggable,
  useDroppable,
  type DragEndEvent,
  type DragMoveEvent,
} from "@dnd-kit/core";
import {
  createCartCheckoutUrl,
  getProducts,
  type ShopifyProduct,
} from "~/lib/shopify.server";
import { StepNav } from "~/components/StepNav";
import { useRoomStore, type PlacedItem } from "~/store/roomStore";
import {
  checkPlacement,
  autoPlace,
  findValidCenter,
  getEffectiveFootprint,
  getPolygonBounds,
  snapCenter,
} from "~/lib/geometry";
import { FloorPatternDefs, useFloorPaint } from "~/components/FloorPattern";
import type { FloorId } from "~/lib/flooring";
import {
  DOOR_COLOR,
  WINDOW_COLOR,
  getOpeningLine,
  sanitizeOpenings,
  snapToWall,
  type Opening,
} from "~/lib/openings";
import { SHARE_HASH_KEY, decodeRoom, encodeRoom } from "~/lib/share";
import type { Route } from "./+types/design";

const MAX_CANVAS_PX = 640;
const MIN_CANVAS_PX = 240;

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

export async function loader() {
  // If Shopify can't be reached, still show the page with a clear
  // message instead of crashing it.
  try {
    const products = await getProducts();
    return { products, loadError: null as string | null };
  } catch (error) {
    console.error("Could not load products from Shopify:", error);
    return {
      products: [] as ShopifyProduct[],
      loadError:
        "Couldn't load the furniture catalog right now. Check your connection and refresh the page.",
    };
  }
}

// This runs on the SERVER whenever the "Buy this room" form below is
// submitted. The browser sends the placed items (as JSON, in a hidden
// field) to this route as a normal form POST; we parse them back out,
// create a real Shopify cart from them, and redirect the browser
// straight to Shopify's own checkout page for that cart. We never build
// our own checkout UI - Shopify's hosted one handles payment, taxes,
// shipping, all of it.
export async function action({ request }: Route.ActionArgs) {
  const formData = await request.formData();
  const linesJson = formData.get("lines");

  if (typeof linesJson !== "string") {
    throw new Response("Missing cart lines", { status: 400 });
  }

  const lines: Array<{ variantId: string; quantity: number }> =
    JSON.parse(linesJson);

  if (lines.length === 0) {
    throw new Response("Cannot check out an empty room", { status: 400 });
  }

  const checkoutUrl = await createCartCheckoutUrl(lines);

  // redirect() tells the browser to navigate to Shopify's checkout page.
  // Because this came from a real <Form> submission (not a background
  // fetch), the browser genuinely leaves our app and lands on Shopify's
  // hosted, secure checkout - exactly like a real store.
  return redirect(checkoutUrl);
}

export default function Design({ loaderData }: Route.ComponentProps) {
  const { products, loadError } = loaderData;

  const shape = useRoomStore((state) => state.shape);
  const wallColor = useRoomStore((state) => state.wallColor);
  const floorColor = useRoomStore((state) => state.floorColor);
  const floorType = useRoomStore((state) => state.floorType);
  const hasHydrated = useRoomStore((state) => state.hasHydrated);
  const syncWithCatalog = useRoomStore((state) => state.syncWithCatalog);
  const clearItems = useRoomStore((state) => state.clearItems);
  const setItems = useRoomStore((state) => state.setItems);
  const undo = useRoomStore((state) => state.undo);
  const redo = useRoomStore((state) => state.redo);
  const canUndo = useRoomStore((state) => state.past.length > 0);
  const canRedo = useRoomStore((state) => state.future.length > 0);
  const placedItems = useRoomStore((state) => state.placedItems);
  const openings = useRoomStore((state) => state.openings);
  const loadRoom = useRoomStore((state) => state.loadRoom);
  const updateOpening = useRoomStore((state) => state.updateOpening);
  const addItem = useRoomStore((state) => state.addItem);
  const updateItemPosition = useRoomStore((state) => state.updateItemPosition);
  const updateItemPlacement = useRoomStore((state) => state.updateItemPlacement);

  const canvasRef = useRef<HTMLDivElement | null>(null);

  // How wide the drawing can be: the space the middle column has, up to
  // 640px. Measured in the browser (the server just assumes the max).
  const columnRef = useRef<HTMLDivElement | null>(null);
  const [canvasMaxPx, setCanvasMaxPx] = useState(MAX_CANVAS_PX);
  useEffect(() => {
    const el = columnRef.current;
    if (!el) return;
    const update = () =>
      setCanvasMaxPx(
        Math.min(MAX_CANVAS_PX, Math.max(MIN_CANVAS_PX, Math.floor(el.clientWidth)))
      );
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Because the room is saved in the browser, items placed in an earlier
  // visit carry old product details. Once the saved room has loaded,
  // refresh them from the live Shopify list (new prices, newly uploaded
  // 3D models...).
  useEffect(() => {
    if (hasHydrated) syncWithCatalog(products);
  }, [hasHydrated, products, syncWithCatalog]);

  // A short message ("Can't place that there") that fades after a moment.
  const [notice, setNotice] = useState<string | null>(null);
  const noticeTimer = useRef<number | undefined>(undefined);
  function showNotice(message: string) {
    setNotice(message);
    window.clearTimeout(noticeTimer.current);
    noticeTimer.current = window.setTimeout(() => setNotice(null), 2500);
  }
  useEffect(() => () => window.clearTimeout(noticeTimer.current), []);

  // Opening a share link (…/design#room=…) loads that room. Runs once
  // the visitor's own saved room has loaded, so it replaces it cleanly -
  // asking first if they'd be losing furniture they placed.
  useEffect(() => {
    if (!hasHydrated) return;
    const hash = window.location.hash.replace(/^#/, "");
    const params = new URLSearchParams(hash);
    const encoded = params.get(SHARE_HASH_KEY);
    if (!encoded) return;

    // Clear the link first so a refresh doesn't ask again
    history.replaceState(null, "", window.location.pathname + window.location.search);

    const decoded = decodeRoom(encoded);
    if (!decoded) {
      showNotice("That share link looks damaged, so it couldn't be opened.");
      return;
    }
    const current = useRoomStore.getState().placedItems;
    if (
      current.length > 0 &&
      !window.confirm(
        "Open the shared room? It will replace the room you're working on."
      )
    ) {
      return;
    }

    const items: PlacedItem[] = [];
    let missing = 0;
    for (const it of decoded.items) {
      const product = products.find((p) => p.id === it.productId);
      if (!product) {
        missing++;
        continue;
      }
      items.push({
        id: crypto.randomUUID(),
        productId: product.id,
        variantId: product.variantId,
        title: product.title,
        price: product.price,
        currencyCode: product.currencyCode,
        imageUrl: product.imageUrl,
        modelUrl: product.modelUrl,
        widthCm: product.widthCm ?? 60,
        heightCm: product.heightCm ?? 80,
        depthCm: product.depthCm ?? 60,
        position: { x: it.x, y: 0, z: it.z },
        rotationY: it.rotationY,
      });
    }
    loadRoom({
      shape: decoded.shape,
      wallColor: decoded.wallColor,
      floorType: decoded.floorType,
      floorColor: decoded.floorColor,
      openings: decoded.openings,
      placedItems: items,
    });
    showNotice(
      missing > 0
        ? `Shared room opened (${missing} item(s) are no longer in the store).`
        : "Shared room opened."
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasHydrated]);

  async function handleShare() {
    const encoded = encodeRoom({
      shape,
      wallColor,
      floorType,
      floorColor,
      openings,
      placedItems,
    });
    const url = `${window.location.origin}/design#${SHARE_HASH_KEY}=${encoded}`;
    try {
      await navigator.clipboard.writeText(url);
      showNotice("Share link copied!");
    } catch {
      // Clipboard can be blocked (e.g. on plain http) - let them copy it
      window.prompt("Copy this link to share your room:", url);
    }
  }

  // Ctrl/Cmd+Z = undo, Ctrl/Cmd+Shift+Z or Ctrl+Y = redo. Ignored while
  // typing in a text field.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null;
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;
      const mod = e.ctrlKey || e.metaKey;
      if (!mod) return;
      const key = e.key.toLowerCase();
      if (key === "z" && !e.shiftKey) {
        e.preventDefault();
        undo();
      } else if ((key === "z" && e.shiftKey) || key === "y") {
        e.preventDefault();
        redo();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [undo, redo]);

  // Alignment guide lines shown while dragging (cm from the canvas corner)
  const [guides, setGuides] = useState<{ x: number | null; z: number | null }>({
    x: null,
    z: null,
  });

  // The room can be any shape, so there's no single "width" and "length" -
  // we find the smallest rectangle containing the shape, and scale/position
  // everything relative to THAT rectangle's top-left corner.
  const bounds = getPolygonBounds(shape.points);
  const roomWidthCm = bounds.maxX - bounds.minX;
  const roomDepthCm = bounds.maxZ - bounds.minZ;

  // On narrow screens the drawing shrinks to fit the width available
  const scale = canvasMaxPx / Math.max(roomWidthCm, roomDepthCm);
  const canvasWidthPx = roomWidthCm * scale;
  const canvasHeightPx = roomDepthCm * scale;

  // The overlap/boundary checks work in "canvas" coordinates (0,0 = top-left
  // of the bounding box), same as item positions.
  const room = {
    polygon: shape.points.map((p) => ({
      x: p.x - bounds.minX,
      z: p.z - bounds.minZ,
    })),
    widthCm: roomWidthCm,
    depthCm: roomDepthCm,
  };

  const cartTotal = placedItems.reduce(
    (sum, item) => sum + Number(item.price),
    0
  );
  const currencyCode = placedItems[0]?.currencyCode ?? "USD";

  function explainFailure(
    result: { reason: "outside" | "overlap"; blockedBy?: string },
    others: PlacedItem[]
  ) {
    if (result.reason === "outside") {
      showNotice("That would be outside the room.");
      return;
    }
    const blocker = others.find((o) => o.id === result.blockedBy);
    showNotice(
      blocker
        ? `No free space there - it would overlap ${blocker.title}.`
        : "No free space there."
    );
  }

  // What's being dragged: its size, angle and the other items it must
  // avoid. (A new item from the sidebar starts unrotated.)
  function getSubject(activeId: string) {
    if (activeId.startsWith("sidebar-")) {
      const product = products.find((p) => p.id === activeId.replace("sidebar-", ""));
      if (!product) return null;
      return {
        kind: "new" as const,
        product,
        widthCm: product.widthCm ?? 60,
        depthCm: product.depthCm ?? 60,
        rotationY: 0,
        others: placedItems,
      };
    }
    if (activeId.startsWith("placed-")) {
      const item = placedItems.find((i) => i.id === activeId.replace("placed-", ""));
      if (!item) return null;
      return {
        kind: "move" as const,
        item,
        widthCm: item.widthCm,
        depthCm: item.depthCm,
        rotationY: item.rotationY,
        others: placedItems.filter((i) => i.id !== item.id),
      };
    }
    return null;
  }

  // Where the pointer currently is, in cm from the canvas's top-left.
  function pointerToCm(event: DragMoveEvent | DragEndEvent) {
    const canvasEl = canvasRef.current;
    if (!canvasEl) return null;
    const rect = canvasEl.getBoundingClientRect();
    // activatorEvent = where the drag began; delta = how far it moved.
    const start = event.activatorEvent as PointerEvent;
    return {
      x: (start.clientX + event.delta.x - rect.left) / scale,
      z: (start.clientY + event.delta.y - rect.top) / scale,
    };
  }

  // Dragging a door/window on the plan: stays on the walls, jumping to
  // the nearest one and sliding along it.
  function handleMoveOpening(id: string, clientX: number, clientY: number) {
    const canvasEl = canvasRef.current;
    if (!canvasEl) return;
    const rect = canvasEl.getBoundingClientRect();
    const snapped = snapToWall(shape.points, {
      x: (clientX - rect.left) / scale + bounds.minX,
      z: (clientY - rect.top) / scale + bounds.minZ,
    });
    if (snapped) updateOpening(id, snapped);
  }

  function handleDragMove(event: DragMoveEvent) {
    const subject = getSubject(String(event.active.id));
    const desired = pointerToCm(event);
    if (!subject || !desired || !event.over || event.over.id !== "room-canvas") {
      setGuides((g) => (g.x === null && g.z === null ? g : { x: null, z: null }));
      return;
    }
    const snapped = snapCenter({ center: desired, ...subject, room });
    setGuides((g) =>
      g.x === snapped.guideX && g.z === snapped.guideZ
        ? g
        : { x: snapped.guideX, z: snapped.guideZ }
    );
  }

  function handleDragEnd(event: DragEndEvent) {
    setGuides({ x: null, z: null });

    // Only act if the item was actually dropped over the canvas
    if (!event.over || event.over.id !== "room-canvas") return;

    const subject = getSubject(String(event.active.id));
    const pointer = pointerToCm(event);
    if (!subject || !pointer) return;

    // Line it up with nearby walls/items first, then make sure the spot
    // is valid (sliding to the nearest free spot if it's taken).
    const desired = snapCenter({ center: pointer, ...subject, room }).center;
    const result = findValidCenter({
      desired,
      widthCm: subject.widthCm,
      depthCm: subject.depthCm,
      rotationY: subject.rotationY,
      others: subject.others,
      room,
    });
    if (!result.ok) {
      explainFailure(result, subject.others);
      return;
    }

    const footprint = getEffectiveFootprint(
      subject.widthCm,
      subject.depthCm,
      subject.rotationY
    );
    const position = {
      x: result.center.x - footprint.width / 2,
      y: 0,
      z: result.center.z - footprint.depth / 2,
    };

    if (subject.kind === "new") {
      const product = subject.product;
      addItem({
        id: crypto.randomUUID(),
        productId: product.id,
        variantId: product.variantId,
        title: product.title,
        price: product.price,
        currencyCode: product.currencyCode,
        imageUrl: product.imageUrl,
        modelUrl: product.modelUrl,
        widthCm: subject.widthCm,
        heightCm: product.heightCm ?? 80,
        depthCm: subject.depthCm,
        position,
        rotationY: 0,
      });
    } else {
      updateItemPosition(subject.item.id, position);
    }
  }

  // Fills the room with one of each product (as many as fit), against
  // the walls with gaps between. Undo brings the old layout back.
  function handleAutoFurnish() {
    if (products.length === 0) return;
    const centers = autoPlace({
      items: products.map((p) => ({
        key: p.id,
        widthCm: p.widthCm ?? 60,
        depthCm: p.depthCm ?? 60,
      })),
      room,
    });
    const items: PlacedItem[] = [];
    for (const product of products) {
      const c = centers.get(product.id);
      if (!c) continue;
      const w = product.widthCm ?? 60;
      const d = product.depthCm ?? 60;
      items.push({
        id: crypto.randomUUID(),
        productId: product.id,
        variantId: product.variantId,
        title: product.title,
        price: product.price,
        currencyCode: product.currencyCode,
        imageUrl: product.imageUrl,
        modelUrl: product.modelUrl,
        widthCm: w,
        heightCm: product.heightCm ?? 80,
        depthCm: d,
        position: { x: c.x - w / 2, y: 0, z: c.z - d / 2 },
        rotationY: 0,
      });
    }
    setItems(items);
    if (items.length < products.length) {
      showNotice(
        `Placed ${items.length} of ${products.length} - the rest didn't fit.`
      );
    }
  }

  // Rotates an item to any angle (called continuously while the rotate
  // handle is dragged). The CENTER stays fixed so the item turns in place.
  // A turn that would swing it into a wall or another item is simply not
  // applied, so it stops at the obstacle - unless it was already in an
  // invalid spot, in which case it's allowed to turn (so it can't get stuck).
  function handleRotate(item: PlacedItem, nextRotationY: number) {
    // Always read the freshest copy: this runs on many pointer events
    // in a row, and `item` may be from an older render.
    const current =
      useRoomStore.getState().placedItems.find((i) => i.id === item.id) ?? item;

    const currentFootprint = getEffectiveFootprint(
      current.widthCm,
      current.depthCm,
      current.rotationY
    );
    const center = {
      x: current.position.x + currentFootprint.width / 2,
      z: current.position.z + currentFootprint.depth / 2,
    };
    const others = useRoomStore
      .getState()
      .placedItems.filter((i) => i.id !== current.id);

    const nextFootprint = getEffectiveFootprint(
      current.widthCm,
      current.depthCm,
      nextRotationY
    );
    const clampedCenter = {
      x: clamp(center.x, nextFootprint.width / 2, roomWidthCm - nextFootprint.width / 2),
      z: clamp(center.z, nextFootprint.depth / 2, roomDepthCm - nextFootprint.depth / 2),
    };

    const next = checkPlacement({
      center: clampedCenter,
      widthCm: current.widthCm,
      depthCm: current.depthCm,
      rotationY: nextRotationY,
      others,
      room,
    });
    if (!next.ok) {
      const wasValid = checkPlacement({
        center,
        widthCm: current.widthCm,
        depthCm: current.depthCm,
        rotationY: current.rotationY,
        others,
        room,
      }).ok;
      if (wasValid) {
        explainFailure(next, others);
        return;
      }
    }

    updateItemPlacement(
      current.id,
      {
        x: clampedCenter.x - nextFootprint.width / 2,
        y: 0,
        z: clampedCenter.z - nextFootprint.depth / 2,
      },
      nextRotationY
    );
  }

  return (
    <DndContext
      id="design-dnd"
      onDragMove={handleDragMove}
      onDragEnd={handleDragEnd}
      onDragCancel={() => setGuides({ x: null, z: null })}
    >
      <div className="min-h-screen bg-stone-50 dark:bg-stone-950">
        <StepNav />

        <main className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-6 lg:flex-row lg:gap-8 lg:px-6 lg:py-8">
          {/* Sidebar: real furniture pulled from Shopify */}
          <aside className="order-2 w-full lg:order-none lg:w-64 lg:flex-shrink-0">
            <Link
              to="/room-setup"
              className="text-xs font-medium text-stone-500 hover:text-stone-900 dark:text-stone-400 dark:hover:text-stone-100"
            >
              ← Edit room
            </Link>
            <h2 className="mt-3 text-sm font-semibold text-stone-900 dark:text-stone-100">
              Furniture
            </h2>
            <p className="mt-1 text-xs text-stone-500 dark:text-stone-400">
              Drag an item onto the room to place it.
            </p>
            {loadError && (
              <p
                role="alert"
                className="mt-4 rounded-lg bg-red-50 p-3 text-xs text-red-800 dark:bg-red-950 dark:text-red-200"
              >
                {loadError}
              </p>
            )}
            {!loadError && products.length === 0 && (
              <p className="mt-4 rounded-lg bg-stone-100 p-3 text-xs text-stone-600 dark:bg-stone-900 dark:text-stone-300">
                No furniture in the store yet. Add products in Shopify and
                refresh.
              </p>
            )}
            <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:block lg:space-y-2">
              {products.map((product) => (
                <SidebarProduct key={product.id} product={product} />
              ))}
            </div>
          </aside>

          {/* The room itself, drawn top-down and scaled to real size */}
          <div ref={columnRef} className="order-1 min-w-0 flex-1 lg:order-none">
            <p className="mb-2 text-xs text-stone-500 dark:text-stone-400">
              {shape.points.length}-corner room, {Math.round(roomWidthCm)}cm ×{" "}
              {Math.round(roomDepthCm)}cm (top-down view)
            </p>
            <div className="mb-2 flex min-h-8 flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={undo}
                disabled={!canUndo}
                title="Undo (Ctrl/Cmd+Z)"
                className="rounded-full border border-stone-300 px-3 py-1 text-xs font-medium text-stone-700 hover:bg-stone-100 disabled:opacity-40 dark:border-stone-700 dark:text-stone-200 dark:hover:bg-stone-800"
              >
                ↶ Undo
              </button>
              <button
                type="button"
                onClick={redo}
                disabled={!canRedo}
                title="Redo (Ctrl/Cmd+Shift+Z)"
                className="rounded-full border border-stone-300 px-3 py-1 text-xs font-medium text-stone-700 hover:bg-stone-100 disabled:opacity-40 dark:border-stone-700 dark:text-stone-200 dark:hover:bg-stone-800"
              >
                ↷ Redo
              </button>
              <button
                type="button"
                onClick={handleAutoFurnish}
                disabled={products.length === 0}
                title="Place one of each product automatically"
                className="rounded-full border border-amber-700 px-3 py-1 text-xs font-medium text-amber-800 hover:bg-amber-50 disabled:opacity-40 dark:text-amber-300 dark:hover:bg-amber-950"
              >
                ✨ Furnish for me
              </button>
              {notice && (
                <div
                  role="status"
                  className="inline-block rounded-full bg-amber-100 px-3 py-1.5 text-xs font-medium text-amber-900 shadow-sm dark:bg-amber-900/60 dark:text-amber-100"
                >
                  {notice}
                </div>
              )}
            </div>
            <RoomCanvas
              canvasRef={canvasRef}
              widthPx={canvasWidthPx}
              heightPx={canvasHeightPx}
              wallColor={wallColor}
              floorColor={floorColor}
              floorType={floorType}
              guides={guides}
              onMoveOpening={handleMoveOpening}
              openings={sanitizeOpenings(shape.points, openings, shape.heightCm)}
              points={shape.points}
              bounds={bounds}
              scale={scale}
            >
              {placedItems.map((item) => (
                <PlacedFurniture
                  key={item.id}
                  item={item}
                  scale={scale}
                  onRotate={handleRotate}
                />
              ))}
            </RoomCanvas>
          </div>

          {/* Running total, the beginning of the real commerce loop */}
          <aside className="order-3 w-full lg:order-none lg:w-56 lg:flex-shrink-0">
            <div className="rounded-2xl border border-stone-200 bg-white p-5 shadow-sm dark:border-stone-800 dark:bg-stone-900">
              <h2 className="text-sm font-semibold text-stone-900 dark:text-stone-100">
                Your room
              </h2>
              <p className="mt-1 text-xs text-stone-500 dark:text-stone-400">
                {placedItems.length} item(s) placed
              </p>
              <p className="mt-3 text-2xl font-semibold text-stone-900 dark:text-stone-100">
                {cartTotal.toFixed(2)}{" "}
                <span className="text-sm font-normal text-stone-500 dark:text-stone-400">
                  {currencyCode}
                </span>
              </p>

              <button
                type="button"
                onClick={handleShare}
                className="mt-2 block text-xs font-medium text-stone-500 underline hover:text-stone-900 dark:text-stone-400 dark:hover:text-stone-100"
              >
                Copy share link
              </button>
              {placedItems.length > 0 && (
                <button
                  type="button"
                  onClick={() => {
                    if (window.confirm("Remove all furniture from this room?")) {
                      clearItems();
                    }
                  }}
                  className="mt-2 text-xs font-medium text-stone-500 underline hover:text-stone-900 dark:text-stone-400 dark:hover:text-stone-100"
                >
                  Clear room
                </button>
              )}

              <Link
                to="/walkthrough"
                className="mt-4 block rounded-full bg-stone-900 px-4 py-2 text-center text-sm font-medium text-white transition-colors hover:bg-stone-700 dark:bg-stone-100 dark:text-stone-900 dark:hover:bg-white"
              >
                View in 3D →
              </Link>

              {/* This <Form> is a real HTML form submission (not a fetch
                  call) - when clicked, the browser POSTs to this same
                  route's `action` function above, which creates the
                  Shopify cart and redirects the whole browser to
                  checkout. The hidden input carries the current room's
                  items as JSON since a form field can only hold text,
                  not JS objects directly. */}
              <Form method="post">
                <input
                  type="hidden"
                  name="lines"
                  value={JSON.stringify(
                    placedItems.map((item) => ({
                      variantId: item.variantId,
                      quantity: 1,
                    }))
                  )}
                />
                <button
                  type="submit"
                  disabled={placedItems.length === 0}
                  className="mt-2 w-full rounded-full px-4 py-2 text-sm font-medium text-white transition-colors disabled:cursor-not-allowed disabled:bg-stone-300 enabled:bg-amber-700 enabled:hover:bg-amber-800 dark:disabled:bg-stone-700"
                >
                  Buy this room →
                </button>
              </Form>
            </div>
          </aside>
        </main>
      </div>
    </DndContext>
  );
}

function SidebarProduct({ product }: { product: ShopifyProduct }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } =
    useDraggable({ id: `sidebar-${product.id}` });

  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      style={{
        transform: transform
          ? `translate3d(${transform.x}px, ${transform.y}px, 0)`
          : undefined,
        opacity: isDragging ? 0.5 : 1,
        touchAction: "none",
      }}
      className="flex cursor-grab items-center gap-3 rounded-xl border border-stone-200 bg-white p-2 shadow-sm dark:border-stone-800 dark:bg-stone-900"
    >
      {product.imageUrl ? (
        <img
          src={product.imageUrl}
          alt={product.title}
          width={40}
          height={40}
          className="h-10 w-10 rounded-lg object-cover"
        />
      ) : (
        <div className="h-10 w-10 rounded-lg bg-stone-100 dark:bg-stone-800" />
      )}
      <div className="min-w-0">
        <div className="truncate text-sm font-medium text-stone-900 dark:text-stone-100">
          {product.title}
        </div>
        <div className="text-xs text-stone-500 dark:text-stone-400">
          {product.price} {product.currencyCode}
          {product.widthCm == null && (
            <span
              title="This product has no dimensions in Shopify, so a default size is used"
              className="ml-1 text-amber-700 dark:text-amber-400"
            >
              · size estimated
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

function PlacedFurniture({
  item,
  scale,
  onRotate,
}: {
  item: PlacedItem;
  scale: number;
  onRotate: (item: PlacedItem, rotationY: number) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } =
    useDraggable({ id: `placed-${item.id}` });
  const removeItem = useRoomStore((state) => state.removeItem);

  // We need this element's own on-screen position (to turn future
  // pointer coordinates into an angle around its center) alongside
  // dnd-kit's own ref - a callback ref below sets both.
  const elementRef = useRef<HTMLDivElement | null>(null);

  // The item's on-the-ground bounding box (used for room-boundary
  // clamping up in the parent, and to know where its CENTER sits) is
  // generally bigger than its true, unrotated size once it's turned to
  // an angle. So the div itself is sized at the item's true width/depth,
  // centered on that same point, and then visually turned with a CSS
  // rotation - that's what makes rotation look correct at ANY angle,
  // not just the 90-degree steps where a resized box used to happen to
  // look identical to a real rotation.
  const footprint = getEffectiveFootprint(
    item.widthCm,
    item.depthCm,
    item.rotationY
  );
  const centerXCm = item.position.x + footprint.width / 2;
  const centerZCm = item.position.z + footprint.depth / 2;
  const widthPx = item.widthCm * scale;
  const depthPx = item.depthCm * scale;
  const leftPx = centerXCm * scale - widthPx / 2;
  const topPx = centerZCm * scale - depthPx / 2;

  // Sizes the name label to fit inside THIS item's box. The font shrinks
  // for small items (and never goes below 7px or above 11px), and the
  // label is allowed only as many lines as actually fit the box's height -
  // anything longer is cut off with "..." rather than spilling outside
  // the box. The full name is still shown on hover (the box's title).
  const labelFontPx = clamp(Math.min(widthPx, depthPx) / 6, 7, 11);
  const maxLabelLines = Math.max(
    1,
    Math.floor((depthPx - 8) / (labelFontPx * 1.25))
  );

  // Dragging the rotate handle turns the item to follow the pointer,
  // freely - any angle, not locked to 90-degree steps. We measure the
  // angle from the item's on-screen center (captured once, when the
  // drag starts - the center doesn't move while only the rotation is
  // changing) to wherever the pointer currently is.
  function handleRotateStart(e: React.PointerEvent) {
    const el = elementRef.current;
    if (!el) return;

    // One undo step for the whole turn (not one per pointer move)
    useRoomStore.getState().checkpoint();

    const rect = el.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;

    function angleTo(clientX: number, clientY: number) {
      // atan2 measures from the positive X axis, so pointing straight
      // right is 0 degrees - we add 90 so that pointing straight UP
      // (the item's default facing) is 0 degrees instead, then wrap
      // into a plain 0-359 range.
      const degrees =
        (Math.atan2(clientY - centerY, clientX - centerX) * 180) / Math.PI +
        90;
      return ((degrees % 360) + 360) % 360;
    }

    function onMove(ev: PointerEvent) {
      onRotate(item, angleTo(ev.clientX, ev.clientY));
    }
    function onUp() {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    }
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }

  return (
    <div
      ref={(node) => {
        setNodeRef(node);
        elementRef.current = node;
      }}
      {...listeners}
      {...attributes}
      title={item.title}
      style={{
        left: leftPx,
        top: topPx,
        width: widthPx,
        height: depthPx,
        // Order matters: translate3d (dnd-kit's screen-space drag
        // offset) has to come BEFORE rotate, otherwise the rotation
        // would happen first and dragging would move the item along
        // its own tilted axes instead of following the pointer.
        transform: [
          transform
            ? `translate3d(${transform.x}px, ${transform.y}px, 0)`
            : undefined,
          `rotate(${item.rotationY}deg)`,
        ]
          .filter(Boolean)
          .join(" "),
        opacity: isDragging ? 0.6 : 1,
        touchAction: "none",
      }}
      // A real product photo is a side-on shot with a white studio
      // background - it doesn't represent a bird's-eye "footprint"
      // well, and just looks like a white square at small sizes. Floor
      // planners (IKEA's, etc.) use flat colored shapes here instead,
      // and save real photos for the sidebar and the 3D view.
      //
      // No overflow-hidden here anymore - the remove/rotate buttons
      // below sit just outside this box's edges on purpose, and
      // clipping was cutting them off.
      className="absolute flex cursor-grab items-center justify-center rounded-md border-2 border-amber-800/40 bg-amber-200/70 text-center dark:bg-amber-900/40"
    >
      <button
        // dnd-kit's drag listeners are attached to this whole block, and
        // pointerdown events bubble up from any child - including this
        // button - straight into those listeners. That starts a "drag"
        // before a normal click can ever fire, which is why the button
        // looked broken. Stopping propagation right here at pointerdown
        // (not just onClick) keeps dnd-kit from ever seeing this press.
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.stopPropagation();
          removeItem(item.id);
        }}
        title="Remove"
        className="absolute -top-3 -right-3 z-10 flex h-6 w-6 items-center justify-center rounded-full bg-red-600 text-sm leading-none text-white shadow hover:bg-red-700"
      >
        ×
      </button>
      <button
        // Rotation now happens by dragging this handle around rather
        // than clicking it - pointerdown starts tracking the drag (see
        // handleRotateStart), and stopPropagation keeps dnd-kit's own
        // drag detection from swallowing the press.
        onPointerDown={(e) => {
          e.stopPropagation();
          handleRotateStart(e);
        }}
        title="Drag to rotate"
        className="absolute -top-3 -left-3 z-10 flex h-6 w-6 cursor-grab items-center justify-center rounded-full bg-stone-700 text-sm leading-none text-white shadow hover:bg-stone-800 active:cursor-grabbing"
      >
        ⟳
      </button>
      <span
        // min-w-0 + max-w-full let this flex child shrink to the box's
        // width so long names wrap instead of running past the edges.
        // The -webkit-box / line-clamp combo is the standard way to cut
        // text off with "..." after a set number of lines.
        className="min-w-0 max-w-full overflow-hidden px-1 text-center leading-tight font-medium text-amber-950 dark:text-amber-100"
        style={{
          fontSize: labelFontPx,
          display: "-webkit-box",
          WebkitBoxOrient: "vertical",
          WebkitLineClamp: maxLabelLines,
          overflowWrap: "anywhere",
        }}
      >
        {item.title}
      </span>
    </div>
  );
}

function RoomCanvas({
  canvasRef,
  widthPx,
  heightPx,
  wallColor,
  floorColor,
  floorType,
  guides,
  onMoveOpening,
  openings,
  points,
  bounds,
  scale,
  children,
}: {
  canvasRef: React.RefObject<HTMLDivElement | null>;
  widthPx: number;
  heightPx: number;
  wallColor: string;
  floorColor: string;
  floorType: FloorId;
  guides: { x: number | null; z: number | null };
  onMoveOpening: (id: string, clientX: number, clientY: number) => void;
  openings: Opening[];
  points: Array<{ x: number; z: number }>;
  bounds: { minX: number; minZ: number };
  scale: number;
  children: React.ReactNode;
}) {
  const { setNodeRef } = useDroppable({ id: "room-canvas" });
  const floorPaint = useFloorPaint(floorType, floorColor, "room-floor");

  // The room's shape is drawn as an SVG polygon, positioned relative to
  // the bounding box's top-left corner (so the shape sits flush inside
  // the canvas regardless of where its original coordinates were drawn
  // on the room-setup screen).
  const polygonPoints = points
    .map((p) => `${(p.x - bounds.minX) * scale},${(p.z - bounds.minZ) * scale}`)
    .join(" ");

  return (
    <div
      ref={(node) => {
        setNodeRef(node);
        canvasRef.current = node;
      }}
      style={{ width: widthPx, height: heightPx }}
      className="relative"
    >
      <svg
        width={widthPx}
        height={heightPx}
        className="absolute inset-0 rounded-sm shadow-inner"
      >
        <FloorPatternDefs
          patternId="room-floor"
          url={floorPaint.url}
          pxPerCm={scale}
        />
        <polygon
          points={polygonPoints}
          fill={floorPaint.fill}
          stroke={wallColor}
          strokeWidth={12}
          strokeLinejoin="round"
        />
      </svg>
      <div className="absolute inset-0">{children}</div>
      {/* Doors (brown) and windows (blue) on their walls. This layer sits
          above the furniture so they can be grabbed and dragged along
          the walls; only the lines themselves catch the pointer. */}
      <svg
        width={widthPx}
        height={heightPx}
        className="pointer-events-none absolute inset-0"
      >
        {openings.map((o) => {
          const line = getOpeningLine(points, o);
          const coords = {
            x1: (line.x1 - bounds.minX) * scale,
            y1: (line.z1 - bounds.minZ) * scale,
            x2: (line.x2 - bounds.minX) * scale,
            y2: (line.z2 - bounds.minZ) * scale,
          };
          return (
            <g key={o.id}>
              <line
                {...coords}
                stroke={o.type === "door" ? DOOR_COLOR : WINDOW_COLOR}
                strokeWidth={12}
              />
              <line
                {...coords}
                stroke="transparent"
                strokeWidth={24}
                style={{ cursor: "grab", touchAction: "none", pointerEvents: "stroke" }}
                onPointerDown={(e) => {
                  e.stopPropagation();
                  e.currentTarget.setPointerCapture(e.pointerId);
                }}
                onPointerMove={(e) => {
                  if (e.currentTarget.hasPointerCapture(e.pointerId)) {
                    onMoveOpening(o.id, e.clientX, e.clientY);
                  }
                }}
              >
                <title>Drag along the walls to move</title>
              </line>
            </g>
          );
        })}
      </svg>
      {/* Alignment guides (only while dragging, when something lines up) */}
      {guides.x !== null && (
        <div
          className="pointer-events-none absolute top-0 bottom-0 w-px bg-sky-500"
          style={{ left: guides.x * scale }}
        />
      )}
      {guides.z !== null && (
        <div
          className="pointer-events-none absolute right-0 left-0 h-px bg-sky-500"
          style={{ top: guides.z * scale }}
        />
      )}
    </div>
  );
}
