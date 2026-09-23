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

import { useRef } from "react";
import { Form, Link, redirect } from "react-router";
import {
  DndContext,
  useDraggable,
  useDroppable,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  createCartCheckoutUrl,
  getProducts,
  type ShopifyProduct,
} from "~/lib/shopify.server";
import { StepNav } from "~/components/StepNav";
import { useRoomStore, type PlacedItem } from "~/store/roomStore";
import {
  getEffectiveFootprint,
  getPolygonBounds,
  isPointInPolygon,
} from "~/lib/geometry";
import type { Route } from "./+types/design";

const MAX_CANVAS_PX = 640;

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

export async function loader() {
  const products = await getProducts();
  return { products };
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
  const { products } = loaderData;

  const shape = useRoomStore((state) => state.shape);
  const wallColor = useRoomStore((state) => state.wallColor);
  const floorColor = useRoomStore((state) => state.floorColor);
  const placedItems = useRoomStore((state) => state.placedItems);
  const addItem = useRoomStore((state) => state.addItem);
  const updateItemPosition = useRoomStore((state) => state.updateItemPosition);
  const updateItemPlacement = useRoomStore((state) => state.updateItemPlacement);

  const canvasRef = useRef<HTMLDivElement | null>(null);

  // The room can be any shape now, so there's no single "width" and
  // "length" anymore - instead we find the smallest rectangle that
  // fully contains the shape, and scale/position everything relative
  // to THAT rectangle's top-left corner.
  const bounds = getPolygonBounds(shape.points);
  const roomWidthCm = bounds.maxX - bounds.minX;
  const roomDepthCm = bounds.maxZ - bounds.minZ;

  const scale = MAX_CANVAS_PX / Math.max(roomWidthCm, roomDepthCm);
  const canvasWidthPx = roomWidthCm * scale;
  const canvasHeightPx = roomDepthCm * scale;

  const cartTotal = placedItems.reduce(
    (sum, item) => sum + Number(item.price),
    0
  );
  const currencyCode = placedItems[0]?.currencyCode ?? "USD";

  function handleDragEnd(event: DragEndEvent) {
    const canvasEl = canvasRef.current;
    if (!canvasEl) return;

    // Only act if the item was actually dropped over the canvas
    if (!event.over || event.over.id !== "room-canvas") return;

    const canvasRect = canvasEl.getBoundingClientRect();

    // event.activatorEvent is the original pointer-down event, which has
    // where the drag started; event.delta is how far the pointer moved.
    // Adding them gives us where the pointer ended up.
    const activatorEvent = event.activatorEvent as PointerEvent;
    const finalClientX = activatorEvent.clientX + event.delta.x;
    const finalClientY = activatorEvent.clientY + event.delta.y;

    // Position relative to the canvas's top-left corner, in cm
    const dropXCm = (finalClientX - canvasRect.left) / scale;
    const dropZCm = (finalClientY - canvasRect.top) / scale;

    const activeId = String(event.active.id);

    if (activeId.startsWith("sidebar-")) {
      // Dragging a NEW item in from the sidebar
      const productId = activeId.replace("sidebar-", "");
      const product = products.find((p) => p.id === productId);
      if (!product) return;

      const widthCm = product.widthCm ?? 60;
      const depthCm = product.depthCm ?? 60;
      const heightCm = product.heightCm ?? 80;

      const position = {
        x: clamp(dropXCm - widthCm / 2, 0, roomWidthCm - widthCm),
        y: 0,
        z: clamp(dropZCm - depthCm / 2, 0, roomDepthCm - depthCm),
      };

      // The canvas is scaled to the room's BOUNDING BOX, but the room's
      // actual shape can be smaller than that box (think of an L-shape:
      // its bounding box is a full rectangle, but the missing corner
      // isn't really part of the room). So before placing anything, we
      // check the item's center point against the real polygon, not
      // just the rectangle - this is exactly why non-rectangular rooms
      // need real point-in-polygon math, not just min/max clamping.
      const centerInRoomCoords = {
        x: bounds.minX + position.x + widthCm / 2,
        z: bounds.minZ + position.z + depthCm / 2,
      };
      if (!isPointInPolygon(centerInRoomCoords, shape.points)) return;

      addItem({
        id: crypto.randomUUID(),
        productId: product.id,
        variantId: product.variantId,
        title: product.title,
        price: product.price,
        currencyCode: product.currencyCode,
        imageUrl: product.imageUrl,
        modelUrl: product.modelUrl,
        widthCm,
        heightCm,
        depthCm,
        position,
        rotationY: 0,
      });
    } else if (activeId.startsWith("placed-")) {
      // Repositioning an EXISTING item already in the room
      const itemId = activeId.replace("placed-", "");
      const item = placedItems.find((i) => i.id === itemId);
      if (!item) return;

      // Use the item's CURRENT rotation to know its real on-the-ground
      // footprint right now - a sofa rotated 90 degrees needs its
      // swapped width/depth here, not its original ones.
      const footprint = getEffectiveFootprint(
        item.widthCm,
        item.depthCm,
        item.rotationY
      );

      const position = {
        x: clamp(dropXCm - footprint.width / 2, 0, roomWidthCm - footprint.width),
        y: 0,
        z: clamp(dropZCm - footprint.depth / 2, 0, roomDepthCm - footprint.depth),
      };

      const centerInRoomCoords = {
        x: bounds.minX + position.x + footprint.width / 2,
        z: bounds.minZ + position.z + footprint.depth / 2,
      };
      if (!isPointInPolygon(centerInRoomCoords, shape.points)) return;

      updateItemPosition(itemId, position);
    }
  }

  // Rotates an item to any angle the user drags it to (see the rotate
  // handle in PlacedFurniture, which calls this continuously while
  // dragging). We keep the item's CENTER fixed rather than its
  // top-left corner - otherwise the item would visibly drift sideways
  // as it turns, since a rotated rectangle's bounding box keeps
  // changing size and "top-left corner" doesn't point at a stable spot.
  function handleRotate(item: PlacedItem, nextRotationY: number) {
    const currentFootprint = getEffectiveFootprint(
      item.widthCm,
      item.depthCm,
      item.rotationY
    );
    const centerX = item.position.x + currentFootprint.width / 2;
    const centerZ = item.position.z + currentFootprint.depth / 2;

    const nextFootprint = getEffectiveFootprint(
      item.widthCm,
      item.depthCm,
      nextRotationY
    );

    const position = {
      x: clamp(centerX - nextFootprint.width / 2, 0, roomWidthCm - nextFootprint.width),
      y: 0,
      z: clamp(centerZ - nextFootprint.depth / 2, 0, roomDepthCm - nextFootprint.depth),
    };

    updateItemPlacement(item.id, position, nextRotationY);
  }

  return (
    <DndContext onDragEnd={handleDragEnd}>
      <div className="min-h-screen bg-stone-50 dark:bg-stone-950">
        <StepNav />

        <main className="mx-auto flex max-w-6xl gap-8 px-6 py-8">
          {/* Sidebar: real furniture pulled from Shopify */}
          <aside className="w-64 flex-shrink-0">
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
            <div className="mt-4 space-y-2">
              {products.map((product) => (
                <SidebarProduct key={product.id} product={product} />
              ))}
            </div>
          </aside>

          {/* The room itself, drawn top-down and scaled to real size */}
          <div className="flex-1">
            <p className="mb-2 text-xs text-stone-500 dark:text-stone-400">
              {shape.points.length}-corner room, {Math.round(roomWidthCm)}cm ×{" "}
              {Math.round(roomDepthCm)}cm (top-down view)
            </p>
            <RoomCanvas
              canvasRef={canvasRef}
              widthPx={canvasWidthPx}
              heightPx={canvasHeightPx}
              wallColor={wallColor}
              floorColor={floorColor}
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
          <aside className="w-56 flex-shrink-0">
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

  // Dragging the rotate handle turns the item to follow the pointer,
  // freely - any angle, not locked to 90-degree steps. We measure the
  // angle from the item's on-screen center (captured once, when the
  // drag starts - the center doesn't move while only the rotation is
  // changing) to wherever the pointer currently is.
  function handleRotateStart(e: React.PointerEvent) {
    const el = elementRef.current;
    if (!el) return;

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
      <span className="px-1 text-[10px] font-medium text-amber-950 dark:text-amber-100">
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
  points: Array<{ x: number; z: number }>;
  bounds: { minX: number; minZ: number };
  scale: number;
  children: React.ReactNode;
}) {
  const { setNodeRef } = useDroppable({ id: "room-canvas" });

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
        <polygon
          points={polygonPoints}
          fill={floorColor}
          stroke={wallColor}
          strokeWidth={12}
          strokeLinejoin="round"
        />
      </svg>
      <div className="absolute inset-0">{children}</div>
    </div>
  );
}
