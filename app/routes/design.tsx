// The real 2D floor planner. It shows:
//  - a sidebar of real furniture pulled live from Shopify (via the
//    loader below, which runs on the server before the page renders)
//  - a top-down "canvas" scaled to the room's real dimensions
//  - drag-and-drop: drag a product from the sidebar and drop it onto
//    the canvas to place it; drag a placed item to reposition it
//
// The scaling idea: we don't draw the room at its real size in pixels
// (a 400cm room would need a 400px+ canvas at 1px/cm, which is fine,
// but a large room could get huge or tiny). Instead we compute a
// "pixels per cm" scale factor so the room always fits nicely on
// screen, then every item's pixel size and position is derived from
// that same scale - keeping everything proportionally correct.
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

  const dimensions = useRoomStore((state) => state.dimensions);
  const wallColor = useRoomStore((state) => state.wallColor);
  const floorColor = useRoomStore((state) => state.floorColor);
  const placedItems = useRoomStore((state) => state.placedItems);
  const addItem = useRoomStore((state) => state.addItem);
  const updateItemPosition = useRoomStore((state) => state.updateItemPosition);

  const canvasRef = useRef<HTMLDivElement | null>(null);

  // pixels-per-centimeter, chosen so the longer side of the room maps
  // to MAX_CANVAS_PX on screen
  const scale =
    MAX_CANVAS_PX / Math.max(dimensions.widthCm, dimensions.lengthCm);
  const canvasWidthPx = dimensions.widthCm * scale;
  const canvasHeightPx = dimensions.lengthCm * scale;

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

    // Convert from "pixels on screen" to "centimeters inside the room"
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

      addItem({
        id: crypto.randomUUID(),
        productId: product.id,
        variantId: product.variantId,
        title: product.title,
        price: product.price,
        currencyCode: product.currencyCode,
        imageUrl: product.imageUrl,
        widthCm,
        heightCm,
        depthCm,
        position: {
          x: clamp(dropXCm - widthCm / 2, 0, dimensions.widthCm - widthCm),
          y: 0,
          z: clamp(dropZCm - depthCm / 2, 0, dimensions.lengthCm - depthCm),
        },
        rotationY: 0,
      });
    } else if (activeId.startsWith("placed-")) {
      // Repositioning an EXISTING item already in the room
      const itemId = activeId.replace("placed-", "");
      const item = placedItems.find((i) => i.id === itemId);
      if (!item) return;

      updateItemPosition(itemId, {
        x: clamp(
          dropXCm - item.widthCm / 2,
          0,
          dimensions.widthCm - item.widthCm
        ),
        y: 0,
        z: clamp(
          dropZCm - item.depthCm / 2,
          0,
          dimensions.lengthCm - item.depthCm
        ),
      });
    }
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
              {dimensions.widthCm}cm × {dimensions.lengthCm}cm room (top-down
              view)
            </p>
            <RoomCanvas
              canvasRef={canvasRef}
              widthPx={canvasWidthPx}
              heightPx={canvasHeightPx}
              wallColor={wallColor}
              floorColor={floorColor}
            >
              {placedItems.map((item) => (
                <PlacedFurniture key={item.id} item={item} scale={scale} />
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

function PlacedFurniture({ item, scale }: { item: PlacedItem; scale: number }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } =
    useDraggable({ id: `placed-${item.id}` });
  const removeItem = useRoomStore((state) => state.removeItem);

  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      title={item.title}
      style={{
        left: item.position.x * scale,
        top: item.position.z * scale,
        width: item.widthCm * scale,
        height: item.depthCm * scale,
        transform: transform
          ? `translate3d(${transform.x}px, ${transform.y}px, 0)`
          : undefined,
        opacity: isDragging ? 0.6 : 1,
        touchAction: "none",
      }}
      // A real product photo is a side-on shot with a white studio
      // background - it doesn't represent a bird's-eye "footprint"
      // well, and just looks like a white square at small sizes. Floor
      // planners (IKEA's, etc.) use flat colored shapes here instead,
      // and save real photos for the sidebar and the 3D view.
      className="absolute flex cursor-grab items-center justify-center overflow-hidden rounded-md border-2 border-amber-800/40 bg-amber-200/70 text-center dark:bg-amber-900/40"
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
        className="absolute -top-2 -right-2 z-10 flex h-4.5 w-4.5 items-center justify-center rounded-full bg-red-600 text-xs leading-none text-white hover:bg-red-700"
      >
        ×
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
  children,
}: {
  canvasRef: React.RefObject<HTMLDivElement | null>;
  widthPx: number;
  heightPx: number;
  wallColor: string;
  floorColor: string;
  children: React.ReactNode;
}) {
  const { setNodeRef } = useDroppable({ id: "room-canvas" });

  return (
    <div
      ref={(node) => {
        setNodeRef(node);
        canvasRef.current = node;
      }}
      style={{
        width: widthPx,
        height: heightPx,
        background: floorColor,
        border: `12px solid ${wallColor}`,
      }}
      className="relative rounded-sm shadow-inner"
    >
      {children}
    </div>
  );
}
